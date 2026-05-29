import { nanoid } from 'nanoid';
import { KafuOpsConfig, TriggerRule } from '../config/schema.js';
import { Incident, RuntimeEvent, Severity } from '../types/index.js';
import { IncidentStore } from './store.js';
import { log } from '../util/logger.js';

interface RecentEvent {
  ts: number;
  fingerprint: string;
  type: RuntimeEvent['type'];
  route?: string;
  severity: Severity;
}

export class IncidentEngine {
  private readonly store: IncidentStore;
  private readonly recent: RecentEvent[] = [];
  private readonly recentIncidentsPerService = new Map<string, number[]>(); // ts list
  private readonly noise: { messageContains: string[]; routes: Set<string>; envs: Set<string> };

  constructor(private readonly rootDir: string, private readonly config: KafuOpsConfig) {
    this.store = new IncidentStore(rootDir);
    const messageContains: string[] = [];
    const routes = new Set<string>();
    const envs = new Set<string>();
    for (const rule of config.noise_control.ignore) {
      if ('message_contains' in rule) messageContains.push(rule.message_contains.toLowerCase());
      else if ('route' in rule) routes.add(rule.route);
      else if ('environment' in rule) envs.add(rule.environment);
    }
    this.noise = { messageContains, routes, envs };
  }

  /**
   * Ingest a runtime event. Returns the (created or updated) incident if a trigger fires,
   * or null when the event is filtered out / does not yet meet thresholds.
   *
   * `opts.force` creates an incident unconditionally (used by the manual
   * `/v1/incidents` endpoint and `simulate`): noise filters, trigger rules, and
   * the per-service rate limit are bypassed, but fingerprint dedup still applies.
   */
  ingest(event: RuntimeEvent, opts: { force?: boolean } = {}): Incident | null {
    const force = !!opts.force;
    if (!force && this.isNoise(event)) {
      log.debug(`event filtered as noise: ${event.message.slice(0, 80)}`);
      return null;
    }
    const fp =
      (event.attributes?.fingerprint as string | undefined) ??
      this.fallbackFingerprint(event);
    this.recent.push({
      ts: Date.now(),
      fingerprint: fp,
      type: event.type,
      route: event.route ?? (event.attributes?.route as string | undefined),
      severity: event.severity,
    });
    this.pruneRecent();

    const triggerReason = force
      ? ((event.attributes?.trigger_reason as string | undefined) ?? 'manual')
      : this.evaluateTriggers(event, fp);
    if (!triggerReason) return null;

    if (!force && this.rateLimited(event.service)) {
      log.warn(`incident rate limit hit for service=${event.service}`);
      return null;
    }

    const window = this.config.noise_control.dedupe_window_seconds;
    const existing = this.store.findOpenByFingerprint(fp, window);
    if (existing) {
      existing.last_seen = event.timestamp;
      existing.event_count += 1;
      existing.events.push(event);
      if (existing.events.length > 200) existing.events.shift();
      this.store.save(existing);
      return existing;
    }

    const id = `inc_${new Date().toISOString().slice(0, 10).replace(/-/g, '_')}_${nanoid(8)}`;
    const incident: Incident = {
      id,
      service: event.service,
      environment: event.environment,
      severity: event.severity === 'error' ? 'high' : event.severity,
      fingerprint: fp,
      status: 'created',
      summary: this.summarize(event),
      first_seen: event.timestamp,
      last_seen: event.timestamp,
      event_count: 1,
      route: event.route ?? (event.attributes?.route as string | undefined),
      exception_type: event.attributes?.exception_type as string | undefined,
      top_frame_file: event.attributes?.top_frame_file as string | undefined,
      top_frame_line: event.attributes?.top_frame_line as number | undefined,
      trigger_reason: triggerReason,
      events: [event],
    };
    this.store.save(incident);
    this.recordIncident(event.service);
    return incident;
  }

  private isNoise(event: RuntimeEvent): boolean {
    if (this.noise.envs.has(event.environment)) return true;
    const route = event.route ?? (event.attributes?.route as string | undefined);
    if (route && this.noise.routes.has(route)) return true;
    const lower = event.message.toLowerCase();
    for (const m of this.noise.messageContains) {
      if (lower.includes(m)) return true;
    }
    return false;
  }

  private fallbackFingerprint(event: RuntimeEvent): string {
    const msg = event.message
      .replace(/[0-9a-fA-F-]{8,}/g, '<id>')
      .replace(/\d+/g, '<n>')
      .slice(0, 200);
    return [event.service, event.route ?? '-', event.type, msg].join('|');
  }

  private summarize(event: RuntimeEvent): string {
    const route = event.route ?? (event.attributes?.route as string | undefined);
    const exType = event.attributes?.exception_type as string | undefined;
    const msg = event.message ?? '';
    const alreadyHasType = exType && msg.toLowerCase().startsWith(exType.toLowerCase() + ':');
    const prefix = exType && !alreadyHasType ? `${exType}: ` : '';
    const where = route ? ` on ${route}` : '';
    return (prefix + msg + where).slice(0, 200);
  }

  private evaluateTriggers(event: RuntimeEvent, fp: string): string | null {
    for (const rule of this.config.triggers.create_incident_when) {
      const reason = this.matchTrigger(rule, event, fp);
      if (reason) return reason;
    }
    return null;
  }

  private matchTrigger(rule: TriggerRule, event: RuntimeEvent, fp: string): string | null {
    switch (rule.type) {
      case 'uncaught_exception':
        return event.type === 'uncaught_exception' ? 'uncaught_exception' : null;
      case 'process_crash':
        return event.type === 'process_crash' ? 'process_crash' : null;
      case 'repeated_stacktrace': {
        const cutoff = Date.now() - rule.window_seconds * 1000;
        const count = this.recent.filter(
          (r) => r.fingerprint === fp && r.ts >= cutoff,
        ).length;
        return count >= rule.count
          ? `repeated_stacktrace count=${count} threshold=${rule.count}`
          : null;
      }
      case 'http_5xx_rate': {
        const cutoff = Date.now() - rule.window_seconds * 1000;
        const count = this.recent.filter(
          (r) => r.type === 'http_5xx' && r.ts >= cutoff,
        ).length;
        return count >= rule.threshold
          ? `http_5xx_rate count=${count} threshold=${rule.threshold}`
          : null;
      }
      case 'alert_webhook':
        return event.type === 'alert.webhook' &&
          rule.severities.includes(event.severity as 'critical' | 'high' | 'warn' | 'info')
          ? `alert_webhook severity=${event.severity}`
          : null;
      case 'deployment_regression':
        // Out of scope for MVP — would require deploy event correlation.
        return null;
    }
  }

  private pruneRecent(): void {
    const maxWindowMs =
      Math.max(
        this.config.noise_control.dedupe_window_seconds,
        ...this.config.triggers.create_incident_when.map((r) =>
          'window_seconds' in r ? r.window_seconds : 0,
        ),
      ) * 1000;
    const cutoff = Date.now() - Math.max(maxWindowMs, 60_000);
    while (this.recent.length && this.recent[0].ts < cutoff) this.recent.shift();
  }

  private rateLimited(service: string): boolean {
    const limit = this.config.noise_control.max_incidents_per_service_per_hour;
    const cutoff = Date.now() - 3600 * 1000;
    const list = (this.recentIncidentsPerService.get(service) ?? []).filter((t) => t >= cutoff);
    this.recentIncidentsPerService.set(service, list);
    return list.length >= limit;
  }

  private recordIncident(service: string): void {
    const list = this.recentIncidentsPerService.get(service) ?? [];
    list.push(Date.now());
    this.recentIncidentsPerService.set(service, list);
  }
}
