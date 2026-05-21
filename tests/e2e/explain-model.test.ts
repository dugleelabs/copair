/**
 * E2E tests for spec 029 `--explain-model` CLI flag (T-C03).
 *
 * Spawns the real copair binary against the dist build (consistent with
 * `tests/e2e/cli.test.ts`). Requires `pnpm build` to have run.
 *
 * Cases covered:
 *   - Known family (e.g. claude-opus-4-7) prints sensible trace
 *   - Unknown model → UnknownModelError + did-you-mean, exit 1 (spec 029 F-11)
 *   - --json flag emits single-line valid JSON
 *   - Missing argument → exit 1 with helpful stderr
 *   - Cross-host normalization works (Bedrock-prefixed input)
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError, z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(__dirname, '../../dist/index.js');

function run(args: string[]) {
  return spawnSync('node', [BIN, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env },
  });
}

// Mirror the ResolvedCapabilities shape from src/core/model-capabilities.ts —
// re-declared here as a Zod schema so the JSON output is validated explicitly.
// This catches both "JSON is malformed" and "shape drifted from contract."
const ResolvedCapabilitiesSchema = z.object({
  modelId: z.string(),
  normalizedId: z.string(),
  tier: z.object({
    value: z.enum(['small', 'large']),
    source: z.enum(['classifier', 'shipped-data', 'override']),
  }),
  preferred_format: z.object({
    value: z.enum(['qwen-xml', 'dsml', 'fenced-block', 'native']),
    source: z.enum(['family-prefix', 'shipped-data', 'override']),
  }),
  overrideApplied: z.unknown().nullable(),
  finalCapabilities: z.object({
    tier: z.enum(['small', 'large']),
    context_window: z.number().int().positive(),
    max_tokens: z.number().int().positive(),
    native_tool_calling: z.enum(['reliable', 'unreliable', 'none']),
    preferred_format: z.enum(['qwen-xml', 'dsml', 'fenced-block', 'native']),
    recommended_harness: z.object({
      enable_small_model_harness: z.boolean(),
      max_turns: z.number().int().positive(),
      max_tool_calls: z.number().int().positive().optional(),
      inject_format_reminder_every_turn: z.boolean(),
    }),
  }),
});

describe('--explain-model — pretty output', () => {
  it('prints a trace for a known frontier model and exits 0', () => {
    const { status, stdout } = run(['--explain-model', 'claude-opus-4-7']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/Model ID:\s+claude-opus-4-7/);
    expect(stdout).toMatch(/Tier:\s+large\s+\(source: classifier\)/);
    expect(stdout).toMatch(/Preferred format:\s+native\s+\(source: family-prefix\)/);
    expect(stdout).toMatch(/User override applied: none/);
  });

  it('exits 1 with structured UnknownModelError + did-you-mean for an unknown ID (spec 029 F-11)', () => {
    const { status, stdout, stderr } = run(['--explain-model', 'some-totally-fake-model-id']);
    expect(status).toBe(1);
    // No fabricated trace — design §17.4 prohibits printing safe-default-based output.
    expect(stdout).toBe('');
    // Structured error on stderr with the model ID and docs link.
    expect(stderr).toMatch(/Unknown model "some-totally-fake-model-id"/);
    expect(stderr).toMatch(/model_overrides/);
    expect(stderr).toMatch(/docs\.copair\.dev\/custom-and-local-models/);
  });

  it('handles Bedrock-prefixed model IDs via normalization', () => {
    const { status, stdout } = run(['--explain-model', 'qwen.qwen3-coder-480b-a35b-v1:0']);
    expect(status).toBe(0);
    // After normalization, this should match a Qwen family prefix
    expect(stdout).toMatch(/Preferred format:\s+qwen-xml/);
    expect(stdout).toMatch(/Normalized ID:\s+qwen3-coder-480b-a35b-v1-0/);
  });
});

describe('--explain-model --json', () => {
  it('emits single-line valid JSON conforming to ResolvedCapabilities shape', () => {
    const { status, stdout } = run(['--explain-model', 'claude-opus-4-7', '--json']);
    expect(status).toBe(0);

    // Output should be exactly one line of JSON (plus trailing newline)
    const trimmed = stdout.trim();
    expect(trimmed.split('\n')).toHaveLength(1);

    // JSON parses
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`Failed to parse JSON output:\n${trimmed}\nError: ${(err as Error).message}`);
    }

    // Shape validates against the contract
    try {
      ResolvedCapabilitiesSchema.parse(parsed);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(`JSON shape does not match ResolvedCapabilities: ${err.message}`);
      }
      throw err;
    }
  });

  it('--json + unknown model still errors out (does NOT emit a fabricated JSON trace)', () => {
    // Pre-F-11 this returned a safe-default JSON trace. Now it errors with
    // the structured message on stderr — the --json flag does not relax the
    // strict-unknowns guard.
    const { status, stdout, stderr } = run(['--explain-model', 'unknown-2099', '--json']);
    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/Unknown model "unknown-2099"/);
  });
});

describe('--explain-model — error handling', () => {
  it('exits 1 with a helpful message when the model-ID argument is empty', () => {
    // commander treats `--explain-model` with no value as missing-argument.
    // The exact exit code is commander's default for arg errors (typically 1).
    const { status, stderr } = run(['--explain-model']);
    expect(status).not.toBe(0);
    expect(stderr.length).toBeGreaterThan(0);
  });
});
