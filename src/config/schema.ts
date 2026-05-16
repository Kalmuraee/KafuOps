import { z } from 'zod';

export const RedactionPatternSchema = z.object({
  name: z.string(),
  regex: z.string(),
  replace_with: z.string(),
});

export const TriggerSchema = z.union([
  z.object({ type: z.literal('uncaught_exception') }),
  z.object({ type: z.literal('process_crash') }),
  z.object({
    type: z.literal('repeated_stacktrace'),
    count: z.number().int().positive().default(3),
    window_seconds: z.number().int().positive().default(120),
  }),
  z.object({
    type: z.literal('http_5xx_rate'),
    threshold: z.number().int().positive().default(10),
    window_seconds: z.number().int().positive().default(300),
  }),
  z.object({
    type: z.literal('alert_webhook'),
    severities: z.array(z.enum(['critical', 'high', 'warn', 'info'])).default(['critical', 'high']),
  }),
  z.object({
    type: z.literal('deployment_regression'),
    error_started_within_minutes: z.number().int().positive().default(30),
  }),
]);

export const LogSourceSchema = z.union([
  z.object({ type: z.literal('stdout') }),
  z.object({ type: z.literal('stderr') }),
  z.object({ type: z.literal('file'), path: z.string() }),
]);

export const ConfigSchema = z.object({
  version: z.number().int().default(1),

  project: z.object({
    name: z.string(),
    language: z.string().default('typescript'),
    framework: z.string().default('unknown'),
    service_name: z.string().optional(),
    default_branch: z.string().default('main'),
  }),

  repo: z
    .object({
      provider: z.enum(['github', 'gitlab', 'none']).default('none'),
      url: z.string().optional(),
      base_url: z.string().optional(),
      default_branch: z.string().default('main'),
      mr: z
        .object({
          enabled: z.boolean().default(true),
          auto_create: z.boolean().default(true),
          auto_merge: z.boolean().default(false),
          branch_prefix: z.string().default('kafuops/fix'),
        })
        .default({}),
    })
    .default({}),

  runtime: z
    .object({
      mode: z.enum(['sidecar', 'wrapper', 'webhook', 'kubernetes']).default('wrapper'),
      service_command: z.string().nullable().default(null),
      log_sources: z.array(LogSourceSchema).default([{ type: 'stdout' }]),
    })
    .default({}),

  observability: z
    .object({
      opentelemetry: z
        .object({
          enabled: z.boolean().default(false),
          endpoint: z.string().default('http://localhost:4318'),
        })
        .default({}),
      logs: z
        .object({
          enabled: z.boolean().default(true),
          ring_buffer: z
            .object({
              enabled: z.boolean().default(true),
              max_age_seconds: z.number().int().positive().default(600),
              max_bytes_per_service: z.number().int().positive().default(10 * 1024 * 1024),
              include_before_error_seconds: z.number().int().positive().default(120),
              include_after_error_seconds: z.number().int().positive().default(30),
            })
            .default({}),
        })
        .default({}),
      webhooks: z
        .object({
          sentry: z.boolean().default(false),
          datadog: z.boolean().default(false),
          alertmanager: z.boolean().default(false),
          custom: z.boolean().default(true),
        })
        .default({}),
    })
    .default({}),

  triggers: z
    .object({
      create_incident_when: z.array(TriggerSchema).default([
        { type: 'uncaught_exception' },
        { type: 'process_crash' },
        { type: 'repeated_stacktrace', count: 3, window_seconds: 120 },
      ]),
    })
    .default({}),

  llm: z
    .object({
      provider: z.enum(['openai', 'azure-openai', 'anthropic', 'none']).default('openai'),
      trigger_mode: z.enum(['incident_only', 'manual_only', 'off']).default('incident_only'),
      models: z
        .object({
          analysis: z.string().default('gpt-4o-mini'),
          patch: z.string().default('gpt-4o'),
        })
        .default({}),
      structured_outputs: z.boolean().default(true),
      max_context_files: z.number().int().positive().default(30),
      max_log_excerpt_chars: z.number().int().positive().default(12000),
      max_file_chars: z.number().int().positive().default(8000),
      /** Anthropic only. The Messages API requires max_tokens explicitly. */
      anthropic_max_tokens: z.number().int().positive().default(4096),
    })
    .default({}),

  privacy: z
    .object({
      redact_before_storage: z.boolean().default(true),
      redact_before_llm: z.boolean().default(true),
      audit_model_context: z.boolean().default(true),
      send_full_logs_to_llm: z.literal(false).default(false),
      send_full_repo_to_llm: z.literal(false).default(false),
      require_allowlist_for_sensitive_paths: z.boolean().default(true),
    })
    .default({}),

  redaction: z
    .object({
      enabled: z.boolean().default(true),
      patterns: z.array(RedactionPatternSchema).default([]),
      json_fields: z
        .array(z.string())
        .default([
          'password',
          'token',
          'secret',
          'authorization',
          'cookie',
          'session',
          'access_token',
          'refresh_token',
          'credit_card',
        ]),
    })
    .default({}),

  file_policy: z
    .object({
      deny: z
        .array(z.string())
        .default(['.env', '.env.*', 'secrets/**', 'private_keys/**', '*.pem', '*.key', 'credentials.json']),
    })
    .default({}),

  sandbox: z
    .object({
      type: z.enum(['local', 'docker']).default('local'),
      image: z.string().default('node:22'),
      install_command: z.string().default('npm ci'),
      test_command: z.string().default('npm test'),
      targeted_test_command: z.string().default('npm test -- {test_file}'),
      working_dir: z.string().default('.kafuops/sandbox'),
      timeout_seconds: z.number().int().positive().default(300),
    })
    .default({}),

  policies: z
    .object({
      model_calls: z
        .object({
          require_incident: z.boolean().default(true),
          require_redaction: z.boolean().default(true),
          audit_every_call: z.boolean().default(true),
        })
        .default({}),
      merge_requests: z
        .object({
          auto_create: z.boolean().default(true),
          auto_merge: z.boolean().default(false),
          require_tests_or_explanation: z.boolean().default(true),
        })
        .default({}),
      confidence: z
        .object({
          open_mr_if_score_at_least: z.number().int().min(0).max(100).default(70),
          require_human_approval_if_below: z.number().int().min(0).max(100).default(85),
        })
        .default({}),
      never_modify: z
        .array(z.string())
        .default(['.env', '.env.*', 'secrets/**', 'private_keys/**', '*.pem', '*.key']),
      require_approval_to_modify: z
        .array(z.string())
        .default([
          'src/auth/**',
          'src/security/**',
          'src/payments/**',
          'migrations/**',
          'infra/**',
        ]),
      blast_radius: z
        .object({
          block_high_risk_auto_mr: z.boolean().default(true),
          require_approval_for: z
            .array(z.string())
            .default(['auth', 'payments', 'migrations', 'permissions', 'infrastructure']),
        })
        .default({}),
    })
    .default({}),

  noise_control: z
    .object({
      dedupe_window_seconds: z.number().int().positive().default(900),
      max_incidents_per_service_per_hour: z.number().int().positive().default(5),
      ignore: z
        .array(
          z.union([
            z.object({ message_contains: z.string() }),
            z.object({ route: z.string() }),
            z.object({ environment: z.string() }),
          ]),
        )
        .default([
          { route: 'GET /metrics' },
          { route: 'GET /healthz' },
          { environment: 'development' },
        ]),
    })
    .default({}),

  server: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.number().int().positive().default(7878),
      webhook_secret_env: z.string().default('KAFUOPS_WEBHOOK_SECRET'),
    })
    .default({}),
});

export type KafuOpsConfig = z.infer<typeof ConfigSchema>;
export type TriggerRule = z.infer<typeof TriggerSchema>;
export type LogSource = z.infer<typeof LogSourceSchema>;
