import fs from 'node:fs';
import path from 'node:path';
import prompts from 'prompts';
import { ConfigSchema, KafuOpsConfig } from '../../config/schema.js';
import { writeConfig } from '../../config/loader.js';
import { ensureDirs, getPaths } from '../../util/paths.js';
import { runDiscovery, DiscoveryResult } from '../../wizard/discover.js';
import { buildProviderChoices } from '../../wizard/providers.js';
import { fetchModels, pickDefaults, CURATED, ModelProvider } from '../../llm/models.js';
import { log } from '../../util/logger.js';

export interface InitOptions {
  yes?: boolean;
  cwd?: string;
}

const onCancel = (): never => {
  log.info('Aborted.');
  process.exit(1);
};

export async function initCommand(options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = path.join(cwd, '.kafuops.yml');
  if (fs.existsSync(configPath) && !options.yes) {
    const { overwrite } = await prompts({ type: 'confirm', name: 'overwrite', message: '.kafuops.yml exists — overwrite?', initial: false });
    if (!overwrite) return log.info('Aborted.');
  }

  log.banner('KafuOps setup — discovering your service…');
  const d = runDiscovery(cwd);
  printFindings(d);

  const built = options.yes ? configFromDiscovery(d, cwd) : await interactiveConfig(d, cwd);

  writeConfig(configPath, built.config);
  const paths = getPaths(cwd);
  ensureDirs(paths);
  writeEnv(paths.base, cwd, built.secrets);

  log.ok(`Created ${configPath}`);
  log.info('');
  printSummary(built.config, d);
}

// ---------- discovery presentation ----------

function printFindings(d: DiscoveryResult): void {
  log.info('Discovered:');
  log.info(`  • Stack: ${d.framework.language} / ${d.framework.framework}`);
  log.info(`  • Start command: ${d.startCommand ?? '(unknown — you can set it)'}`);
  log.info(`  • Repository: ${d.repo.url ? `${d.repo.url} (${d.repo.provider})` : '(no git remote found)'}`);
  const signals = [
    d.containerization.dockerfile && 'Dockerfile',
    d.containerization.compose && 'docker-compose',
    d.containerization.kubernetes && 'kubernetes/helm',
  ].filter(Boolean);
  log.info(`  • Packaging: ${signals.length ? signals.join(', ') : 'none detected'} → suggested mode: ${d.suggestedMode}`);
  if (d.logFiles.length) log.info(`  • Log files: ${d.logFiles.join(', ')}`);
  const tools = [
    d.tooling.codexCli && 'codex CLI',
    d.tooling.claudeCli && 'claude CLI',
    d.tooling.openaiKeyEnv && 'OPENAI_API_KEY',
    d.tooling.anthropicKeyEnv && 'ANTHROPIC_API_KEY',
  ].filter(Boolean);
  log.info(`  • AI available: ${tools.length ? tools.join(', ') : 'none detected'}`);
  log.info('');
}

// ---------- non-interactive (--yes) ----------

interface BuiltConfig {
  config: KafuOpsConfig;
  secrets: { gitToken?: string; openaiKey?: string; anthropicKey?: string };
}

function configFromDiscovery(d: DiscoveryResult, cwd: string): BuiltConfig {
  const config = ConfigSchema.parse({
    version: 1,
    project: {
      name: d.framework.service_name ?? path.basename(cwd),
      language: d.framework.language,
      framework: d.framework.framework,
      service_name: d.framework.service_name ?? path.basename(cwd),
    },
    repo: { provider: d.repo.provider, url: d.repo.url ?? undefined },
    runtime: { mode: d.suggestedMode, service_command: d.startCommand },
    llm: { provider: 'none', models: { analysis: CURATED.openai[1], patch: CURATED.openai[0] } },
    sandbox: {
      type: d.containerization.dockerfile ? 'docker' : 'local',
      install_command: d.installCommand,
      test_command: d.testCommand,
      targeted_test_command: d.framework.targeted_test_command ?? 'npm test -- {test_file}',
    },
  });
  return { config, secrets: {} };
}

// ---------- interactive ----------

async function interactiveConfig(d: DiscoveryResult, cwd: string): Promise<BuiltConfig> {
  const idx = <T>(arr: T[], v: T): number => Math.max(0, arr.indexOf(v));
  const repoProviders = ['github', 'gitlab', 'none'];
  const modes = ['wrapper', 'sidecar', 'webhook', 'kubernetes'];

  const basics = await prompts(
    [
      { type: 'text', name: 'name', message: 'Project name', initial: d.framework.service_name ?? path.basename(cwd) },
      { type: 'text', name: 'language', message: 'Primary language', initial: d.framework.language },
      { type: 'text', name: 'framework', message: 'Backend framework', initial: d.framework.framework },
      {
        type: 'select', name: 'provider', message: 'Repository provider',
        choices: [{ title: 'GitHub', value: 'github' }, { title: 'GitLab', value: 'gitlab' }, { title: 'None for now', value: 'none' }],
        initial: idx(repoProviders, d.repo.provider),
      },
      { type: (p: string) => (p === 'none' ? null : 'text'), name: 'repoUrl', message: 'Repository URL', initial: d.repo.url ?? '' },
      {
        type: (_: unknown, v: any) => (v.provider !== 'none' && !process.env.KAFUOPS_GIT_TOKEN ? 'password' : null),
        name: 'gitToken', message: 'Git access token (stored in .kafuops/.env, gitignored)',
      },
      {
        type: 'select', name: 'mode', message: 'Runtime mode',
        choices: [
          { title: 'Wrapper — kafuops run -- <cmd> (local/staging)', value: 'wrapper' },
          { title: 'Sidecar — agent + webhooks/log tailing (production)', value: 'sidecar' },
          { title: 'Webhook-only', value: 'webhook' },
          { title: 'Kubernetes', value: 'kubernetes' },
        ],
        initial: idx(modes, d.suggestedMode),
      },
      { type: 'text', name: 'startCommand', message: 'Service start command', initial: d.startCommand ?? '' },
      {
        type: (_: unknown, v: any) => ((v.mode === 'sidecar' || v.mode === 'kubernetes') && d.logFiles.length ? 'text' : null),
        name: 'logSource', message: 'Log file to tail (blank = webhooks/OTel only)', initial: d.logFiles[0] ?? '',
      },
    ],
    { onCancel },
  );

  const { llmProvider } = await prompts(
    { type: 'select', name: 'llmProvider', message: 'AI provider', choices: buildProviderChoices(d.tooling) as any, initial: 0 },
    { onCancel },
  );

  let openaiKey = '';
  let anthropicKey = '';
  let analysisModel = '';
  let patchModel = '';

  if (llmProvider === 'openai' || llmProvider === 'anthropic') {
    const provider = llmProvider as ModelProvider;
    const envVar = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    let key = process.env[envVar] ?? '';
    if (!key) {
      const r = await prompts({ type: 'password', name: 'key', message: `${envVar} (stored in .kafuops/.env, gitignored)` }, { onCancel });
      key = r.key ?? '';
      if (provider === 'anthropic') anthropicKey = key; else openaiKey = key;
    }
    let models = CURATED[provider];
    if (key) {
      log.info('Fetching the latest models for your account…');
      const res = await fetchModels(provider, key);
      models = res.models;
      log.dim(`  ${res.source === 'live' ? `live: ${models.length} models` : 'offline — using a curated list'}`);
    } else {
      log.dim('  No key entered — choosing from a curated model list.');
    }
    const def = pickDefaults(provider, models);
    const sel = await prompts(
      [
        { type: 'select', name: 'analysis', message: 'Model for analysis (fast/cheap)', choices: models.map((m) => ({ title: m, value: m })), initial: idx(models, def.analysis) },
        { type: 'select', name: 'patch', message: 'Model for code patches (strong)', choices: models.map((m) => ({ title: m, value: m })), initial: idx(models, def.patch) },
      ],
      { onCancel },
    );
    analysisModel = sel.analysis;
    patchModel = sel.patch;
  } else if (llmProvider === 'codex' || llmProvider === 'claude-cli') {
    const r = await prompts({ type: 'text', name: 'model', message: 'CLI model (blank = the CLI default)', initial: '' }, { onCancel });
    analysisModel = r.model ?? '';
    patchModel = r.model ?? '';
  } else {
    analysisModel = CURATED.openai[1];
    patchModel = CURATED.openai[0];
  }

  const tail = await prompts(
    [
      { type: 'select', name: 'sandboxType', message: 'Sandbox', choices: [{ title: 'Local', value: 'local' }, { title: 'Docker', value: 'docker' }], initial: d.containerization.dockerfile ? 1 : 0 },
      { type: 'text', name: 'install', message: 'Install command', initial: d.installCommand },
      { type: 'text', name: 'testCommand', message: 'Test command', initial: d.testCommand },
    ],
    { onCancel },
  );

  const runtime: Record<string, unknown> = { mode: basics.mode, service_command: basics.startCommand || null };
  if (basics.logSource) runtime.log_sources = [{ type: 'file', path: basics.logSource }];

  const config = ConfigSchema.parse({
    version: 1,
    project: { name: basics.name, language: basics.language, framework: basics.framework, service_name: basics.name },
    repo: { provider: basics.provider, url: basics.repoUrl || undefined },
    runtime,
    llm: { provider: llmProvider, models: { analysis: analysisModel, patch: patchModel } },
    sandbox: {
      type: tail.sandboxType,
      install_command: tail.install,
      test_command: tail.testCommand,
      targeted_test_command: d.framework.targeted_test_command ?? 'npm test -- {test_file}',
    },
  });

  return { config, secrets: { gitToken: basics.gitToken, openaiKey, anthropicKey } };
}

// ---------- output ----------

function writeEnv(baseDir: string, cwd: string, secrets: BuiltConfig['secrets']): void {
  const lines: string[] = [];
  if (secrets.gitToken) lines.push(`KAFUOPS_GIT_TOKEN=${secrets.gitToken}`);
  if (secrets.openaiKey) lines.push(`OPENAI_API_KEY=${secrets.openaiKey}`);
  if (secrets.anthropicKey) lines.push(`ANTHROPIC_API_KEY=${secrets.anthropicKey}`);
  if (!lines.length) return;
  const envPath = path.join(baseDir, '.env');
  fs.writeFileSync(envPath, lines.join('\n') + '\n', { mode: 0o600 });
  log.ok(`Wrote ${envPath} (mode 0600). Source it before running:`);
  log.dim(`  export $(grep -v '^#' ${path.relative(cwd, envPath)} | xargs)`);
}

function printSummary(config: KafuOpsConfig, d: DiscoveryResult): void {
  log.info('Configured:');
  log.info(`  • Mode: ${config.runtime.mode} · Provider: ${config.llm.provider}`);
  if (config.llm.provider !== 'none') {
    log.info(`  • Models: analysis=${config.llm.models.analysis || '(cli default)'} patch=${config.llm.models.patch || '(cli default)'}`);
  }
  log.info('');
  log.info('Next:');
  log.info('  kafuops doctor');
  log.info('  kafuops scan');
  if (config.runtime.mode === 'wrapper') {
    log.info(`  kafuops run -- ${d.startCommand ?? '<your backend command>'}`);
  } else {
    log.info('  kafuops agent start    # webhook + log-tailing intake');
    log.info('  kafuops worker start   # drive incidents → MRs');
  }
}
