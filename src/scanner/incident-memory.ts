import fs from 'node:fs';
import path from 'node:path';
import { getPaths, ensureDir } from '../util/paths.js';
import { Incident } from '../types/index.js';

export interface IncidentMemoryDetails {
  rootCause: string;
  filesChanged: string[];
  confidence: number;
  riskLevel: string;
  mrUrl?: string;
}

/**
 * Append a record of a processed incident to `.kafuops/memory/incidents.md`.
 * This is the "living memory" half of the learning loop — every incident the
 * agent works on leaves a durable trace that later context builds surface.
 */
export function recordIncidentMemory(
  rootDir: string,
  incident: Incident,
  details: IncidentMemoryDetails,
): string {
  const dir = getPaths(rootDir).memory;
  ensureDir(dir);
  const file = path.join(dir, 'incidents.md');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '# Incident History\n\nAppended by KafuOps after each processed incident.\n');
  }
  const lines = [
    '',
    `## ${incident.id} — ${incident.summary}`,
    `- When: ${new Date().toISOString()}`,
    `- Service: ${incident.service} (${incident.environment})`,
    `- Fingerprint: \`${incident.fingerprint}\``,
    `- Root cause: ${details.rootCause}`,
    `- Files changed: ${details.filesChanged.map((f) => `\`${f}\``).join(', ') || '(none)'}`,
    `- Confidence: ${details.confidence} · Risk: ${details.riskLevel}`,
  ];
  if (details.mrUrl) lines.push(`- MR: ${details.mrUrl}`);
  fs.appendFileSync(file, lines.join('\n') + '\n');
  return file;
}

export type ReviewOutcome = 'merged' | 'rejected' | 'resolved';

/**
 * Append a human review decision to `.kafuops/memory/review-feedback.md`. This
 * is the feedback half of the loop: when a reviewer merges/rejects/closes a
 * KafuOps MR, the decision (and any note) is recorded so future analyses can
 * learn from what worked and what didn't.
 */
export function recordReviewFeedback(
  rootDir: string,
  incident: Incident,
  outcome: ReviewOutcome,
  note?: string,
): string {
  const dir = getPaths(rootDir).memory;
  ensureDir(dir);
  const file = path.join(dir, 'review-feedback.md');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      '# Review Feedback\n\nHuman decisions on KafuOps MRs — fed back into future analysis.\n',
    );
  }
  const lines = [
    '',
    `## ${incident.id} — ${outcome.toUpperCase()}`,
    `- When: ${new Date().toISOString()}`,
    `- Summary: ${incident.summary}`,
    `- Fingerprint: \`${incident.fingerprint}\``,
  ];
  if (note) lines.push(`- Note: ${note}`);
  fs.appendFileSync(file, lines.join('\n') + '\n');
  return file;
}
