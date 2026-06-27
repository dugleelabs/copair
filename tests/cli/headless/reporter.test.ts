/**
 * Unit tests — HeadlessReporter result-JSON assembly (spec 047, T-06 / T-14).
 *
 * Drives a real AgentBridge + TokenTracker through the reporter and asserts the
 * single JSON document written to stdout validates against the T-01 Zod schema,
 * counts tool calls / assistant turns correctly, and routes the error path to
 * `termination_reason: 'error'`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentBridge } from '../../../src/cli/ui/agent-bridge.js';
import { TokenTracker } from '../../../src/core/token-tracker.js';
import { HeadlessReporter } from '../../../src/cli/headless/reporter.js';
import { HeadlessResultSchema, type ResolvedConfig } from '../../../src/cli/headless/schema.js';

function resolvedConfig(): ResolvedConfig {
  return {
    model: 'mock-model',
    provider: 'mock',
    tier: 'large',
    formatter: 'native',
    toggles: {
      loop_guard: true,
      format_repair: true,
      inspect_before_act: true,
      truncation: true,
    },
    permissions: 'headless-terminate',
    limits: { max_tool_calls: null, max_tokens: null },
    config_sources: ['defaults'],
  };
}

/** Capture every chunk written to stdout; return the joined string. */
function captureStdout(): { read: () => string } {
  let buf = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    buf += String(chunk);
    return true;
  });
  return { read: () => buf };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HeadlessReporter.finish', () => {
  it('emits a single schema-valid JSON document to stdout', () => {
    const out = captureStdout();
    const bridge = new AgentBridge();
    const tracker = new TokenTracker();
    tracker.record(100, 50, 'mock-model', 'mock');

    const reporter = new HeadlessReporter(bridge, {
      tokenTracker: tracker,
      resolvedConfig: resolvedConfig(),
      taskSource: 'arg',
      cwd: '/tmp/run',
      sessionId: 'sess-1',
      eventsFile: null,
      quiet: true,
    });

    const result = reporter.finish('completed', null);

    const written = out.read();
    // Exactly one newline-terminated JSON document.
    expect(written.trimEnd().split('\n')).toHaveLength(1);
    const parsed = JSON.parse(written);
    expect(() => HeadlessResultSchema.parse(parsed)).not.toThrow();
    expect(parsed).toEqual(result);
    expect(parsed.termination_reason).toBe('completed');
    expect(parsed.usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      estimated_cost_usd: null, // mock-model has no pricing → cost 0 → null
    });
  });

  it('counts tool-start as tool calls and usage as assistant messages', () => {
    captureStdout();
    const bridge = new AgentBridge();
    const reporter = new HeadlessReporter(bridge, {
      tokenTracker: new TokenTracker(),
      resolvedConfig: resolvedConfig(),
      taskSource: 'stdin',
      cwd: '/tmp/run',
      sessionId: 'sess-2',
      eventsFile: null,
      quiet: true,
    });

    bridge.emit('tool-start', { name: 'bash', label: 'bash' });
    bridge.emit('tool-start', { name: 'read', label: 'read' });
    bridge.emit('usage', { inputTokens: 1, outputTokens: 1 });

    const result = reporter.finish('model-declared-done', null);
    expect(result.turns.tool_calls).toBe(2);
    expect(result.turns.assistant_messages).toBe(1);
  });

  it('routes a thrown error to termination_reason "error" with the message', () => {
    captureStdout();
    const reporter = new HeadlessReporter(new AgentBridge(), {
      tokenTracker: new TokenTracker(),
      resolvedConfig: resolvedConfig(),
      taskSource: 'arg',
      cwd: '/tmp/run',
      sessionId: 'sess-3',
      eventsFile: null,
      quiet: true,
    });

    const result = reporter.finish(null, new Error('provider blew up'));
    expect(result.termination_reason).toBe('error');
    expect(result.error).toEqual({ message: 'provider blew up' });
  });

  it('reflects events_file when an event stream is configured', () => {
    captureStdout();
    const reporter = new HeadlessReporter(new AgentBridge(), {
      tokenTracker: new TokenTracker(),
      resolvedConfig: resolvedConfig(),
      taskSource: 'file',
      cwd: '/tmp/run',
      sessionId: 'sess-4',
      eventsFile: '/tmp/events.jsonl',
      quiet: true,
    });
    const result = reporter.finish('completed', null);
    expect(result.events_file).toBe('/tmp/events.jsonl');
  });
});
