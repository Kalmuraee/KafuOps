import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import { RingBuffer } from './ringbuffer.js';
import { parseErrorBlock, ParsedError, fingerprint } from './parser.js';
import { Redactor } from '../redaction/index.js';
import { KafuOpsConfig } from '../config/schema.js';
import { RuntimeEvent } from '../types/index.js';

export interface WrapperOptions {
  command: string;
  args: string[];
  service: string;
  environment: string;
  config: KafuOpsConfig;
  /** Override default redactor (rarely needed). */
  redactor?: Redactor;
}

/**
 * Wrapper mode: spawn a child process and observe stdout/stderr.
 * Emits `event` for each normalized RuntimeEvent.
 */
export class WrapperRuntime extends EventEmitter {
  private child: ChildProcess | null = null;
  private readonly buffer: RingBuffer;
  private readonly redactor: Redactor;
  private partialStderr = '';
  private partialStdout = '';

  constructor(private readonly opts: WrapperOptions) {
    super();
    const rb = opts.config.observability.logs.ring_buffer;
    this.buffer = new RingBuffer({
      maxAgeSeconds: rb.max_age_seconds,
      maxBytes: rb.max_bytes_per_service,
    });
    this.redactor = opts.redactor ?? new Redactor(opts.config);
  }

  start(): ChildProcess {
    const child = spawn(this.opts.command, this.opts.args, {
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout!.on('data', (buf: Buffer) => this.handleData('stdout', buf));
    child.stderr!.on('data', (buf: Buffer) => this.handleData('stderr', buf));
    child.on('exit', (code, signal) => {
      const ev: RuntimeEvent = {
        id: `evt_${nanoid(10)}`,
        service: this.opts.service,
        environment: this.opts.environment,
        type: code === 0 ? 'manual' : 'process_crash',
        severity: code === 0 ? 'info' : 'critical',
        timestamp: new Date().toISOString(),
        message: `Process exited code=${code} signal=${signal ?? 'none'}`,
        attributes: { exit_code: code ?? -1, signal: signal ?? null },
      };
      this.emit('event', ev);
      this.emit('exit', { code, signal });
    });
    return child;
  }

  stop(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.child && !this.child.killed) this.child.kill(signal);
  }

  getBuffer(): RingBuffer {
    return this.buffer;
  }

  private handleData(stream: 'stdout' | 'stderr', buf: Buffer): void {
    let text = buf.toString('utf8');
    // Forward to parent so the developer still sees their app's output.
    if (stream === 'stderr') process.stderr.write(text);
    else process.stdout.write(text);

    // Combine with partial line buffer to handle chunk boundaries on stack traces.
    text = (stream === 'stderr' ? this.partialStderr : this.partialStdout) + text;
    const lastNewline = text.lastIndexOf('\n');
    let processable = text;
    if (lastNewline !== -1 && lastNewline < text.length - 1) {
      processable = text.slice(0, lastNewline + 1);
      const remainder = text.slice(lastNewline + 1);
      if (stream === 'stderr') this.partialStderr = remainder;
      else this.partialStdout = remainder;
    } else {
      if (stream === 'stderr') this.partialStderr = '';
      else this.partialStdout = '';
    }

    const lines = processable.split(/\r?\n/);
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const redacted = this.redactor.redactText(raw);
      this.buffer.push({
        timestamp: new Date().toISOString(),
        service: this.opts.service,
        stream,
        message: redacted.text,
      });
    }

    // Try to detect a full error block in the accumulated processable text.
    const parsed = parseErrorBlock(processable);
    if (parsed) {
      this.emitErrorEvent(parsed, stream);
    }
  }

  private emitErrorEvent(parsed: ParsedError, stream: 'stdout' | 'stderr'): void {
    const redactedMsg = this.redactor.redactText(parsed.message).text;
    const redactedRaw = this.redactor.redactText(parsed.raw).text;
    const ev: RuntimeEvent = {
      id: `evt_${nanoid(10)}`,
      service: this.opts.service,
      environment: this.opts.environment,
      type: 'uncaught_exception',
      severity: 'error',
      timestamp: new Date().toISOString(),
      message: redactedMsg,
      stacktrace: redactedRaw,
      attributes: {
        stream,
        exception_type: parsed.exception_type,
        top_frame_file: parsed.frames[0]?.file,
        top_frame_line: parsed.frames[0]?.line,
        fingerprint: fingerprint(parsed, this.opts.service),
      },
    };
    this.emit('event', ev);
  }
}
