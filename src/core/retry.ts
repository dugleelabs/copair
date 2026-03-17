export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('rate limit') || msg.includes('429')) return true;
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return true;
    if (msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('etimedout')) return true;
    if (msg.includes('fetch failed') || msg.includes('network')) return true;
  }

  if (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    const status = (error as { status: number }).status;
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
  }

  return false;
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = { maxRetries: 3, baseDelayMs: 1000 },
): Promise<T> {
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryableError(error) || attempt === opts.maxRetries) {
        throw error;
      }
      const delay = opts.baseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}
