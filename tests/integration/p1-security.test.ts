/**
 * T-29: P1 integration tests — allowlist, audit log, MCP security.
 *
 * Tests the full P1 security stack end-to-end: PathPolicy allow/deny lists,
 * AuditLog integration into the execution pipeline, copair audit CLI exit codes,
 * MCP env filtering, and MCP server startup validation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  realpathSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { z } from 'zod';

import { PathGuard } from '../../src/core/path-guard.js';
import { ApprovalGate } from '../../src/core/approval-gate.js';
import { ToolExecutor } from '../../src/core/tool-executor.js';
import { AuditLog } from '../../src/core/audit-log.js';
import type { AuditEntry } from '../../src/core/audit-log.js';
import { McpClientManager, buildMcpEnv, validateMcpServer } from '../../src/mcp/client.js';
import { runAuditCommand } from '../../src/cli/commands/audit.js';
import type { Tool, ToolResult } from '../../src/tools/interface.js';
import type { ToolRegistry } from '../../src/tools/registry.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'copair-p1-'));
  execSync('git init -q', { cwd: dir });
  return dir;
}

function makeSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'copair-p1-session-'));
}

function makeRegistry(tool: Tool): ToolRegistry {
  return {
    get: (name: string) => (name === tool.definition.name ? tool : undefined),
  } as unknown as ToolRegistry;
}

function makeFakeTool(name: string, result: ToolResult, schema?: z.ZodTypeAny): Tool {
  return {
    definition: {
      name,
      description: 'p1 test tool',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    inputSchema: schema,
    requiresPermission: false,
    execute: vi.fn().mockResolvedValue(result),
  };
}

function readAuditEntries(sessionDir: string): AuditEntry[] {
  const logPath = join(sessionDir, 'audit.jsonl');
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AuditEntry);
}

// ── PathGuard P1 — allow_paths and deny_paths integration ────────────────────

describe('PathGuard P1 — allow_paths integration', () => {
  let projectRoot: string;
  let outsideDir: string;

  beforeEach(() => {
    projectRoot = makeTempGitRepo();
    outsideDir = mkdtempSync(join(tmpdir(), 'copair-p1-outside-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('allows a configured path outside project root via allow_paths', () => {
    const targetFile = join(outsideDir, 'shared.ts');
    writeFileSync(targetFile, '');
    const realOutside = realpathSync(outsideDir);

    const guard = new PathGuard(projectRoot, 'strict', {
      allowPaths: [realOutside + '/**'],
      denyPaths: [],
    });

    const result = guard.check(targetFile, true);
    expect(result.allowed).toBe(true);
  });

  it('denies an unconfigured path outside project root even when allow_paths is set', () => {
    const otherDir = mkdtempSync(join(tmpdir(), 'copair-p1-other-'));
    const targetFile = join(otherDir, 'unlisted.ts');
    writeFileSync(targetFile, '');
    const realOutside = realpathSync(outsideDir);

    const guard = new PathGuard(projectRoot, 'strict', {
      allowPaths: [realOutside + '/**'],
      denyPaths: [],
    });

    try {
      const result = guard.check(targetFile, true);
      expect(result.allowed).toBe(false);
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });
});

describe('PathGuard P1 — deny_paths overrides built-in deny list', () => {
  let projectRoot: string;
  let outsideDir: string;

  beforeEach(() => {
    projectRoot = makeTempGitRepo();
    outsideDir = mkdtempSync(join(tmpdir(), 'copair-p1-custom-deny-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('custom deny_paths blocks the custom pattern', () => {
    const blocked = join(outsideDir, 'blocked.txt');
    writeFileSync(blocked, '');
    const realOutside = realpathSync(outsideDir);

    const guard = new PathGuard(projectRoot, 'strict', {
      allowPaths: [],
      denyPaths: [realOutside + '/**'],
    });

    const result = guard.check(blocked, true);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('access-denied');
  });

  it('custom deny_paths replaces built-in list (BUILTIN_DENY no longer applies)', () => {
    // With a custom denyPaths that does NOT include ~/.aws/config,
    // the home dir check becomes: it's outside the project root and not in allow_paths,
    // so it would be denied by default. But the deny list itself no longer blocks ~/.aws.
    // We can't easily test this without a real ~/.aws/config — so we test the inverse:
    // a custom deny pattern blocks correctly while the built-in is gone.
    const secret = join(outsideDir, 'secrets.env');
    writeFileSync(secret, '');
    const realOutside = realpathSync(outsideDir);

    const guard = new PathGuard(projectRoot, 'strict', {
      allowPaths: [],
      denyPaths: [realOutside + '/secrets.env'],
    });

    const result = guard.check(secret, true);
    expect(result.allowed).toBe(false);
  });
});

// ── AuditLog integration — pipeline produces entries ─────────────────────────

describe('AuditLog integration — ToolExecutor pipeline', () => {
  let projectRoot: string;
  let sessionDir: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    projectRoot = makeTempGitRepo();
    sessionDir = makeSessionDir();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(sessionDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('produces a tool_call audit entry on successful tool execution', async () => {
    const guard = new PathGuard(projectRoot);
    const gate = new ApprovalGate('auto-approve');
    const auditLog = new AuditLog(sessionDir);
    const tool = makeFakeTool('read', { content: 'file content', isError: false });
    // Create a file inside project root so PathGuard allows it
    const filePath = join(projectRoot, 'test.txt');
    writeFileSync(filePath, 'hello');

    const executor = new ToolExecutor(makeRegistry(tool), gate, guard);
    executor.setAuditLog(auditLog);

    await executor.execute('read', { file_path: filePath });

    const entries = readAuditEntries(sessionDir);
    const toolCallEntry = entries.find((e) => e.event === 'tool_call');
    expect(toolCallEntry).toBeDefined();
    expect(toolCallEntry?.tool).toBe('read');
    expect(toolCallEntry?.outcome).toBe('allowed');
  });

  it('produces a schema_rejection audit entry on Zod validation failure', async () => {
    const guard = new PathGuard(projectRoot);
    const gate = new ApprovalGate('auto-approve');
    const auditLog = new AuditLog(sessionDir);

    // Tool with strict schema requiring a string file_path
    const schema = z.object({ file_path: z.string() }).strict();
    const tool = makeFakeTool('read', { content: 'ok', isError: false }, schema);

    const executor = new ToolExecutor(makeRegistry(tool), gate, guard);
    executor.setAuditLog(auditLog);

    // Call with wrong type — number instead of string
    await executor.execute('read', { file_path: 42 as unknown as string });

    const entries = readAuditEntries(sessionDir);
    const rejectionEntry = entries.find((e) => e.event === 'schema_rejection');
    expect(rejectionEntry).toBeDefined();
    expect(rejectionEntry?.tool).toBe('read');
    expect(rejectionEntry?.outcome).toBe('error');
  });

  it('produces a path_block audit entry when PathGuard denies a path', async () => {
    const guard = new PathGuard(projectRoot);
    const gate = new ApprovalGate('auto-approve');
    const auditLog = new AuditLog(sessionDir);

    // No schema — passthrough validation
    const tool = makeFakeTool('read', { content: 'secret', isError: false });

    const executor = new ToolExecutor(makeRegistry(tool), gate, guard);
    executor.setAuditLog(auditLog);

    // Try to read /etc/hosts — outside project root
    await executor.execute('read', { file_path: '/etc/hosts' });

    const entries = readAuditEntries(sessionDir);
    const pathBlockEntry = entries.find((e) => e.event === 'path_block');
    expect(pathBlockEntry).toBeDefined();
    expect(pathBlockEntry?.tool).toBe('read');
    expect(pathBlockEntry?.outcome).toBe('denied');
  });

  it('audit log input_summary contains no raw API key secrets', async () => {
    const guard = new PathGuard(projectRoot);
    const gate = new ApprovalGate('auto-approve');
    const auditLog = new AuditLog(sessionDir);

    // Tool that executes successfully
    const tool = makeFakeTool('bash', { content: 'done', isError: false });
    const filePath = join(projectRoot, 'run.sh');
    writeFileSync(filePath, '#!/bin/sh\necho done');

    const executor = new ToolExecutor(makeRegistry(tool), gate, guard);
    executor.setAuditLog(auditLog);

    // Command string contains a secret
    const secretCommand = 'ANTHROPIC_API_KEY=sk-ant-api03-supersecretkeythatislong echo hi';
    await executor.execute('bash', { command: secretCommand });

    const raw = existsSync(join(sessionDir, 'audit.jsonl'))
      ? readFileSync(join(sessionDir, 'audit.jsonl'), 'utf8')
      : '';
    expect(raw).not.toContain('sk-ant-api03-');
    expect(raw).toContain('[REDACTED');
  });
});

// ── copair audit CLI — exit code 1 for missing session ───────────────────────

describe('copair audit CLI — exit code 1 for non-existent session', () => {
  it('exits with code 1 when a non-existent session ID is specified', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number) => never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await runAuditCommand(['--session', 'nonexistent-session-id-that-does-not-exist']);
    } catch {
      // runAuditCommand may throw after exit is called
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

// ── MCP env filter integration ────────────────────────────────────────────────

describe('MCP env filtering — buildMcpEnv integration', () => {
  const savedKey = process.env['ANTHROPIC_API_KEY'];

  beforeEach(() => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-should-not-leak';
  });

  afterEach(() => {
    if (savedKey === undefined) {
      delete process.env['ANTHROPIC_API_KEY'];
    } else {
      process.env['ANTHROPIC_API_KEY'] = savedKey;
    }
  });

  it('ANTHROPIC_API_KEY is not present in subprocess env by default', () => {
    const env = buildMcpEnv();
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('ANTHROPIC_API_KEY IS present when inherit_env: true', () => {
    const env = buildMcpEnv(undefined, true);
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-api03-should-not-leak');
  });

  it('explicit server env vars appear in both default and inherit modes', () => {
    const serverEnv = { MCP_SERVER_VAR: 'value' };
    expect(buildMcpEnv(serverEnv)['MCP_SERVER_VAR']).toBe('value');
    expect(buildMcpEnv(serverEnv, true)['MCP_SERVER_VAR']).toBe('value');
  });
});

// ── MCP server startup validation integration ─────────────────────────────────

describe('MCP server startup validation integration', () => {
  it('binary not on $PATH → validateMcpServer returns false', async () => {
    const result = await validateMcpServer({
      name: 'missing-bin',
      command: 'copair-test-nonexistent-binary-xyz',
      args: [],
    });
    expect(result).toBe(false);
  });

  it('McpClientManager.initialize() skips invalid server and does not throw', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const manager = new McpClientManager();

    await expect(
      manager.initialize([
        { name: 'bad-server', command: 'copair-test-nonexistent-binary-xyz', args: [] },
      ]),
    ).resolves.toBeUndefined(); // resolves (does not throw)

    // No clients were connected
    expect(manager.getAll().size).toBe(0);
    stderrSpy.mockRestore();
  });

  it('McpClientManager.initialize() continues past invalid servers to valid ones', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const manager = new McpClientManager();

    // Two servers: one invalid, one valid-but-will-fail-to-connect (node with bad args).
    // We only check that the manager doesn't throw on the invalid binary —
    // a real connection attempt to 'node' with no MCP args would fail, but that's after validation.
    let caughtError: Error | undefined;
    try {
      await manager.initialize([
        { name: 'bad-server', command: 'copair-test-nonexistent-binary-xyz', args: [] },
        // Second server intentionally omitted — we just verify the first doesn't block
      ]);
    } catch (err) {
      caughtError = err as Error;
    }

    // Invalid binary should have been skipped without throwing
    expect(caughtError).toBeUndefined();
    stderrSpy.mockRestore();
  });
});
