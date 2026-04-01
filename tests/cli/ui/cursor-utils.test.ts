import { describe, it, expect } from 'vitest';
import { wordBoundaryLeft, wordBoundaryRight } from '../../../src/cli/ui/cursor-utils.js';

describe('wordBoundaryLeft', () => {
  it('from middle of word → jumps to word start', () => {
    // "hello world", cursor at 8 (inside "world")
    expect(wordBoundaryLeft('hello world', 8)).toBe(6);
  });

  it('from end of word → jumps to word start', () => {
    // "hello world", cursor at 11 (end of "world")
    expect(wordBoundaryLeft('hello world', 11)).toBe(6);
  });

  it('from start of word → skips whitespace then jumps to previous word start', () => {
    // "hello world", cursor at 6 (start of "world")
    expect(wordBoundaryLeft('hello world', 6)).toBe(0);
  });

  it('from middle of first word → jumps to position 0', () => {
    expect(wordBoundaryLeft('hello world', 3)).toBe(0);
  });

  it('from position 0 → stays at 0', () => {
    expect(wordBoundaryLeft('hello', 0)).toBe(0);
  });

  it('empty string → returns 0', () => {
    expect(wordBoundaryLeft('', 0)).toBe(0);
  });

  it('multiple spaces between words → skips all spaces', () => {
    // "foo   bar", cursor at 9 (end of "bar")
    expect(wordBoundaryLeft('foo   bar', 9)).toBe(6);
  });

  it('from middle of spaces → skips spaces then jumps to previous word start', () => {
    // "foo   bar", cursor at 5 (middle of spaces)
    expect(wordBoundaryLeft('foo   bar', 5)).toBe(0);
  });

  it('Unicode: emoji treated as single codepoint', () => {
    // "hi 👋 bye" spread: ['h','i',' ','👋',' ','b','y','e'] = 8 codepoints
    const str = 'hi \uD83D\uDC4B bye';
    const chars = [...str];
    expect(chars.length).toBe(8);
    // cursor at 8 (end of "bye") → start of "bye" at 5
    expect(wordBoundaryLeft(str, 8)).toBe(5);
  });

  it('cursor at 1 in single-char word → jumps to 0', () => {
    expect(wordBoundaryLeft('a b', 1)).toBe(0);
  });
});

describe('wordBoundaryRight', () => {
  it('from start of word → jumps to end of that word', () => {
    // "hello world", cursor at 0 → end of "hello" at 5
    expect(wordBoundaryRight('hello world', 0)).toBe(5);
  });

  it('from middle of word → jumps to end of current word', () => {
    // "hello world", cursor at 2 → end of "hello" at 5
    expect(wordBoundaryRight('hello world', 2)).toBe(5);
  });

  it('from end of word → skips whitespace then jumps to end of next word', () => {
    // "hello world", cursor at 5 → end of "world" at 11
    expect(wordBoundaryRight('hello world', 5)).toBe(11);
  });

  it('from end of string → stays at length', () => {
    expect(wordBoundaryRight('hello', 5)).toBe(5);
  });

  it('empty string → returns 0', () => {
    expect(wordBoundaryRight('', 0)).toBe(0);
  });

  it('multiple spaces between words → skips all spaces then the word', () => {
    // "foo   bar", cursor at 3 (after "foo") → end of "bar" at 9
    expect(wordBoundaryRight('foo   bar', 3)).toBe(9);
  });

  it('Unicode: emoji treated as single codepoint', () => {
    const str = 'hi \uD83D\uDC4B bye';
    // cursor at 0 → end of "hi" at 2
    expect(wordBoundaryRight(str, 0)).toBe(2);
    // cursor at 3 (on emoji) → end of emoji at 4
    expect(wordBoundaryRight(str, 3)).toBe(4);
  });

  it('single word, cursor at 0 → returns word length', () => {
    expect(wordBoundaryRight('hello', 0)).toBe(5);
  });

  it('trailing spaces → cursor lands at end of string', () => {
    // "hello   " cursor at 5 → skips spaces to 8
    expect(wordBoundaryRight('hello   ', 5)).toBe(8);
  });

  it('from end of word with trailing space → lands at end of string', () => {
    // "foo " cursor at 3 → skips trailing space to 4
    expect(wordBoundaryRight('foo ', 3)).toBe(4);
  });
});
