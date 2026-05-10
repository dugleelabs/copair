import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { WorkflowEngine } from '../../src/workflows/engine.js';
import type { WorkflowDefinition } from '../../src/workflows/interface.js';
import type { StepExecutors } from '../../src/workflows/steps.js';

// Minimal executors — agentRunner and commandRunner are no-ops for engine tests
function makeExecutors(overrides: Partial<StepExecutors> = {}): StepExecutors {
  return {
    agentRunner: vi.fn(async () => {}),
    commandRunner: vi.fn(async () => true),
    agentContext: {
      model: 'test-model',
      cwd: tmpdir(),
      branch: 'main',
      sessionId: 'test',
    } as never,
    ...overrides,
  };
}

// Build a minimal workflow definition
function makeWorkflow(steps: WorkflowDefinition['steps']): WorkflowDefinition {
  return { name: 'test', description: '', steps };
}

// ── F-17: on_max_iterations uses configured step id ───────────────────────────

describe('F-17 — on_max_iterations uses configured step id', () => {
  it('fires the configured step id (not hardcoded "report") when max iterations reached', async () => {
    const handlerCalled: string[] = [];
    const executors = makeExecutors({
      agentRunner: vi.fn(async (msg: string) => { handlerCalled.push(msg); }),
    });

    const workflow = makeWorkflow([
      {
        id: 'run-shell',
        type: 'shell',
        command: 'exit 1',
        capture: 'out',
        continue_on_error: true,
        max_iterations: '2',
        loop_until: '{{exit_code}} == 0',
        on_max_iterations: 'tests-still-failing',
      },
      {
        id: 'tests-still-failing',
        type: 'prompt',
        message: 'Still failing.',
      },
      { id: 'done', type: 'output', message: 'Done.' },
    ]);

    const engine = new WorkflowEngine(executors);
    await engine.execute(workflow);

    // agent should have been called once for the on_max_iterations handler
    expect(handlerCalled.length).toBe(1);
    expect(handlerCalled[0]).toBe('Still failing.');
  });

  it('still works when on_max_iterations is "report" (backward compat)', async () => {
    const handlerCalled: string[] = [];
    const executors = makeExecutors({
      agentRunner: vi.fn(async (msg: string) => { handlerCalled.push(msg); }),
    });

    const workflow = makeWorkflow([
      {
        id: 'run-shell',
        type: 'shell',
        command: 'exit 1',
        continue_on_error: true,
        max_iterations: '1',
        loop_until: '{{exit_code}} == 0',
        on_max_iterations: 'report',
      },
      {
        id: 'report',
        type: 'prompt',
        message: 'Report message.',
      },
    ]);

    const engine = new WorkflowEngine(executors);
    await engine.execute(workflow);

    expect(handlerCalled.length).toBe(1);
    expect(handlerCalled[0]).toBe('Report message.');
  });
});

// ── F-18: on_max_iterations step skipped when loop exits early ────────────────

describe('F-18 — on_max_iterations step skipped when loop exits early', () => {
  it('does NOT call the on_max_iterations handler when loop exits via loop_until', async () => {
    const handlerCalled: string[] = [];
    const executors = makeExecutors({
      agentRunner: vi.fn(async (msg: string) => { handlerCalled.push(msg); }),
    });

    // exit 0 on first attempt → loop_until satisfied → handler should not fire
    const workflow = makeWorkflow([
      {
        id: 'run-shell',
        type: 'shell',
        command: 'exit 0',
        continue_on_error: true,
        max_iterations: '3',
        loop_until: '{{exit_code}} == 0',
        on_max_iterations: 'still-failing',
      },
      {
        id: 'still-failing',
        type: 'prompt',
        message: 'Should not appear.',
      },
      { id: 'next', type: 'output', message: 'Reached next.' },
    ]);

    const engine = new WorkflowEngine(executors);
    await engine.execute(workflow);

    expect(handlerCalled.length).toBe(0);
  });

  it('skips the on_max_iterations step in sequential flow when loop exits early', async () => {
    const stepsReached: string[] = [];
    const executors = makeExecutors({
      agentRunner: vi.fn(async (msg: string) => { stepsReached.push(`prompt:${msg}`); }),
    });

    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderrLines.push(typeof chunk === 'string' ? chunk : '');
      return true;
    });

    const workflow = makeWorkflow([
      {
        id: 'run-shell',
        type: 'shell',
        command: 'exit 0',
        continue_on_error: true,
        max_iterations: '2',
        loop_until: '{{exit_code}} == 0',
        on_max_iterations: 'handler',
      },
      { id: 'handler', type: 'prompt', message: 'Handler.' },
      { id: 'after', type: 'output', message: 'After.' },
    ]);

    const engine = new WorkflowEngine(executors);
    await engine.execute(workflow);

    // handler step should appear as [skipped] in stderr
    const skippedLines = stderrLines.filter((l) => l.includes('handler') && l.includes('[skipped]'));
    expect(skippedLines.length).toBeGreaterThan(0);

    // handler prompt should NOT have been called
    expect(stepsReached.length).toBe(0);

    vi.restoreAllMocks();
  });

  it('fires on_max_iterations exactly once — not again via sequential flow', async () => {
    const handlerCalled: string[] = [];
    const executors = makeExecutors({
      agentRunner: vi.fn(async (msg: string) => { handlerCalled.push(msg); }),
    });

    // exit 1 on both attempts → handler fires once, then sequential step is skipped
    const workflow = makeWorkflow([
      {
        id: 'run-shell',
        type: 'shell',
        command: 'exit 1',
        continue_on_error: true,
        max_iterations: '2',
        loop_until: '{{exit_code}} == 0',
        on_max_iterations: 'handler',
      },
      { id: 'handler', type: 'prompt', message: 'Handler called.' },
      { id: 'after', type: 'output', message: 'After.' },
    ]);

    const engine = new WorkflowEngine(executors);
    await engine.execute(workflow);

    expect(handlerCalled.length).toBe(1);
  });

  it('continues at step after on_max_iterations in sequence', async () => {
    const outputMessages: string[] = [];

    // Spy on console.log for output steps
    vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      outputMessages.push(msg);
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const workflow = makeWorkflow([
      {
        id: 'run-shell',
        type: 'shell',
        command: 'exit 0',
        continue_on_error: true,
        max_iterations: '2',
        loop_until: '{{exit_code}} == 0',
        on_max_iterations: 'handler',
      },
      { id: 'handler', type: 'output', message: 'HANDLER' },
      { id: 'after', type: 'output', message: 'AFTER' },
    ]);

    const executors = makeExecutors();
    const engine = new WorkflowEngine(executors);
    await engine.execute(workflow);

    // handler is skipped (loop exited early), so AFTER should be reached
    expect(outputMessages).toContain('AFTER');
    expect(outputMessages).not.toContain('HANDLER');

    vi.restoreAllMocks();
  });
});

// ── F-19: skipped steps rendered for condition jumps ─────────────────────────

describe('F-19 — skipped steps rendered for condition jumps', () => {
  it('prints [skipped] for intermediate steps on a forward jump of 2+', async () => {
    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderrLines.push(typeof chunk === 'string' ? chunk : '');
      return true;
    });

    const workflow = makeWorkflow([
      { id: 'step-a', type: 'condition', if: '1 == 1', then: 'step-d', else: 'step-b' },
      { id: 'step-b', type: 'output', message: 'B' },
      { id: 'step-c', type: 'output', message: 'C' },
      { id: 'step-d', type: 'output', message: 'D' },
    ]);

    const executors = makeExecutors();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const engine = new WorkflowEngine(executors);
    await engine.execute(workflow);

    const skippedB = stderrLines.some((l) => l.includes('step-b') && l.includes('[skipped]'));
    const skippedC = stderrLines.some((l) => l.includes('step-c') && l.includes('[skipped]'));
    expect(skippedB).toBe(true);
    expect(skippedC).toBe(true);

    vi.restoreAllMocks();
  });

  it('does NOT print [skipped] for an adjacent forward jump', async () => {
    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderrLines.push(typeof chunk === 'string' ? chunk : '');
      return true;
    });

    // step-a jumps to step-b (adjacent) — nothing should be skipped
    const workflow = makeWorkflow([
      { id: 'step-a', type: 'condition', if: '1 == 1', then: 'step-b', else: 'step-b' },
      { id: 'step-b', type: 'output', message: 'B' },
    ]);

    const executors = makeExecutors();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const engine = new WorkflowEngine(executors);
    await engine.execute(workflow);

    const anySkipped = stderrLines.some((l) => l.includes('[skipped]'));
    expect(anySkipped).toBe(false);

    vi.restoreAllMocks();
  });

  it('does NOT print [skipped] for a backward jump (retry loop)', async () => {
    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderrLines.push(typeof chunk === 'string' ? chunk : '');
      return true;
    });

    let callCount = 0;
    // step-b jumps back to step-a twice, then to done
    const workflow = makeWorkflow([
      { id: 'step-a', type: 'output', message: 'A' },
      {
        id: 'step-b',
        type: 'condition',
        if: `${++callCount} == 99`,   // always false — use done sentinel
        then: 'done',
        else: 'done',
      },
    ]);

    const executors = makeExecutors();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const engine = new WorkflowEngine(executors);
    await engine.execute(workflow);

    const anySkipped = stderrLines.some((l) => l.includes('[skipped]'));
    expect(anySkipped).toBe(false);

    vi.restoreAllMocks();
  });
});
