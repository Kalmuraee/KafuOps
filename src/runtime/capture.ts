import { KafuOpsConfig } from '../config/schema.js';
import { Incident } from '../types/index.js';
import { IncidentStore } from '../incident/store.js';
import { RingBuffer } from './ringbuffer.js';

/**
 * Snapshot the ring-buffer window around an incident and persist it on the
 * incident, so the (in-memory, process-bound) buffer survives to inform the
 * context builder during later analysis. Safe to call repeatedly as an
 * incident dedups — it overwrites with the latest window.
 */
export function persistIncidentLogs(
  store: IncidentStore,
  incident: Incident,
  buffer: RingBuffer,
  config: KafuOpsConfig,
): void {
  const rb = config.observability.logs.ring_buffer;
  const firstSeen = new Date(incident.first_seen).getTime();
  const fromMs = firstSeen - rb.include_before_error_seconds * 1000;
  const toMs = Date.now() + rb.include_after_error_seconds * 1000;
  const entries = buffer.excerpt(fromMs, toMs, config.llm.max_log_excerpt_chars);
  const logs = entries.map((e) => ({ timestamp: e.timestamp, message: e.message }));
  if (logs.length) store.saveLogs(incident.id, logs);
}
