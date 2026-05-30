export interface RetryOptions {
  /** Number of retries after the first attempt (total attempts = retries + 1). */
  retries: number;
  isRetryable: (err: unknown) => boolean;
  /** Injectable sleep (default real setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  /** Base backoff; delay = baseMs * 2^attempt. */
  baseMs?: number;
}

/** Retry `fn` with exponential backoff while `isRetryable` holds. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const baseMs = opts.baseMs ?? 500;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= opts.retries || !opts.isRetryable(err)) throw err;
      await sleep(baseMs * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

/** Heuristic: is this LLM/network error worth retrying (transient)? */
export function isTransientLLMError(err: unknown): boolean {
  const s = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /\b(429|500|502|503|504)\b|rate.?limit|timeout|timed out|etimedout|econnreset|econnrefused|enotfound|overloaded|temporarily|unavailable|socket hang up/.test(
    s,
  );
}
