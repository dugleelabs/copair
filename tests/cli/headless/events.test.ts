/**
 * Unit tests — EventSink mechanism-event JSONL stream (spec 047, T-09 / T-14).
 *
 * Asserts the sink writes valid, monotonic-seq JSONL; that `tool_call_parsed`
 * is recorded for both valid and invalid parses (the 048 validity denominator);
 * and that no tool inputs / file contents ever leak into the stream (design §8).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBridge } from '../../../src/cli/ui/agent-bridge.js';
import { EventSink } from '../../../src/cli/headless/events.js';
import { HeadlessEventSchema, type HeadlessEvent } from '../../../src/cli/headless/schema.js';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'copair-events-'));
  path = join(dir, 'events.jsonl');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Read the JSONL file and validate every line against the event schema. */
function readEvents(): HeadlessEvent[] {
  const lines = readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean);
  return lines.map((line) => HeadlessEventSchema.parse(JSON.parse(line)));
}

describe('EventSink', () => {
  it('writes valid JSONL with monotonic seq and v:1 on every line', () => {
    const bridge = new AgentBridge();
    const sink = new EventSink(path);
    sink.attach(bridge);

    bridge.emit('usage', { inputTokens: 10, outputTokens: 5 });
    bridge.emit('tool-start', { name: 'bash', label: 'bash echo' });
    bridge.emit('tool-complete', { name: 'bash', label: 'bash echo' });
    sink.runTerminated('completed');

    const events = readEvents();
    // seq is strictly monotonic from 0.
    events.forEach((e, i) => {
      expect(e.seq).toBe(i);
      expect(e.v).toBe(1);
      expect(typeof e.ts).toBe('string');
    });
    // A usage event opens turn 0 then records usage.
    expect(events.map((e) => e.event)).toEqual([
      'turn_started',
      'usage',
      'tool_started',
      'tool_completed',
      'turn_completed', // runTerminated closes the open turn first
      'run_terminated',
    ]);
  });

  it('records tool_call_parsed for both valid and invalid parses', () => {
    const bridge = new AgentBridge();
    const sink = new EventSink(path);
    sink.attach(bridge);

    bridge.emit('tool-call-parsed', { valid: true, formatter: 'dsml', tool: 'bash' });
    bridge.emit('tool-call-parsed', { valid: false, formatter: 'dsml' });
    bridge.emit('tool-call-parsed', { valid: true, formatter: 'native', tool: 'read' });

    const parsed = readEvents().filter((e) => e.event === 'tool_call_parsed');
    expect(parsed).toHaveLength(3);
    expect(parsed.map((e) => (e.event === 'tool_call_parsed' ? e.valid : null))).toEqual([
      true,
      false,
      true,
    ]);
  });

  it('maps the three truncation events to output_truncated with the tool tag', () => {
    const bridge = new AgentBridge();
    const sink = new EventSink(path);
    sink.attach(bridge);

    bridge.emit('bash-truncated', { label: 'stdout', originalTokens: 5000 });
    bridge.emit('read-overflow', { filePath: '/secret/file.ts', lineCount: 9000 });
    bridge.emit('grep-overflow', { pattern: 'TOPSECRET', maxResults: 50 });

    const trunc = readEvents().filter((e) => e.event === 'output_truncated');
    expect(trunc.map((e) => (e.event === 'output_truncated' ? e.tool : null))).toEqual([
      'bash',
      'read',
      'grep',
    ]);
  });

  it('never leaks tool inputs or file contents into the stream (design §8)', () => {
    const bridge = new AgentBridge();
    const sink = new EventSink(path);
    sink.attach(bridge);

    // Emit events whose payloads carry secrets that MUST be dropped.
    bridge.emit('read-overflow', { filePath: '/secret/file.ts', lineCount: 9000 });
    bridge.emit('grep-overflow', { pattern: 'AKIA-SECRET-KEY', maxResults: 50 });
    bridge.emit('tool-start', { name: 'bash', label: 'bash rm -rf /private/secret' });
    sink.runTerminated('completed');

    const raw = readFileSync(path, 'utf-8');
    expect(raw).not.toContain('/secret/file.ts');
    expect(raw).not.toContain('AKIA-SECRET-KEY');
    // tool_started carries only the tool name, never the label/args.
    expect(raw).not.toContain('rm -rf');
  });

  it('truncates a pre-existing file so each run starts clean', () => {
    const bridge1 = new AgentBridge();
    const sink1 = new EventSink(path);
    sink1.attach(bridge1);
    bridge1.emit('usage', { inputTokens: 1, outputTokens: 1 });
    sink1.runTerminated('completed');
    const firstCount = readEvents().length;
    expect(firstCount).toBeGreaterThan(0);

    // A new sink on the same path resets seq to 0 and wipes prior lines.
    const bridge2 = new AgentBridge();
    const sink2 = new EventSink(path);
    sink2.attach(bridge2);
    sink2.runTerminated('aborted');

    const events = readEvents();
    expect(events[0].seq).toBe(0);
    expect(events.at(-1)?.event).toBe('run_terminated');
  });
});
