export interface ParsedStackFrame {
  function?: string;
  file?: string;
  line?: number;
  column?: number;
  raw: string;
}

export interface ParsedError {
  exception_type?: string;
  message: string;
  frames: ParsedStackFrame[];
  /** Full raw text for fingerprint use. */
  raw: string;
}

const NODE_FRAME = /at\s+(?:([\w$.<>\[\] ]+?)\s+\()?(.+?):(\d+):(\d+)\)?/;
const PY_FRAME = /^\s*File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?$/;

export function parseErrorBlock(text: string): ParsedError | null {
  // Heuristic: find a line that looks like an error header.
  const lines = text.split(/\r?\n/);
  if (!lines.length) return null;

  // Node-style: "TypeError: Cannot read properties of undefined" followed by `    at ...` frames
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Z][\w]*Error|Error|TypeError|RangeError|ReferenceError|SyntaxError|AssertionError):\s+(.+)$/.exec(
      lines[i].trim(),
    );
    if (m) {
      const exception_type = m[1];
      const message = m[2];
      const frames: ParsedStackFrame[] = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 60); j++) {
        const fm = NODE_FRAME.exec(lines[j].trim());
        if (!fm) {
          if (lines[j].trim() === '' && frames.length) break;
          continue;
        }
        frames.push({
          function: fm[1]?.trim() || undefined,
          file: fm[2],
          line: Number(fm[3]),
          column: Number(fm[4]),
          raw: lines[j],
        });
      }
      if (frames.length) {
        return { exception_type, message, frames, raw: lines.slice(i, i + frames.length + 1).join('\n') };
      }
    }
  }

  // Python-style: "Traceback (most recent call last):" then file frames, then "ExceptionType: message"
  for (let i = 0; i < lines.length; i++) {
    if (/Traceback \(most recent call last\):/.test(lines[i])) {
      const frames: ParsedStackFrame[] = [];
      let endIdx = i + 1;
      for (let j = i + 1; j < lines.length; j++) {
        endIdx = j;
        const fm = PY_FRAME.exec(lines[j]);
        if (fm) {
          frames.push({
            file: fm[1],
            line: Number(fm[2]),
            function: fm[3],
            raw: lines[j],
          });
        } else if (/^\s+\S/.test(lines[j])) {
          continue;
        } else if (/^[A-Za-z_][\w.]*:?\s*/.test(lines[j]) && lines[j].trim()) {
          break;
        }
      }
      const errLine = lines[endIdx];
      const em = /^([\w.]+):\s+(.+)$/.exec(errLine || '');
      const exception_type = em?.[1];
      const message = em?.[2] ?? '';
      return {
        exception_type,
        message,
        frames,
        raw: lines.slice(i, endIdx + 1).join('\n'),
      };
    }
  }

  return null;
}

/**
 * Normalize a stack trace into a fingerprint string. Stable across whitespace and line numbers
 * but preserves top-frame file, exception type, and a normalized message.
 */
export function fingerprint(parsed: ParsedError, service: string, route?: string): string {
  const top = parsed.frames[0];
  const file = top?.file?.replace(/\\/g, '/').split('/').slice(-3).join('/') ?? 'unknown';
  // Strip numbers, hex, UUIDs from message to stabilize.
  const msg = parsed.message
    .replace(/[0-9a-fA-F-]{8,}/g, '<id>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  const exType = parsed.exception_type ?? 'Error';
  return [service, route ?? '-', exType, file, msg].join('|');
}
