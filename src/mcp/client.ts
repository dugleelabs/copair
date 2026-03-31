import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import which from 'which';
import type { McpServerConfigSchema } from '../config/schema.js';
import type { z } from 'zod';
import { logger } from '../core/logger.js';
import type { AuditLog } from '../core/audit-log.js';

type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

/**
 * Thrown when an MCP tool call exceeds its timeout.
 * Caught in ToolExecutor and returned as a structured error to the agent.
 */
export class McpTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpTimeoutError';
  }
}

export interface McpClient {
  name: string;
  client: Client;
}

// ── FR-13: Minimal env passed to MCP subprocesses ────────────────────────────

const MINIMAL_ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL'];

/**
 * Build the environment object passed to an MCP subprocess.
 *
 * Default (inherit_env: false): only the keys in MINIMAL_ENV_KEYS are forwarded,
 * plus any vars explicitly declared in the server's `env` config.
 * This prevents the subprocess from inheriting secrets such as ANTHROPIC_API_KEY.
 *
 * When inherit_env is true, the full process.env is passed (opt-in for power users
 * who need the full environment in their MCP server).
 */
export function buildMcpEnv(
  serverEnv?: Record<string, string>,
  inheritEnv = false,
): Record<string, string> {
  const base: Record<string, string> = {};

  if (inheritEnv) {
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) base[k] = v;
    }
  } else {
    for (const key of MINIMAL_ENV_KEYS) {
      const val = process.env[key];
      if (val !== undefined) base[key] = val;
    }
  }

  return { ...base, ...serverEnv };
}

// ── FR-12: MCP server config validation ──────────────────────────────────────

const SENSITIVE_ENV_PATTERN = /(_KEY|_SECRET|_TOKEN|_PASSWORD)$/i;

/**
 * Validate a configured MCP server before attempting to connect.
 *
 * Returns false (and logs a warning) if the server command cannot be found,
 * so the caller can skip the server without blocking startup.
 *
 * Also warns (but does not fail) if any env key looks like a hardcoded secret.
 */
export async function validateMcpServer(server: McpServerConfig): Promise<boolean> {
  const { command, name } = server;

  // Absolute path: must exist on the filesystem.
  if (command.startsWith('/')) {
    if (!existsSync(command)) {
      logger.warn('mcp', `Server "${name}": command "${command}" does not exist — skipping`);
      return false;
    }
  } else {
    // Relative/bare command: must be resolvable via $PATH.
    const found = await which(command, { nothrow: true });
    if (!found) {
      logger.warn('mcp', `Server "${name}": command "${command}" not found on $PATH — skipping`);
      return false;
    }
  }

  // Warn about hardcoded secrets in env config.
  if (server.env) {
    for (const key of Object.keys(server.env)) {
      if (SENSITIVE_ENV_PATTERN.test(key)) {
        logger.warn(
          'mcp',
          `Server "${name}": env key "${key}" looks like a secret — ` +
          'use ${ENV_VAR} interpolation instead of hardcoding the value',
        );
      }
    }
  }

  return true;
}

// ── McpClientManager ──────────────────────────────────────────────────────────

export class McpClientManager {
  private clients = new Map<string, Client>();
  /** Servers that have timed out — subsequent calls fail immediately. */
  private degraded = new Set<string>();
  /** Per-server timeout override in ms. Falls back to 30s if not set. */
  private timeouts = new Map<string, number>();
  private auditLog: AuditLog | null = null;

  setAuditLog(log: AuditLog): void {
    this.auditLog = log;
  }

  async initialize(servers: McpServerConfig[]): Promise<void> {
    for (const server of servers) {
      const valid = await validateMcpServer(server);
      if (!valid) continue;
      await this.connectServer(server);
    }
  }

  private async connectServer(server: McpServerConfig): Promise<void> {
    if (server.timeout_ms !== undefined) {
      this.timeouts.set(server.name, server.timeout_ms);
    }

    // FR-13: filtered env — never pass full process.env by default.
    const env = buildMcpEnv(server.env, server.inherit_env);

    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env,
    });

    const client = new Client(
      { name: 'copair', version: '0.1.0' },
      { capabilities: {} },
    );

    await client.connect(transport);
    this.clients.set(server.name, client);

    logger.info('mcp', `Server "${server.name}" connected`);
    void this.auditLog?.append({
      event: 'tool_call',
      tool: `mcp:${server.name}:connect`,
      outcome: 'allowed',
      detail: server.command,
    });
  }

  /**
   * Call a tool on the named MCP server with a timeout.
   * If the server has previously timed out, throws immediately without making
   * a network call. On timeout, marks the server as degraded.
   *
   * @param serverName  The MCP server name (as registered).
   * @param toolName    The tool name to call.
   * @param args        Tool arguments.
   * @param timeoutMs   Timeout in milliseconds (default: 30s).
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }> {
    const resolvedTimeout = timeoutMs ?? this.timeouts.get(serverName) ?? 30_000;
    if (this.degraded.has(serverName)) {
      throw new McpTimeoutError(
        `MCP server "${serverName}" is degraded (previous timeout) — skipping`,
      );
    }

    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server "${serverName}" not connected`);
    }

    const timeoutSignal = AbortSignal.timeout(resolvedTimeout);

    try {
      const result = await client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal: timeoutSignal },
      );
      return result as { content: Array<{ type: string; text?: string }>; isError?: boolean };
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        this.degraded.add(serverName);
        logger.warn('mcp', `Timeout on tool "${toolName}" from server "${serverName}" — server marked degraded`);
        throw new McpTimeoutError(`MCP tool "${toolName}" timed out after ${resolvedTimeout}ms`);
      }
      throw err;
    }
  }

  getClient(name: string): Client | undefined {
    return this.clients.get(name);
  }

  getAll(): Map<string, Client> {
    return this.clients;
  }

  async shutdown(): Promise<void> {
    for (const name of this.clients.keys()) {
      logger.info('mcp', `Server "${name}" disconnecting`);
      void this.auditLog?.append({
        event: 'tool_call',
        tool: `mcp:${name}:disconnect`,
        outcome: 'allowed',
      });
    }
    const shutdowns = Array.from(this.clients.values()).map((client) =>
      client.close().catch(() => {}),
    );
    await Promise.all(shutdowns);
    this.clients.clear();
    this.degraded.clear();
    this.timeouts.clear();
  }
}
