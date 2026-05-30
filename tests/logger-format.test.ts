import { describe, it, expect } from 'vitest';
import { formatJsonLog } from '../src/util/logger.js';

describe('formatJsonLog', () => {
  it('emits a single-line JSON object with level, msg, ts', () => {
    const line = formatJsonLog('warn', 'something happened', '2026-05-30T00:00:00.000Z');
    expect(line).not.toContain('\n');
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('warn');
    expect(parsed.msg).toBe('something happened');
    expect(parsed.ts).toBe('2026-05-30T00:00:00.000Z');
  });

  it('strips ANSI color codes from the message', () => {
    const esc = String.fromCharCode(27);
    const colored = `${esc}[32m✓${esc}[39m done`;
    const parsed = JSON.parse(formatJsonLog('info', colored, '2026-05-30T00:00:00.000Z'));
    expect(parsed.msg).not.toContain(esc);
    expect(parsed.msg).toContain('done');
  });
});
