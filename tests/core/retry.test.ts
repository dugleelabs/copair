import { describe, it, expect, vi } from 'vitest';
import { withRetry, isRetryableError } from '../../src/core/retry.js';

describe('isRetryableError', () => {
  it('identifies 429 rate limit as retryable', () => {
    const err = Object.assign(new Error('Rate limited'), { status: 429 });
    expect(isRetryableError(err)).toBe(true);
  });

  it('identifies 500+ as retryable', () => {
    expect(isRetryableError({ status: 500 })).toBe(true);
    expect(isRetryableError({ status: 502 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
  });

  it('identifies connection errors as retryable', () => {
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
  });

  it('identifies 401 as non-retryable', () => {
    expect(isRetryableError({ status: 401 })).toBe(false);
  });

  it('identifies 403 as non-retryable', () => {
    expect(isRetryableError({ status: 403 })).toBe(false);
  });

  it('identifies generic errors as non-retryable', () => {
    expect(isRetryableError(new Error('Invalid API key'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries on retryable error and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate limit'), { status: 429 }))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable error', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }));

    await expect(
      withRetry(fn, { maxRetries: 3, baseDelayMs: 1 }),
    ).rejects.toThrow('Unauthorized');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('throws after max retries exhausted', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('rate limit'), { status: 429 }));

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1 }),
    ).rejects.toThrow('rate limit');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
