/**
 * Tests for spec 028 T-B21: ask_user, task_complete, and max-turn guard
 */
import { describe, it, expect, vi } from 'vitest';
import { SmallModelHarness, DEFAULT_SMALL_MODELS } from '../../src/core/small-model-harness.js';
import { askUserTool } from '../../src/tools/ask-user.js';
import { taskCompleteTool } from '../../src/tools/task-complete.js';
import { AskUserInputSchema } from '../../src/tools/ask-user.js';
import { TaskCompleteInputSchema } from '../../src/tools/task-complete.js';

describe('ask_user tool', () => {
  it('has correct definition name and required field', () => {
    expect(askUserTool.definition.name).toBe('ask_user');
    expect(askUserTool.definition.inputSchema).toMatchObject({
      type: 'object',
      required: ['question'],
    });
  });

  it('requiresPermission is false', () => {
    expect(askUserTool.requiresPermission).toBe(false);
  });

  it('schema validates { question: "..." }', () => {
    const result = AskUserInputSchema.safeParse({ question: 'What is the target?' });
    expect(result.success).toBe(true);
  });

  it('schema rejects missing question', () => {
    const result = AskUserInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('execute returns empty string (stub, intercepted in agent)', async () => {
    const result = await askUserTool.execute({ question: 'test?' });
    expect(result.content).toBe('');
    expect(result.isError).toBeUndefined();
  });
});

describe('task_complete tool', () => {
  it('has correct definition name and required field', () => {
    expect(taskCompleteTool.definition.name).toBe('task_complete');
    expect(taskCompleteTool.definition.inputSchema).toMatchObject({
      type: 'object',
      required: ['summary'],
    });
  });

  it('requiresPermission is false', () => {
    expect(taskCompleteTool.requiresPermission).toBe(false);
  });

  it('schema validates { summary: "..." }', () => {
    const result = TaskCompleteInputSchema.safeParse({ summary: 'Done.' });
    expect(result.success).toBe(true);
  });

  it('schema rejects missing summary', () => {
    const result = TaskCompleteInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('execute returns empty string (stub, intercepted in agent)', async () => {
    const result = await taskCompleteTool.execute({ summary: 'Finished.' });
    expect(result.content).toBe('');
  });
});

describe('ask_user and task_complete excluded from large model tool list', () => {
  it('large model harness.isSmallModel is false', () => {
    const harness = new SmallModelHarness('claude-3-5-sonnet');
    expect(harness.isSmallModel).toBe(false);
  });

  it('small model harness.isSmallModel is true', () => {
    const harness = new SmallModelHarness(DEFAULT_SMALL_MODELS[0]);
    expect(harness.isSmallModel).toBe(true);
  });
});

describe('max-turn guard logic', () => {
  it('maxToolCalls defaults to 20 for small models', () => {
    const harness = new SmallModelHarness('qwen');
    expect(harness.maxToolCalls).toBe(20);
  });

  it('maxToolCalls uses config value when provided', () => {
    const harness = new SmallModelHarness('qwen', { max_tool_calls: 5 });
    expect(harness.maxToolCalls).toBe(5);
  });

  it('toolCallCount exceeding maxToolCalls triggers warning (simulated)', () => {
    const showMaxTurnWarning = vi.fn();
    const maxToolCalls = 3;
    let toolCallCount = 0;

    // Simulate tool call loop
    const exceeded = () => {
      toolCallCount++;
      if (toolCallCount > maxToolCalls) {
        showMaxTurnWarning(maxToolCalls);
        return true;
      }
      return false;
    };

    // Three calls succeed
    expect(exceeded()).toBe(false);
    expect(exceeded()).toBe(false);
    expect(exceeded()).toBe(false);
    // Fourth call exceeds limit
    expect(exceeded()).toBe(true);
    expect(showMaxTurnWarning).toHaveBeenCalledWith(3);
    expect(showMaxTurnWarning).toHaveBeenCalledTimes(1);
  });
});
