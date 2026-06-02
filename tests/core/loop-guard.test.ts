/**
 * Spec 029 F-13 — LoopGuard unit tests (T-H05).
 *
 * Covers the result-aware tool-call loop guard:
 *   - Continue on first call, and when subsequent calls differ.
 *   - Nudge on 2nd identical (tool, args, result) tuple.
 *   - Halt on 3rd identical tuple.
 *   - reset() clears the deque.
 *   - canonicalJson sorts keys so {a:1,b:2} hashes identical to {b:2,a:1}.
 *   - Bounded memory: deque holds at most 3 tuples.
 *   - Identical results from different args don't trip a repeat (and vice versa).
 */
import { describe, it, expect } from 'vitest';
import { LoopGuard, canonicalJson } from '../../src/core/loop-guard.js';

describe('LoopGuard — basic behavior', () => {
  it('returns continue on the very first call', () => {
    const g = new LoopGuard();
    const action = g.observe('read', { file_path: '/a' }, 'contents');
    expect(action.kind).toBe('continue');
  });

  it('returns continue when args or result differ between calls', () => {
    const g = new LoopGuard();
    expect(g.observe('read', { file_path: '/a' }, 'A').kind).toBe('continue');
    expect(g.observe('read', { file_path: '/b' }, 'B').kind).toBe('continue');
    expect(g.observe('read', { file_path: '/a' }, 'A2').kind).toBe('continue');
  });

  it('nudges on the 2nd identical tuple', () => {
    const g = new LoopGuard();
    g.observe('grep', { pattern: 'foo' }, 'no match');
    const action = g.observe('grep', { pattern: 'foo' }, 'no match');
    expect(action.kind).toBe('nudge');
    if (action.kind === 'nudge') {
      expect(action.message).toMatch(/grep/);
      expect(action.message).toMatch(/different approach|task_complete/);
    }
  });

  it('halts on the 3rd identical tuple', () => {
    const g = new LoopGuard();
    g.observe('grep', { pattern: 'foo' }, 'no match');
    g.observe('grep', { pattern: 'foo' }, 'no match');
    const action = g.observe('grep', { pattern: 'foo' }, 'no match');
    expect(action.kind).toBe('halt');
    if (action.kind === 'halt') {
      expect(action.reason).toMatch(/grep/);
      expect(action.reason).toMatch(/3 times/);
    }
  });

  it('halts again on a 4th identical tuple (stays halted, does not reset)', () => {
    const g = new LoopGuard();
    g.observe('bash', { command: 'ls' }, 'out');
    g.observe('bash', { command: 'ls' }, 'out');
    g.observe('bash', { command: 'ls' }, 'out');
    const fourth = g.observe('bash', { command: 'ls' }, 'out');
    expect(fourth.kind).toBe('halt');
  });
});

describe('LoopGuard — reset()', () => {
  it('clears state so a fresh sequence starts at continue', () => {
    const g = new LoopGuard();
    g.observe('read', { file_path: '/a' }, 'X');
    g.observe('read', { file_path: '/a' }, 'X'); // would nudge
    g.reset();
    const action = g.observe('read', { file_path: '/a' }, 'X');
    expect(action.kind).toBe('continue');
  });

  it('reset between identical sequences requires fresh 2 repeats to nudge', () => {
    const g = new LoopGuard();
    g.observe('read', { file_path: '/a' }, 'X');
    g.observe('read', { file_path: '/a' }, 'X');
    g.observe('read', { file_path: '/a' }, 'X'); // halt
    g.reset();
    expect(g.observe('read', { file_path: '/a' }, 'X').kind).toBe('continue');
    expect(g.observe('read', { file_path: '/a' }, 'X').kind).toBe('nudge');
  });
});

describe('LoopGuard — interleaved different calls reset consecutive count', () => {
  it('one different call between repeats breaks the consecutive sequence', () => {
    const g = new LoopGuard();
    g.observe('grep', { pattern: 'foo' }, 'no match'); // first
    g.observe('read', { file_path: '/x' }, 'data'); // breaks consecutive
    const action = g.observe('grep', { pattern: 'foo' }, 'no match'); // 2nd grep, but not consecutive
    expect(action.kind).toBe('continue');
  });

  it('different args for same tool name do not count as repeat', () => {
    const g = new LoopGuard();
    g.observe('grep', { pattern: 'foo' }, 'no match');
    const action = g.observe('grep', { pattern: 'bar' }, 'no match');
    expect(action.kind).toBe('continue');
  });

  it('same args/tool but different result does not count as repeat', () => {
    const g = new LoopGuard();
    g.observe('bash', { command: 'date' }, '2026-05-22 02:00');
    const action = g.observe('bash', { command: 'date' }, '2026-05-22 02:01');
    expect(action.kind).toBe('continue');
  });
});

describe('LoopGuard — argument ordering is stable (canonicalJson)', () => {
  it('{a:1, b:2} and {b:2, a:1} hash to the same tuple', () => {
    const g = new LoopGuard();
    g.observe('tool', { a: 1, b: 2 }, 'result');
    const action = g.observe('tool', { b: 2, a: 1 }, 'result');
    expect(action.kind).toBe('nudge');
  });

  it('nested object key order does not affect hashing', () => {
    const g = new LoopGuard();
    g.observe('tool', { outer: { x: 1, y: 2 } }, 'result');
    const action = g.observe('tool', { outer: { y: 2, x: 1 } }, 'result');
    expect(action.kind).toBe('nudge');
  });

  it('array order does affect hashing (arrays are positional)', () => {
    const g = new LoopGuard();
    g.observe('tool', { items: [1, 2, 3] }, 'result');
    const action = g.observe('tool', { items: [3, 2, 1] }, 'result');
    expect(action.kind).toBe('continue');
  });
});

describe('canonicalJson — direct unit tests', () => {
  it('serializes primitives like JSON.stringify', () => {
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('hello')).toBe('"hello"');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
  });

  it('sorts object keys alphabetically', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('handles nested objects + arrays', () => {
    expect(canonicalJson({ b: [1, 2], a: { y: 1, x: 2 } })).toBe(
      '{"a":{"x":2,"y":1},"b":[1,2]}',
    );
  });
});

describe('LoopGuard — robustness', () => {
  it('handles empty result strings', () => {
    const g = new LoopGuard();
    g.observe('read', { file_path: '/a' }, '');
    g.observe('read', { file_path: '/a' }, '');
    const action = g.observe('read', { file_path: '/a' }, '');
    expect(action.kind).toBe('halt');
  });

  it('handles very large result strings without retaining them in memory', () => {
    // The deque only retains hashes, not the raw results. This test mostly
    // exercises that the SHA-256 path doesn't fall over on big inputs.
    const big = 'x'.repeat(5_000_000); // 5MB
    const g = new LoopGuard();
    g.observe('bash', { command: 'cat huge' }, big);
    g.observe('bash', { command: 'cat huge' }, big);
    const action = g.observe('bash', { command: 'cat huge' }, big);
    expect(action.kind).toBe('halt');
  });

  it('null/undefined args are handled cleanly', () => {
    const g = new LoopGuard();
    g.observe('tool', null, 'x');
    g.observe('tool', null, 'x');
    expect(g.observe('tool', null, 'x').kind).toBe('halt');
  });

  it('observing an arg shape with BigInt does not throw — gracefully degrades to continue', () => {
    const g = new LoopGuard();
    const args = { value: BigInt(123) } as unknown;
    // Should not throw; falls back to a per-call sentinel hash that won't
    // match any subsequent call, effectively skipping the guard.
    expect(() => g.observe('tool', args, 'r1')).not.toThrow();
    expect(() => g.observe('tool', args, 'r1')).not.toThrow();
    expect(g.observe('tool', args, 'r1').kind).toBe('continue');
  });
});
