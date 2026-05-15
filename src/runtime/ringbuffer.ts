export interface LogEntry {
  timestamp: string;
  service: string;
  stream: 'stdout' | 'stderr' | 'webhook' | 'event';
  message: string;
}

export interface RingBufferOptions {
  maxAgeSeconds: number;
  maxBytes: number;
}

/**
 * In-memory rolling buffer of log entries. Bounded by both wall age and
 * total bytes. Single-service. The agent should create one per service.
 */
export class RingBuffer {
  private entries: LogEntry[] = [];
  private bytes = 0;
  private readonly maxAgeMs: number;
  private readonly maxBytes: number;

  constructor(opts: RingBufferOptions) {
    this.maxAgeMs = opts.maxAgeSeconds * 1000;
    this.maxBytes = opts.maxBytes;
  }

  push(entry: LogEntry): void {
    const size = Buffer.byteLength(entry.message, 'utf8') + 48;
    this.entries.push(entry);
    this.bytes += size;
    this.prune();
  }

  private prune(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    while (this.entries.length && new Date(this.entries[0].timestamp).getTime() < cutoff) {
      const removed = this.entries.shift()!;
      this.bytes -= Buffer.byteLength(removed.message, 'utf8') + 48;
    }
    while (this.bytes > this.maxBytes && this.entries.length > 1) {
      const removed = this.entries.shift()!;
      this.bytes -= Buffer.byteLength(removed.message, 'utf8') + 48;
    }
  }

  /** Return entries within [from, to] ms timestamps. */
  excerpt(fromMs: number, toMs: number, maxChars = 12000): LogEntry[] {
    this.prune();
    const out: LogEntry[] = [];
    let charBudget = maxChars;
    for (const e of this.entries) {
      const t = new Date(e.timestamp).getTime();
      if (t < fromMs || t > toMs) continue;
      if (charBudget <= 0) break;
      const slice =
        e.message.length > charBudget ? e.message.slice(0, charBudget) + '…' : e.message;
      out.push({ ...e, message: slice });
      charBudget -= slice.length;
    }
    return out;
  }

  snapshot(): LogEntry[] {
    this.prune();
    return [...this.entries];
  }

  size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
    this.bytes = 0;
  }
}
