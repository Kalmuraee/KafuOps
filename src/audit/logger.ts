import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { AuditModelCall, ContextBundle } from '../types/index.js';
import { getPaths } from '../util/paths.js';

export class AuditLogger {
  constructor(private readonly rootDir: string) {}

  record(params: {
    incident_id: string;
    purpose: string;
    model: string;
    bundle: ContextBundle;
    prompt_token_estimate: number;
    response_summary: string;
  }): AuditModelCall {
    const audit: AuditModelCall = {
      id: `audit_${nanoid(10)}`,
      incident_id: params.incident_id,
      purpose: params.purpose,
      model: params.model,
      prompt_token_estimate: params.prompt_token_estimate,
      files_sent: params.bundle.files.map((f) => ({
        path: f.path,
        reason: f.reason,
        bytes: f.original_bytes,
      })),
      logs_excerpt_chars: params.bundle.evidence_packet.logs
        .map((l) => l.message.length)
        .reduce((a, b) => a + b, 0),
      redaction_summary: params.bundle.privacy.patterns_matched,
      files_excluded: params.bundle.privacy.files_excluded,
      timestamp: new Date().toISOString(),
      response_summary: params.response_summary,
    };
    const paths = getPaths(this.rootDir);
    fs.mkdirSync(paths.modelCalls, { recursive: true });
    const ts = audit.timestamp.replace(/[:.]/g, '-');
    fs.writeFileSync(
      path.join(paths.modelCalls, `${ts}-${params.incident_id}-${params.purpose}.json`),
      JSON.stringify(audit, null, 2),
    );
    return audit;
  }
}
