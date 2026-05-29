import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import { KafuOpsConfig, LogSource } from '../config/schema.js';
import { RuntimeEvent } from '../types/index.js';
import { Redactor } from '../redaction/index.js';
import { RingBuffer } from './ringbuffer.js';
import { parseErrorBlock, ParsedError, fingerprint } from './parser.js';
import { log } from '../util/logger.js';

export interface LogTailerOptions {
  sources: LogSource[];
  service: string;
  environment: string;
  config: KafuOpsConfig;
  /** Repo root, used to resolve relative file-source paths. */
  rootDir: string;
  redactor?: Redactor;
  /** Poll interval for file sources. Defaults to 1000ms. */
  pollIntervalMs?: number;
}

interface FileCursor {
  abs: string;
  offset: number;
  partial: string;
  /** Sliding window of recent raw lines, used to detect multi-line stack traces. */
  recent: string[];
}

/**
 * Sidecar log tailer. Watches `runtime.log_sources` of type `file`, redacts and
 * pushes each line into a ring buffer, and emits a normalized RuntimeEvent when
 * it detects a Node/Python error block — feeding the same incident pipeline as
 * wrapper mode. Polling (not fs.watch) is used because it is portable across
 * log rotation and network filesystems.
 */
export class LogTailer extends EventEmitter {
  private readonly buffer: RingBuffer;
  private readonly redactor: Redactor;
  private readonly cursors: FileCursor[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly pollIntervalMs: number;

  constructor(private readonly opts: LogTailerOptions) {
    super();
    const rb = opts.config.observability.logs.ring_buffer;
    this.buffer = new RingBuffer({
      maxAgeSeconds: rb.max_age_seconds,
      maxBytes: rb.max_bytes_per_service,
    });
    this.redactor = opts.redactor ?? new Redactor(opts.config);
    this.pollIntervalMs = opts.pollIntervalMs ?? 1000;
  }

  getBuffer(): RingBuffer {
    return this.buffer;
  }

  /** Number of file sources actually being tailed. */
  sourceCount(): number {
    return this.cursors.length;
  }

  start(): void {
    for (const src of this.opts.sources) {
      if (src.type !== 'file') {
        // stdout/stderr sources only make sense in wrapper mode where we own the
        // child process. The sidecar can't tail them, so we skip with a note.
        log.debug(`log tailer: ignoring non-file source type=${src.type}`);
        continue;
      }
      const abs = path.isAbsolute(src.path) ? src.path : path.join(this.opts.rootDir, src.path);
      let offset = 0;
      try {
        offset = fs.statSync(abs).size; // start at end — only new lines
      } catch {
        log.warn(`log tailer: source not found yet, will watch for creation: ${abs}`);
      }
      this.cursors.push({ abs, offset, partial: '', recent: [] });
    }
    if (!this.cursors.length) return;
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
    // Don't keep the event loop alive solely for tailing in short-lived processes.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private poll(): void {
    for (const cursor of this.cursors) {
      let size: number;
      try {
        size = fs.statSync(cursor.abs).size;
      } catch {
        continue;
      }
      if (size < cursor.offset) {
        // File was truncated/rotated — restart from the beginning.
        cursor.offset = 0;
        cursor.partial = '';
      }
      if (size === cursor.offset) continue;
      let chunk: string;
      try {
        const fd = fs.openSync(cursor.abs, 'r');
        const len = size - cursor.offset;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, cursor.offset);
        fs.closeSync(fd);
        chunk = buf.toString('utf8');
      } catch {
        continue;
      }
      cursor.offset = size;
      this.consume(cursor, chunk);
    }
  }

  private consume(cursor: FileCursor, chunk: string): void {
    let text = cursor.partial + chunk;
    const lastNewline = text.lastIndexOf('\n');
    let processable = text;
    if (lastNewline !== -1 && lastNewline < text.length - 1) {
      processable = text.slice(0, lastNewline + 1);
      cursor.partial = text.slice(lastNewline + 1);
    } else if (lastNewline === text.length - 1) {
      cursor.partial = '';
    } else {
      // No newline yet — buffer and wait for more.
      cursor.partial = text;
      return;
    }

    const lines = processable.split(/\r?\n/);
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const redacted = this.redactor.redactText(raw);
      this.buffer.push({
        timestamp: new Date().toISOString(),
        service: this.opts.service,
        stream: 'stdout',
        message: redacted.text,
      });
      cursor.recent.push(raw);
    }
    if (cursor.recent.length > 200) cursor.recent = cursor.recent.slice(-200);

    const parsed = parseErrorBlock(cursor.recent.join('\n'));
    if (parsed) {
      this.emitErrorEvent(parsed);
      // Clear the window so the same trace isn't re-emitted on the next poll.
      cursor.recent = [];
    }
  }

  private emitErrorEvent(parsed: ParsedError): void {
    const ev: RuntimeEvent = {
      id: `evt_${nanoid(10)}`,
      service: this.opts.service,
      environment: this.opts.environment,
      type: 'uncaught_exception',
      severity: 'error',
      timestamp: new Date().toISOString(),
      message: this.redactor.redactText(parsed.message).text,
      stacktrace: this.redactor.redactText(parsed.raw).text,
      attributes: {
        source: 'log_tailer',
        exception_type: parsed.exception_type,
        top_frame_file: parsed.frames[0]?.file,
        top_frame_line: parsed.frames[0]?.line,
        fingerprint: fingerprint(parsed, this.opts.service),
      },
    };
    this.emit('event', ev);
  }
}
