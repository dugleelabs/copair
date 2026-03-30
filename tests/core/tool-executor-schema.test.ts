import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { ToolExecutor } from '../../src/core/tool-executor.js';
import { PathGuard } from '../../src/core/path-guard.js';
import type { Tool, ToolResult } from '../../src/tools/interface.js';
import type { ToolRegistry } from '../../src/tools/registry.js';
import type { ApprovalGate } from '../../src/core/approval-gate.js';

// ── Minimal fakes ────────────────────────────────────────────────────────────

function makeRegistry(tool: Tool): ToolRegistry {
  return {
    get: (name: string) => (name === tool.definition.name ? tool : undefined),
  } as unknown as ToolRegistry;
}

function makeGate(allow = true): ApprovalGate {
  return {
    allow: vi.fn().mockResolvedValue(allow),
    isTrustedPath: vi.fn().mockReturnValue(false),
  } as unknown as ApprovalGate;
}

/** A PathGuard that approves every path (avoids filesystem deps in unit tests). */
function makePermissiveGuard(): PathGuard {
  const guard = new PathGuard(process.cwd());
  vi.spyOn(guard, 'check').mockReturnValue({ allowed: true, resolvedPath: '/project/file.ts' });
  return guard;
}

function makeTool(name: string, schema?: z.ZodTypeAny): Tool {
  return {
    definition: {
      name,
      description: 'test tool',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    inputSchema: schema,
    requiresPermission: false,
    execute: vi.fn().mockResolvedValue({ content: 'ok', isError: false } as ToolResult),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ToolExecutor — Zod schema validation (FR-02)', () => {
  let gate: ApprovalGate;
  let guard: PathGuard;

  beforeEach(() => {
    gate = makeGate(true);
    guard = makePermissiveGuard();
  });

  it('passes valid input through — tool executes normally', async () => {
    const schema = z.object({ file_path: z.string().min(1) }).strict();
    const tool = makeTool('read', schema);
    const executor = new ToolExecutor(makeRegistry(tool), gate, guard);

    const result = await executor.execute('read', { file_path: '/project/src/index.ts' });
    expect(result.isError).toBeFalsy();
    expect(tool.execute).toHaveBeenCalled();
  });

  it('rejects missing required field — isError: true, tool NOT executed', async () => {
    const schema = z.object({ file_path: z.string().min(1) }).strict();
    const tool = makeTool('read', schema);
    const executor = new ToolExecutor(makeRegistry(tool), gate, guard);

    const result = await executor.execute('read', {});
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/file_path/);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('rejects wrong field type — number where string expected', async () => {
    const schema = z.object({ file_path: z.string() }).strict();
    const tool = makeTool('read', schema);
    const executor = new ToolExecutor(makeRegistry(tool), gate, guard);

    const result = await executor.execute('read', { file_path: 42 });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/file_path/);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('rejects extra unknown fields in strict mode', async () => {
    const schema = z.object({ file_path: z.string() }).strict();
    const tool = makeTool('read', schema);
    const executor = new ToolExecutor(makeRegistry(tool), gate, guard);

    const result = await executor.execute('read', { file_path: '/project/f.ts', injected: 'evil' });
    expect(result.isError).toBe(true);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('does not reject MCP tool with no inputSchema (passthrough)', async () => {
    const mcpTool = makeTool('mcp:some_tool', undefined); // no zodSchema
    const executor = new ToolExecutor(makeRegistry(mcpTool), gate, guard);

    const result = await executor.execute('mcp:some_tool', { anything: 'goes', extra: true });
    expect(result.isError).toBeFalsy();
    expect(mcpTool.execute).toHaveBeenCalled();
  });

  it('returns error for unknown tool name', async () => {
    const tool = makeTool('read');
    const executor = new ToolExecutor(makeRegistry(tool), gate, guard);

    const result = await executor.execute('nonexistent', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('nonexistent');
  });

  it('schema rejection fires before approval gate is checked', async () => {
    const schema = z.object({ file_path: z.string() }).strict();
    const tool = makeTool('write', schema);
    const gateAllowSpy = vi.fn().mockResolvedValue(true);
    const strictGate = { allow: gateAllowSpy, isTrustedPath: vi.fn().mockReturnValue(false) } as unknown as ApprovalGate;
    const executor = new ToolExecutor(makeRegistry(tool), strictGate, guard);

    const result = await executor.execute('write', {}); // missing file_path
    expect(result.isError).toBe(true);
    expect(gateAllowSpy).not.toHaveBeenCalled();
  });

  it('returns denied result when approval gate denies', async () => {
    const schema = z.object({ command: z.string() }).strict();
    const tool = makeTool('bash', schema);
    const denyGate = makeGate(false);
    const executor = new ToolExecutor(makeRegistry(tool), denyGate, guard);

    const result = await executor.execute('bash', { command: 'rm -rf /' });
    expect(result.denied).toBe(true);
    expect(tool.execute).not.toHaveBeenCalled();
  });
});
