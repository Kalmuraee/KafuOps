import fs from 'node:fs';
import path from 'node:path';
import { loadConfigOrExit } from '../util.js';
import { Redactor } from '../../redaction/index.js';
import { log } from '../../util/logger.js';
import { run } from '../../util/shell.js';

export async function doctorCommand(): Promise<void> {
  const { config, configPath, rootDir } = loadConfigOrExit({ allowMissing: true });
  let errors = 0;
  let warnings = 0;

  log.banner('KafuOps doctor');
  if (!configPath) {
    log.error('No .kafuops.yml found. Run `kafuops init` first.');
    process.exit(1);
  }
  log.ok(`Config: ${configPath}`);

  // Project basics
  log.info(`Project: ${config.project.name} (${config.project.language}/${config.project.framework})`);
  log.info(`Runtime mode: ${config.runtime.mode}`);

  // Git
  const gitCheck = await run('git', ['-C', rootDir, 'rev-parse', '--git-dir']);
  if (gitCheck.code === 0) log.ok('Git: repository detected');
  else {
    log.warn('Git: not a repository (MR creation will not work)');
    warnings++;
  }

  // Git provider
  if (config.repo.provider !== 'none') {
    const hasToken = !!(process.env.KAFUOPS_GIT_TOKEN || process.env.GITHUB_TOKEN || process.env.GITLAB_TOKEN);
    if (hasToken) log.ok(`Git provider (${config.repo.provider}): token detected`);
    else {
      log.warn(`Git provider (${config.repo.provider}): set KAFUOPS_GIT_TOKEN to enable MR creation`);
      warnings++;
    }
    if (!config.repo.url) {
      log.warn('repo.url is not set; MR creation will dry-run');
      warnings++;
    }
  } else {
    log.warn('repo.provider=none; MRs will be dry-run');
    warnings++;
  }

  // LLM — verify the key actually works against the provider. Just checking that
  // the env var is set used to mislead users into thinking dry-run mode was active.
  if (config.llm.provider === 'none') {
    log.warn('llm.provider=none; analysis will use offline heuristics');
    warnings++;
  } else if (!process.env.OPENAI_API_KEY) {
    log.warn('OPENAI_API_KEY not set; LLM calls will run in dry-run mode');
    warnings++;
  } else {
    const live = await checkOpenAIKey();
    if (live.ok) {
      log.ok(`LLM: OPENAI_API_KEY verified (account has access to ${live.modelCount} models)`);
      const requested = [config.llm.models.analysis, config.llm.models.patch];
      const missing = requested.filter((m) => !live.modelIds.has(m));
      if (missing.length) {
        log.warn(
          `Configured model(s) not visible to this key: ${missing.join(', ')}. Update .kafuops.yml or check account access.`,
        );
        warnings++;
      }
    } else {
      log.error(`LLM: OPENAI_API_KEY rejected by provider — ${live.error}`);
      errors++;
    }
  }

  // Redaction
  try {
    const r = new Redactor(config);
    r.redactText('Bearer abc123 user@example.com 4111 1111 1111 1111');
    const rejected = r.getRejectedPatterns();
    if (rejected.length) {
      for (const p of rejected) {
        log.warn(`Redaction: rejected user pattern \`${p.name}\` — ${p.reason}`);
        warnings++;
      }
    } else {
      log.ok('Redaction: pattern compilation OK');
    }
  } catch (err) {
    log.error(`Redaction: failed to compile patterns — ${(err as Error).message}`);
    errors++;
  }

  // Memory dir
  const memDir = path.join(rootDir, '.kafuops', 'memory');
  if (fs.existsSync(memDir)) log.ok(`Memory: ${memDir}`);
  else {
    log.warn('Memory directory missing; run `kafuops scan` to create it.');
    warnings++;
  }

  // Test command sanity
  if (!config.sandbox.test_command) {
    log.warn('sandbox.test_command is empty; patch validation will be limited');
    warnings++;
  } else {
    log.ok(`Sandbox test command: ${config.sandbox.test_command}`);
  }

  log.info('');
  if (errors) log.error(`Doctor: ${errors} error(s), ${warnings} warning(s)`);
  else if (warnings) log.warn(`Doctor: ${warnings} warning(s)`);
  else log.ok('Doctor: all checks passed');
  if (errors) process.exit(2);
}

/**
 * Make a tiny live request to OpenAI to confirm the key is active and to read
 * back the list of accessible model IDs. Times out after 8s so doctor never
 * hangs on network problems.
 */
async function checkOpenAIKey(): Promise<
  | { ok: true; modelCount: number; modelIds: Set<string> }
  | { ok: false; error: string }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      return { ok: false, error: `HTTP ${res.status}: ${body}` };
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = new Set((data.data ?? []).map((m) => m.id));
    return { ok: true, modelCount: ids.size, modelIds: ids };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, error: (err as Error).message };
  }
}
