/**
 * KafuOps core types. These map to the objects defined in docs/DATA_MODEL.md
 * and docs/INCIDENT_WORKFLOW.md.
 */

export type Severity = 'debug' | 'info' | 'warn' | 'error' | 'critical' | 'high';

export type EventType =
  | 'error.log'
  | 'uncaught_exception'
  | 'process_crash'
  | 'http_5xx'
  | 'trace.error'
  | 'alert.webhook'
  | 'manual';

export interface RuntimeEvent {
  id: string;
  service: string;
  environment: string;
  type: EventType;
  severity: Severity;
  timestamp: string;
  message: string;
  stacktrace?: string;
  trace_id?: string;
  span_id?: string;
  route?: string;
  attributes?: Record<string, unknown>;
}

export type IncidentStatus =
  | 'created'
  | 'context_built'
  | 'analyzed'
  | 'patch_generated'
  | 'validated'
  | 'mr_opened'
  | 'merged'
  | 'rejected'
  | 'resolved'
  | 'blocked';

export interface Incident {
  id: string;
  service: string;
  environment: string;
  severity: Severity;
  fingerprint: string;
  status: IncidentStatus;
  summary: string;
  first_seen: string;
  last_seen: string;
  event_count: number;
  route?: string;
  exception_type?: string;
  top_frame_file?: string;
  top_frame_line?: number;
  trigger_reason?: string;
  events: RuntimeEvent[];
  deployment?: { version?: string; commit_sha?: string };
}

export interface LogExcerpt {
  timestamp: string;
  message: string;
}

export interface EvidencePacket {
  incident_id: string;
  stacktrace?: string;
  logs: LogExcerpt[];
  trace_spans?: Array<Record<string, unknown>>;
  deployment?: { version?: string; commit_sha?: string };
  related_incidents?: string[];
}

export interface ContextFile {
  path: string;
  reason: string;
  evidence_strength: 'high' | 'medium' | 'low';
  /** Raw source content, post-redaction, up to a bounded size. */
  content: string;
  /** Original byte length before truncation. */
  original_bytes: number;
}

export interface ContextBundle {
  incident_id: string;
  evidence_packet: EvidencePacket;
  files: ContextFile[];
  memory: Array<{ path: string; reason: string; content: string }>;
  graph_paths?: string[];
  privacy: {
    redaction_applied: boolean;
    full_logs_sent: false;
    full_repo_sent: false;
    patterns_matched: Record<string, number>;
    files_excluded: string[];
  };
}

export interface RootCauseResult {
  classification:
    | 'code_bug'
    | 'configuration_issue'
    | 'missing_environment_variable'
    | 'third_party_outage'
    | 'database_migration_issue'
    | 'schema_mismatch'
    | 'data_quality_issue'
    | 'insufficient_telemetry'
    | 'unknown';
  suspected_root_cause: string;
  evidence: string[];
  files_to_read_next: string[];
  should_attempt_fix: boolean;
  confidence: number;
}

export interface PatchPlan {
  patch_type: 'bug_fix' | 'config_fix' | 'test_only' | 'investigation_only';
  files_to_modify: string[];
  test_strategy: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
}

export interface CodePatch {
  /** Unified diff, applied via `git apply` in the sandbox. */
  unified_diff: string;
  summary: string;
  new_test_files?: string[];
}

export interface ValidationResult {
  install_command: string;
  install_ok: boolean;
  install_output_tail: string;
  test_commands: string[];
  tests_passed: boolean;
  tests_output_tail: string;
  ran_in_sandbox: boolean;
  notes?: string;
}

export interface ConfidenceBreakdown {
  score: number;
  level: 'low' | 'medium' | 'high' | 'very_high';
  positive: string[];
  negative: string[];
  decision: 'open_mr' | 'request_human_approval' | 'block';
}

export interface BlastRadius {
  changed_files: string[];
  potentially_affected: string[];
  not_directly_affected: string[];
  external_dependencies: string[];
  data_impact: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
}

export interface PatchAttempt {
  id: string;
  incident_id: string;
  branch: string;
  files_changed: string[];
  tests_run: string[];
  confidence: number;
  status:
    | 'planned'
    | 'patch_applied'
    | 'validated'
    | 'blocked_by_policy'
    | 'mr_opened'
    | 'failed';
  mr_url?: string;
  mr_number?: number;
  created_at: string;
  validation?: ValidationResult;
  blast_radius?: BlastRadius;
  confidence_breakdown?: ConfidenceBreakdown;
}

export interface AuditModelCall {
  id: string;
  incident_id: string;
  purpose: string;
  model: string;
  prompt_token_estimate: number;
  files_sent: Array<{ path: string; reason: string; bytes: number }>;
  logs_excerpt_chars: number;
  redaction_summary: Record<string, number>;
  files_excluded: string[];
  timestamp: string;
  response_summary: string;
}
