import { z } from 'zod';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { KafuOpsConfig } from '../config/schema.js';
import {
  CodePatch,
  ContextBundle,
  Incident,
  PatchPlan,
  RootCauseResult,
} from '../types/index.js';
import { AuditLogger } from '../audit/logger.js';
import { SYSTEM_BASE, renderEvidenceBlock } from './prompts.js';
import { log } from '../util/logger.js';

const RootCauseSchema = z.object({
  classification: z.enum([
    'code_bug',
    'configuration_issue',
    'missing_environment_variable',
    'third_party_outage',
    'database_migration_issue',
    'schema_mismatch',
    'data_quality_issue',
    'insufficient_telemetry',
    'unknown',
  ]),
  suspected_root_cause: z.string(),
  evidence: z.array(z.string()),
  files_to_read_next: z.array(z.string()),
  should_attempt_fix: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const PatchPlanSchema = z.object({
  patch_type: z.enum(['bug_fix', 'config_fix', 'test_only', 'investigation_only']),
  files_to_modify: z.array(z.string()),
  test_strategy: z.string(),
  risk_level: z.enum(['low', 'medium', 'high', 'critical']),
  reason: z.string(),
});

const CodePatchSchema = z.object({
  unified_diff: z.string(),
  summary: z.string(),
  new_test_files: z.array(z.string()).default([]),
});

export type LLMProvider = 'openai' | 'anthropic' | 'dry-run';

export interface OrchestratorOptions {
  rootDir: string;
  config: KafuOpsConfig;
  /** When true, never makes a real API call. Used by tests and dry runs. */
  dryRun?: boolean;
  /** Optional pre-constructed OpenAI client (useful for tests). */
  client?: OpenAI;
  anthropicClient?: Anthropic;
}

export class LLMOrchestrator {
  private readonly audit: AuditLogger;
  private readonly openaiClient: OpenAI | null;
  private readonly anthropicClient: Anthropic | null;
  private readonly dryRun: boolean;
  private readonly activeProvider: LLMProvider;

  constructor(private readonly opts: OrchestratorOptions) {
    this.audit = new AuditLogger(opts.rootDir);
    const requested = opts.config.llm.provider;
    // Decide which provider is actually usable. Honors trigger_mode: 'off' too.
    const forceDryRun = !!opts.dryRun || requested === 'none' || opts.config.llm.trigger_mode === 'off';
    if (forceDryRun) {
      this.activeProvider = 'dry-run';
      this.openaiClient = null;
      this.anthropicClient = null;
    } else if (requested === 'anthropic') {
      if (!process.env.ANTHROPIC_API_KEY) {
        this.activeProvider = 'dry-run';
        this.openaiClient = null;
        this.anthropicClient = null;
      } else {
        this.activeProvider = 'anthropic';
        this.openaiClient = null;
        this.anthropicClient = opts.anthropicClient ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      }
    } else {
      // openai or azure-openai → both use the OpenAI SDK shape.
      if (!process.env.OPENAI_API_KEY) {
        this.activeProvider = 'dry-run';
        this.openaiClient = null;
        this.anthropicClient = null;
      } else {
        this.activeProvider = 'openai';
        this.openaiClient = opts.client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        this.anthropicClient = null;
      }
    }
    this.dryRun = this.activeProvider === 'dry-run';
  }

  isDryRun(): boolean {
    return this.dryRun;
  }

  getProvider(): LLMProvider {
    return this.activeProvider;
  }

  async rootCause(incident: Incident, bundle: ContextBundle): Promise<RootCauseResult> {
    if (this.dryRun) return this.fakeRootCause(incident, bundle);
    const userContent = `${renderEvidenceBlock(incident, bundle)}

# Task
Given the evidence above, classify the issue and propose a root cause.
Return JSON matching the schema. If evidence is weak, set should_attempt_fix=false and confidence accordingly.`;
    const text = await this.callJson({
      purpose: 'root_cause',
      model: this.opts.config.llm.models.analysis,
      systemExtra: '',
      user: userContent,
      bundle,
      incidentId: incident.id,
      schema: RootCauseSchema,
    });
    return text;
  }

  async patchPlan(
    incident: Incident,
    bundle: ContextBundle,
    rootCause: RootCauseResult,
  ): Promise<PatchPlan> {
    if (this.dryRun) return this.fakePatchPlan(incident, bundle, rootCause);
    const userContent = `${renderEvidenceBlock(incident, bundle)}

# Task
Given the root-cause analysis below, plan the smallest viable patch and test strategy.
ROOT_CAUSE_JSON = ${JSON.stringify(rootCause)}
Only list files that already appear in the repository files block. Return JSON.`;
    return this.callJson({
      purpose: 'patch_plan',
      model: this.opts.config.llm.models.patch,
      systemExtra: '',
      user: userContent,
      bundle,
      incidentId: incident.id,
      schema: PatchPlanSchema,
    });
  }

  async codePatch(
    incident: Incident,
    bundle: ContextBundle,
    plan: PatchPlan,
  ): Promise<CodePatch> {
    if (this.dryRun) return this.fakeCodePatch(incident, bundle, plan);
    const userContent = `${renderEvidenceBlock(incident, bundle)}

# Task
Produce a unified diff (git apply format) implementing the plan below.
- Diff paths must be repo-relative (no a/ or b/ prefix is fine if you use --no-prefix patches; prefer including a/ and b/ prefixes).
- Include a small regression test if the plan calls for it.
- Do NOT modify files outside files_to_modify.
PLAN_JSON = ${JSON.stringify(plan)}
Return JSON with the full unified diff in unified_diff.`;
    return this.callJson({
      purpose: 'code_patch',
      model: this.opts.config.llm.models.patch,
      systemExtra: '',
      user: userContent,
      bundle,
      incidentId: incident.id,
      schema: CodePatchSchema,
    });
  }

  async mrExplanation(incident: Incident, bundle: ContextBundle, plan: PatchPlan): Promise<string> {
    if (this.dryRun) {
      return `KafuOps generated a patch for ${incident.id}. Root area: ${plan.files_to_modify.join(
        ', ',
      )}. Manual review required.`;
    }
    const userContent = `${renderEvidenceBlock(incident, bundle)}

# Task
Write a concise, human-readable MR description explaining what changed, why, and how it was validated.
Plan: ${JSON.stringify(plan)}
Return JSON: { "text": "..." }`;
    const result = await this.callJson({
      purpose: 'mr_explanation',
      model: this.opts.config.llm.models.analysis,
      systemExtra: '',
      user: userContent,
      bundle,
      incidentId: incident.id,
      schema: z.object({ text: z.string() }),
    });
    return result.text;
  }

  private async callJson<T>(args: {
    purpose: string;
    model: string;
    systemExtra: string;
    user: string;
    bundle: ContextBundle;
    incidentId: string;
    schema: z.ZodType<T>;
  }): Promise<T> {
    const tokenEstimate = Math.ceil((args.user.length + SYSTEM_BASE.length) / 4);
    log.debug(
      `LLM call provider=${this.activeProvider} purpose=${args.purpose} model=${args.model} ~${tokenEstimate} tokens`,
    );
    let text: string;
    if (this.activeProvider === 'openai') {
      text = await this.callOpenAI(args);
    } else if (this.activeProvider === 'anthropic') {
      text = await this.callAnthropic(args);
    } else {
      throw new Error('LLM client not initialized');
    }
    const cleaned = extractJson(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new Error(`LLM did not return valid JSON for ${args.purpose}: ${(err as Error).message}`);
    }
    const result = args.schema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `LLM response did not match schema for ${args.purpose}: ${result.error.issues.map((i) => i.message).join(', ')}`,
      );
    }
    this.audit.record({
      incident_id: args.incidentId,
      purpose: args.purpose,
      model: args.model,
      bundle: args.bundle,
      prompt_token_estimate: tokenEstimate,
      response_summary: JSON.stringify(result.data).slice(0, 500),
    });
    return result.data;
  }

  private async callOpenAI(args: {
    purpose: string;
    model: string;
    systemExtra: string;
    user: string;
  }): Promise<string> {
    if (!this.openaiClient) throw new Error('OpenAI client not initialized');
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: `${SYSTEM_BASE}\n${args.systemExtra}` },
      { role: 'user', content: args.user },
    ];
    const completion = await this.openaiClient.chat.completions.create({
      model: args.model,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });
    return completion.choices[0]?.message?.content ?? '{}';
  }

  /**
   * Anthropic adapter. Uses the standard Messages API and asks the model to
   * return JSON. We do not use the beta `output_format` structured-outputs
   * feature yet because the orchestrator already validates with zod and we
   * want to keep the provider surface portable.
   */
  private async callAnthropic(args: {
    purpose: string;
    model: string;
    systemExtra: string;
    user: string;
  }): Promise<string> {
    if (!this.anthropicClient) throw new Error('Anthropic client not initialized');
    const system = [
      `${SYSTEM_BASE}\n${args.systemExtra}`,
      'Reply with a single JSON object — no prose, no markdown fences, no preamble.',
    ].join('\n');
    const message = await this.anthropicClient.messages.create({
      model: args.model,
      max_tokens: this.opts.config.llm.anthropic_max_tokens,
      temperature: 0.1,
      system,
      messages: [{ role: 'user', content: args.user }],
    });
    // Concatenate text blocks (Anthropic returns content as an array of blocks
    // that may include text / tool_use / thinking blocks). We only want text.
    const out: string[] = [];
    for (const block of message.content) {
      if (block.type === 'text' && 'text' in block) {
        out.push((block as { text: string }).text);
      }
    }
    return out.join('');
  }

  // -------- dry-run fakes -------- //

  private fakeRootCause(incident: Incident, bundle: ContextBundle): RootCauseResult {
    const top = bundle.files[0]?.path;
    const reason = top
      ? `Stack trace points at ${top}; likely a null/undefined access path based on event message.`
      : 'No clear stack frame; insufficient telemetry.';
    return {
      classification: top ? 'code_bug' : 'insufficient_telemetry',
      suspected_root_cause: reason,
      evidence: [
        `Service ${incident.service} env=${incident.environment}`,
        `Top frame: ${incident.top_frame_file ?? 'unknown'}`,
        `Events: ${incident.event_count}`,
      ],
      files_to_read_next: bundle.files.slice(0, 3).map((f) => f.path),
      should_attempt_fix: !!top,
      confidence: top ? 0.6 : 0.25,
    };
  }

  private fakePatchPlan(_: Incident, bundle: ContextBundle, rc: RootCauseResult): PatchPlan {
    const fileMod = bundle.files.find((f) => f.evidence_strength === 'high' && !f.path.includes('test'))?.path;
    const testFile = bundle.files.find((f) => /test|spec/.test(f.path))?.path;
    return {
      patch_type: fileMod ? 'bug_fix' : 'investigation_only',
      files_to_modify: [fileMod, testFile].filter((x): x is string => !!x),
      test_strategy: testFile
        ? `Add a regression test in ${testFile} that reproduces the failing input.`
        : 'No test scaffolding detected — add a new minimal test file.',
      risk_level: rc.classification === 'code_bug' ? 'low' : 'medium',
      reason: rc.suspected_root_cause,
    };
  }

  private fakeCodePatch(_: Incident, bundle: ContextBundle, plan: PatchPlan): CodePatch {
    return {
      unified_diff: '',
      summary: `Dry-run patch placeholder. Plan: ${plan.reason}`,
      new_test_files: [],
    };
  }
}

/**
 * Some providers (notably Anthropic) occasionally wrap JSON in ```json fences
 * or add a sentence of preamble even when instructed not to. Strip those so we
 * can hand a clean string to JSON.parse.
 */
function extractJson(text: string): string {
  const trimmed = text.trim();
  // ```json ... ```  or  ``` ... ```
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (fenced) return fenced[1].trim();
  // First balanced { ... } in the response.
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}
