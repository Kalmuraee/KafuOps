import { describe, it, expect } from 'vitest';
import { parseErrorBlock, fingerprint } from '../src/runtime/parser.js';

describe('parseErrorBlock', () => {
  it('parses a Node.js stack trace', () => {
    const text = `Some other log
TypeError: Cannot read properties of undefined (reading 'foo')
    at handler (/srv/app/src/payment/retry.ts:42:17)
    at processCheckout (/srv/app/src/routes/checkout.ts:88:11)
    at <anonymous>
unrelated line`;
    const p = parseErrorBlock(text);
    expect(p).not.toBeNull();
    expect(p!.exception_type).toBe('TypeError');
    expect(p!.message).toContain('Cannot read properties of undefined');
    expect(p!.frames[0].file).toBe('/srv/app/src/payment/retry.ts');
    expect(p!.frames[0].line).toBe(42);
  });

  it('parses a Python traceback', () => {
    const text = `Traceback (most recent call last):
  File "/srv/app/main.py", line 12, in main
    process()
  File "/srv/app/lib/work.py", line 88, in process
    do_thing()
ValueError: bad value`;
    const p = parseErrorBlock(text);
    expect(p).not.toBeNull();
    expect(p!.exception_type).toBe('ValueError');
    expect(p!.frames[0].file).toBe('/srv/app/main.py');
    expect(p!.frames[0].line).toBe(12);
  });

  it('produces a stable fingerprint that ignores numbers', () => {
    const text1 = `TypeError: Cannot read properties of undefined
    at h (/srv/app/src/x.ts:42:17)`;
    const text2 = `TypeError: Cannot read properties of undefined
    at h (/srv/app/src/x.ts:99:1)`;
    const p1 = parseErrorBlock(text1)!;
    const p2 = parseErrorBlock(text2)!;
    expect(fingerprint(p1, 'api')).toBe(fingerprint(p2, 'api'));
  });
});
