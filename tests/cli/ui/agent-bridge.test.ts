import { describe, it, expect, vi } from 'vitest';
import { AgentBridge } from '../../../src/cli/ui/agent-bridge.js';
import type {
  ToolInfo,
  ToolCompleteInfo,
  TokenUsage,
  ApprovalRequest,
  ApprovalAnswer,
  DiffInfo,
} from '../../../src/cli/ui/agent-bridge.js';

describe('AgentBridge', () => {
  it('emits stream-text events', () => {
    const bridge = new AgentBridge();
    const handler = vi.fn();
    bridge.on('stream-text', handler);
    bridge.emit('stream-text', 'hello world');
    expect(handler).toHaveBeenCalledWith('hello world');
  });

  it('emits stream-code-block events', () => {
    const bridge = new AgentBridge();
    const handler = vi.fn();
    bridge.on('stream-code-block', handler);
    bridge.emit('stream-code-block', 'const x = 1;', 'typescript');
    expect(handler).toHaveBeenCalledWith('const x = 1;', 'typescript');
  });

  it('emits tool-start events with ToolInfo', () => {
    const bridge = new AgentBridge();
    const handler = vi.fn();
    bridge.on('tool-start', handler);
    const info: ToolInfo = { name: 'read', label: 'read: src/index.ts', input: { file_path: 'src/index.ts' } };
    bridge.emit('tool-start', info);
    expect(handler).toHaveBeenCalledWith(info);
  });

  it('emits tool-complete events with ToolCompleteInfo', () => {
    const bridge = new AgentBridge();
    const handler = vi.fn();
    bridge.on('tool-complete', handler);
    const info: ToolCompleteInfo = { name: 'read', label: 'read: src/index.ts', durationMs: 42, result: 'file contents' };
    bridge.emit('tool-complete', info);
    expect(handler).toHaveBeenCalledWith(info);
  });

  it('emits tool-denied events', () => {
    const bridge = new AgentBridge();
    const handler = vi.fn();
    bridge.on('tool-denied', handler);
    bridge.emit('tool-denied', { name: 'bash', label: 'bash: rm -rf /' });
    expect(handler).toHaveBeenCalledWith({ name: 'bash', label: 'bash: rm -rf /' });
  });

  it('emits approval-request events with respond callback', () => {
    const bridge = new AgentBridge();
    const handler = vi.fn();
    bridge.on('approval-request', handler);

    const respond = vi.fn();
    const request: ApprovalRequest = {
      toolName: 'bash',
      input: { command: 'npm test' },
      summary: 'bash: npm test',
      index: 0,
      total: 1,
    };
    bridge.emit('approval-request', request, respond);
    expect(handler).toHaveBeenCalledWith(request, respond);

    // Simulate UI responding
    const [, respondFn] = handler.mock.calls[0] as [ApprovalRequest, (answer: ApprovalAnswer) => void];
    respondFn('allow');
    expect(respond).toHaveBeenCalledWith('allow');
  });

  it('emits diff events', () => {
    const bridge = new AgentBridge();
    const handler = vi.fn();
    bridge.on('diff', handler);
    const diff: DiffInfo = {
      filePath: 'src/index.ts',
      hunks: [{ oldStart: 1, newStart: 1, lines: ['+hello'] }],
    };
    bridge.emit('diff', diff);
    expect(handler).toHaveBeenCalledWith(diff);
  });

  it('emits usage events with TokenUsage', () => {
    const bridge = new AgentBridge();
    const handler = vi.fn();
    bridge.on('usage', handler);
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
      cost: 0.01,
      sessionInputTokens: 500,
      sessionOutputTokens: 200,
      sessionCost: 0.05,
    };
    bridge.emit('usage', usage);
    expect(handler).toHaveBeenCalledWith(usage);
  });

  it('emits thinking-start and thinking-stop events', () => {
    const bridge = new AgentBridge();
    const startHandler = vi.fn();
    const stopHandler = vi.fn();
    bridge.on('thinking-start', startHandler);
    bridge.on('thinking-stop', stopHandler);
    bridge.emit('thinking-start');
    bridge.emit('thinking-stop');
    expect(startHandler).toHaveBeenCalledOnce();
    expect(stopHandler).toHaveBeenCalledOnce();
  });

  it('emits turn-complete events', () => {
    const bridge = new AgentBridge();
    const handler = vi.fn();
    bridge.on('turn-complete', handler);
    bridge.emit('turn-complete');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('emits error events with message string', () => {
    const bridge = new AgentBridge();
    const handler = vi.fn();
    bridge.on('error', handler);
    bridge.emit('error', 'something went wrong');
    expect(handler).toHaveBeenCalledWith('something went wrong');
  });

  it('emits input-request events with respond callback', () => {
    const bridge = new AgentBridge();
    const handler = vi.fn();
    bridge.on('input-request', handler);
    const respond = vi.fn();
    bridge.emit('input-request', respond);
    expect(handler).toHaveBeenCalledWith(respond);
  });

  it('supports multiple listeners on the same event', () => {
    const bridge = new AgentBridge();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    bridge.on('stream-text', handler1);
    bridge.on('stream-text', handler2);
    bridge.emit('stream-text', 'data');
    expect(handler1).toHaveBeenCalledWith('data');
    expect(handler2).toHaveBeenCalledWith('data');
  });

  it('removes listeners with off()', () => {
    const bridge = new AgentBridge();
    const handler = vi.fn();
    bridge.on('stream-text', handler);
    bridge.off('stream-text', handler);
    bridge.emit('stream-text', 'data');
    expect(handler).not.toHaveBeenCalled();
  });

  it('supports once() for single-fire listeners', () => {
    const bridge = new AgentBridge();
    const handler = vi.fn();
    bridge.once('stream-text', handler);
    bridge.emit('stream-text', 'first');
    bridge.emit('stream-text', 'second');
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith('first');
  });

  describe('approveAllForTurn', () => {
    it('defaults to false', () => {
      const bridge = new AgentBridge();
      expect(bridge.approveAllForTurn).toBe(false);
    });

    it('can be set to true', () => {
      const bridge = new AgentBridge();
      bridge.approveAllForTurn = true;
      expect(bridge.approveAllForTurn).toBe(true);
    });

    it('resets on resetTurn()', () => {
      const bridge = new AgentBridge();
      bridge.approveAllForTurn = true;
      bridge.resetTurn();
      expect(bridge.approveAllForTurn).toBe(false);
    });
  });

  it('propagates errors through error event without throwing', () => {
    const bridge = new AgentBridge();
    const handler = vi.fn();
    bridge.on('error', handler);

    // Should not throw
    bridge.emit('error', 'Network timeout');
    bridge.emit('error', 'API rate limit exceeded');

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, 'Network timeout');
    expect(handler).toHaveBeenNthCalledWith(2, 'API rate limit exceeded');
  });
});
