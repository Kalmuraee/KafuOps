import { describe, it, expect } from 'vitest';
import { withRetry, isTransientLLMError } from '../src/util/retry.js';

const noSleep = async () => {};

describe('withRetry', () => {
  it('succeeds after transient failures', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('429 rate limited');
        return 'ok';
      },
      { retries: 3, isRetryable: isTransientLLMError, sleep: noSleep },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry a non-retryable error', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('schema validation failed');
        },
        { retries: 3, isRetryable: isTransientLLMError, sleep: noSleep },
      ),
    ).rejects.toThrow(/schema/);
    expect(calls).toBe(1);
  });

  it('gives up after exhausting retries', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('503 unavailable');
        },
        { retries: 2, isRetryable: isTransientLLMError, sleep: noSleep },
      ),
    ).rejects.toThrow(/503/);
    expect(calls).toBe(3); // 1 + 2 retries
  });
});

describe('isTransientLLMError', () => {
  it('flags rate limits, 5xx, timeouts, connection resets', () => {
    expect(isTransientLLMError(new Error('HTTP 429 Too Many Requests'))).toBe(true);
    expect(isTransientLLMError(new Error('503 Service Unavailable'))).toBe(true);
    expect(isTransientLLMError(new Error('socket hang up'))).toBe(true);
    expect(isTransientLLMError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isTransientLLMError(new Error('overloaded_error'))).toBe(true);
  });
  it('does not flag deterministic errors', () => {
    expect(isTransientLLMError(new Error('401 invalid api key'))).toBe(false);
    expect(isTransientLLMError(new Error('did not match schema'))).toBe(false);
  });
});
