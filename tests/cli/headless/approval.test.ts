/**
 * Unit tests — headless approval policy + auto-approve safety (spec 047,
 * T-08 / T-08b / T-18).
 *
 * Two safety properties matter:
 *   1. `permissions.mode: headless-auto-approve` can NEVER come from a config
 *      file — auto-approve is a CLI-only, sandbox-scoped decision (design §8).
 *      The config schema enum structurally rejects it.
 *   2. A headless run can never block on an interactive callback: every
 *      callback-style bridge event is answered (terminate / abort / empty).
 *
 * Audit-attribution note (T-08 deviation): auto-approvals flow through the
 * existing approval gate, which logs `approved_by: 'auto'` (needs-approval) or
 * `'user'` (always-ask carve-outs). A distinct `headless-auto` attribution was
 * scoped out — see tasks.md T-08. These tests assert the *policy* (allow vs
 * deny), not the gate's attribution string.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentBridge, type ApprovalAnswer, type ApprovalRequest } from '../../../src/cli/ui/agent-bridge.js';
import {
  ApprovalTracker,
  installApprovalHandler,
  installNoHangPromptHandlers,
} from '../../../src/cli/headless/approval.js';
import { PermissionsConfigSchema } from '../../../src/config/schema.js';

afterEach(() => vi.restoreAllMocks());

const request: ApprovalRequest = {
  toolName: 'bash',
  input: { command: 'rm -rf /tmp/x' },
  summary: 'rm -rf /tmp/x',
  index: 0,
  total: 1,
};

describe('config schema — auto-approve cannot come from config (T-18)', () => {
  it('rejects permissions.mode: headless-auto-approve', () => {
    expect(() => PermissionsConfigSchema.parse({ mode: 'headless-auto-approve' })).toThrow();
  });

  it('accepts only the three sanctioned modes', () => {
    for (const mode of ['ask', 'auto-approve', 'deny']) {
      expect(() => PermissionsConfigSchema.parse({ mode })).not.toThrow();
    }
  });
});

describe('installApprovalHandler — terminate mode (default)', () => {
  it('denies every request, flags the tracker, and notifies onApprovalRequired', () => {
    const bridge = new AgentBridge();
    const tracker = new ApprovalTracker();
    const seen: string[] = [];
    installApprovalHandler(bridge, tracker, {
      autoApprove: false,
      onApprovalRequired: (tool) => seen.push(tool),
    });

    let answer: ApprovalAnswer | undefined;
    bridge.emit('approval-request', request, (a) => (answer = a));

    expect(answer).toBe('deny');
    expect(tracker.required).toBe(true);
    expect(seen).toEqual(['bash']);
  });
});

describe('installApprovalHandler — auto-approve mode', () => {
  it('answers "allow" per request and never flags approval-required', () => {
    const bridge = new AgentBridge();
    const tracker = new ApprovalTracker();
    const seen: string[] = [];
    installApprovalHandler(bridge, tracker, {
      autoApprove: true,
      onApprovalRequired: (tool) => seen.push(tool),
    });

    let answer: ApprovalAnswer | undefined;
    bridge.emit('approval-request', request, (a) => (answer = a));

    // 'allow' (not 'all') is the only answer that covers always-ask carve-outs.
    expect(answer).toBe('allow');
    expect(tracker.required).toBe(false);
    expect(seen).toEqual([]);
  });
});

describe('installNoHangPromptHandlers — no callback can block (T-08b)', () => {
  it('aborts on a context-limit decision (never compacts)', () => {
    const bridge = new AgentBridge();
    installNoHangPromptHandlers(bridge);
    let action: 'compact' | 'abort' | undefined;
    bridge.emit('context-limit-action', (a) => (action = a));
    expect(action).toBe('abort');
  });

  it('answers an interactive input-request with empty string and notes it on stderr', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const bridge = new AgentBridge();
    installNoHangPromptHandlers(bridge);
    let input: string | undefined;
    bridge.emit('input-request', 'What is your name?', (i) => (input = i));
    expect(input).toBe('');
    expect(stderr).toHaveBeenCalled();
  });
});
