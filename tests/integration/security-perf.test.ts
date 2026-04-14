/**
 * NFR-01 Performance verification (T-22).
 *
 * Verifies that the security overhead added by ToolExecutor
 * (schema validation + gate check + path guard + redaction) stays
 * below the 5ms p99 budget per tool call.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { ToolExecutor } from '../../src/core/tool-executor.js';
import { ApprovalGate } from '../../src/core/approval-gate.js';
import { PathGuard } from '../../src/core/path-guard.js';
import type { Tool, ToolResult } from '../../src/tools/interface.js';
import type { ToolRegistry } from '../../src/tools/registry.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

let projectRoot: string;
let executor: ToolExecutor;
let filePath: string;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

function makeRegistry(...tools: Tool[]): ToolRegistry {
  const map = new Map(tools.map((t) => [t.definition.name, t]));
  return { get: (name: string) => map.get(name) } as unknown as ToolRegistry;
}

function makeTool(name: string, result: ToolResult): Tool {
  return {
    definition: {
      name,
      description: 'perf-test tool',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    inputSchema: undefined,
    requiresPermission: false,
    execute: vi.fn().mockResolvedValue(result),
  };
}

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'copair-perf-'));
  execSync('git init -q', { cwd: projectRoot });
  filePath = join(projectRoot, 'sample.ts');
  writeFileSync(filePath, 'export const x = 1;');

  const gate = new ApprovalGate('auto-approve');
  const guard = new PathGuard(projectRoot);

  const readTool = makeTool('read', { content: 'export const x = 1;', isError: false });
  const writeTool = makeTool('write', { content: 'ok', isError: false });

  executor = new ToolExecutor(makeRegistry(readTool, writeTool), gate, guard);

  // Suppress output during perf runs
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  stderrSpy?.mockRestore();
  stdoutSpy?.mockRestore();
});

// ── Benchmark ─────────────────────────────────────────────────────────────────

describe('NFR-01: ToolExecutor security overhead < 5ms p99', () => {
  it('100 mixed read/write tool calls have p99 per-call overhead under 5ms', async () => {
    const ITERATIONS = 100;
    const WARMUP = 10;
    // Windows CI runners exhibit higher timing variance (filesystem and
    // process-scheduler overhead), so allow a larger budget there.
    const P99_BUDGET_MS = process.platform === 'win32' ? 15 : 5;

    // Warm-up: prime JIT, module caches, path resolution
    for (let i = 0; i < WARMUP; i++) {
      await executor.execute('read', { file_path: filePath });
    }

    // Measure 100 iterations (alternating read / write-like calls)
    const durations: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      if (i % 2 === 0) {
        await executor.execute('read', { file_path: filePath });
      } else {
        await executor.execute('write', { file_path: filePath, content: 'x' });
      }
      durations.push(performance.now() - start);
    }

    // Compute p99
    durations.sort((a, b) => a - b);
    const p99 = durations[Math.ceil(ITERATIONS * 0.99) - 1]!;
    const p50 = durations[Math.ceil(ITERATIONS * 0.50) - 1]!;
    const max = durations[ITERATIONS - 1]!;

    // Log for visibility in test output
    console.log(
      `[perf] ToolExecutor overhead — p50: ${p50.toFixed(2)}ms  p99: ${p99.toFixed(2)}ms  max: ${max.toFixed(2)}ms`,
    );

    expect(p99).toBeLessThan(P99_BUDGET_MS);
  });
});
