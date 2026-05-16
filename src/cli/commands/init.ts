import fs from 'node:fs';
import path from 'node:path';
import prompts from 'prompts';
import { ConfigSchema, KafuOpsConfig } from '../../config/schema.js';
import { detectFramework } from '../../scanner/framework.js';
import { writeConfig } from '../../config/loader.js';
import { ensureDirs, getPaths } from '../../util/paths.js';
import { log } from '../../util/logger.js';
// fs is already imported above; we reuse it here for the .env writer.

export interface InitOptions {
  yes?: boolean;
  cwd?: string;
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = path.join(cwd, '.kafuops.yml');
  if (fs.existsSync(configPath)) {
    log.warn(`.kafuops.yml already exists at ${configPath}.`);
    if (!options.yes) {
      const confirm = await prompts({
        type: 'confirm',
        name: 'overwrite',
        message: 'Overwrite?',
        initial: false,
      });
      if (!confirm.overwrite) {
        log.info('Aborted.');
        return;
      }
    }
  }

  const fw = detectFramework(cwd);
  // Default models. These are sensible cheap/strong picks that we know exist;
  // bump them in the wizard or in `.kafuops.yml` to whatever your account
  // currently has access to (the OpenAI catalog moves faster than this MVP).
  const DEFAULT_ANALYSIS_MODEL = 'gpt-4o-mini';
  const DEFAULT_PATCH_MODEL = 'gpt-4o';

  let answers: any;
  if (options.yes) {
    answers = {
      name: fw.service_name ?? path.basename(cwd),
      language: fw.language,
      framework: fw.framework,
      provider: 'none',
      repoUrl: '',
      gitToken: '',
      mode: 'wrapper',
      llmProvider: 'openai',
      openaiKey: '',
      analysisModel: DEFAULT_ANALYSIS_MODEL,
      patchModel: DEFAULT_PATCH_MODEL,
      install: fw.install_command ?? 'npm ci',
      testCommand: fw.test_command ?? 'npm test',
      sandboxType: 'local',
    };
  } else {
    answers = await prompts(
      [
        { type: 'text', name: 'name', message: 'Project name', initial: fw.service_name ?? path.basename(cwd) },
        { type: 'text', name: 'language', message: 'Primary language', initial: fw.language },
        { type: 'text', name: 'framework', message: 'Backend framework', initial: fw.framework },
        {
          type: 'select',
          name: 'provider',
          message: 'Repository provider',
          choices: [
            { title: 'GitHub', value: 'github' },
            { title: 'GitLab', value: 'gitlab' },
            { title: 'None for now', value: 'none' },
          ],
        },
        {
          type: (prev: string) => (prev === 'none' ? null : 'text'),
          name: 'repoUrl',
          message: 'Repository URL (e.g. git@github.com:org/api.git)',
          initial: detectRepoUrl(cwd) ?? '',
        },
        {
          type: (_: unknown, values: any) => (values.provider === 'none' ? null : 'password'),
          name: 'gitToken',
          message: 'Git access token (KAFUOPS_GIT_TOKEN — pasted, stored in .kafuops/.env, gitignored)',
        },
        {
          type: 'select',
          name: 'mode',
          message: 'Runtime mode',
          choices: [
            { title: 'Wrapper (kafuops run -- <cmd>) — recommended for local/staging', value: 'wrapper' },
            { title: 'Sidecar agent — recommended for production', value: 'sidecar' },
            { title: 'Webhook-only', value: 'webhook' },
            { title: 'Kubernetes', value: 'kubernetes' },
          ],
        },
        {
          type: 'select',
          name: 'llmProvider',
          message: 'LLM provider',
          choices: [
            { title: 'OpenAI', value: 'openai' },
            { title: 'Azure OpenAI', value: 'azure-openai' },
            { title: 'None for now', value: 'none' },
          ],
        },
        {
          type: (prev: string) => (prev === 'openai' && !process.env.OPENAI_API_KEY ? 'password' : null),
          name: 'openaiKey',
          message: 'OPENAI_API_KEY (stored in .kafuops/.env, gitignored)',
        },
        {
          type: 'text',
          name: 'analysisModel',
          message: `Model for analysis (default ${DEFAULT_ANALYSIS_MODEL} — bump to your account's current model)`,
          initial: DEFAULT_ANALYSIS_MODEL,
        },
        {
          type: 'text',
          name: 'patchModel',
          message: `Model for code patches (default ${DEFAULT_PATCH_MODEL} — bump to your account's current model)`,
          initial: DEFAULT_PATCH_MODEL,
        },
        { type: 'text', name: 'install', message: 'Install command', initial: fw.install_command ?? 'npm ci' },
        { type: 'text', name: 'testCommand', message: 'Test command', initial: fw.test_command ?? 'npm test' },
        {
          type: 'select',
          name: 'sandboxType',
          message: 'Sandbox type',
          choices: [
            { title: 'Local', value: 'local' },
            { title: 'Docker', value: 'docker' },
          ],
        },
      ],
      { onCancel: () => process.exit(1) },
    );
  }

  const config: KafuOpsConfig = ConfigSchema.parse({
    version: 1,
    project: {
      name: answers.name,
      language: answers.language,
      framework: answers.framework,
      service_name: answers.name,
      default_branch: 'main',
    },
    repo: {
      provider: answers.provider,
      url: answers.repoUrl || undefined,
    },
    runtime: { mode: answers.mode },
    llm: {
      provider: answers.llmProvider,
      models: { analysis: answers.analysisModel, patch: answers.patchModel },
    },
    sandbox: {
      type: answers.sandboxType,
      install_command: answers.install,
      test_command: answers.testCommand,
      targeted_test_command: fw.targeted_test_command ?? 'npm test -- {test_file}',
    },
  });

  writeConfig(configPath, config);
  const paths = getPaths(cwd);
  ensureDirs(paths);

  // Write secrets to .kafuops/.env so they aren't committed and can be sourced
  // by the user or read at runtime. Never write them to .kafuops.yml.
  const envLines: string[] = [];
  if (answers.gitToken) envLines.push(`KAFUOPS_GIT_TOKEN=${answers.gitToken}`);
  if (answers.openaiKey) envLines.push(`OPENAI_API_KEY=${answers.openaiKey}`);
  if (envLines.length) {
    const envPath = path.join(paths.base, '.env');
    fs.writeFileSync(envPath, envLines.join('\n') + '\n', { mode: 0o600 });
    log.ok(`Wrote ${envPath} (mode 0600). Source it before running:`);
    log.dim(`  export $(grep -v '^#' ${path.relative(cwd, envPath)} | xargs)`);
  }

  log.ok(`Created ${configPath}`);
  log.ok(`Created ${paths.base}/`);
  log.info('');
  log.info('Next:');
  log.info('  kafuops doctor');
  log.info('  kafuops scan');
  log.info('  kafuops run -- <your backend command>');
}

/**
 * Best-effort: parse `git remote get-url origin` so the wizard can pre-fill
 * the repo URL if the directory is already a git checkout.
 */
function detectRepoUrl(cwd: string): string | null {
  try {
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
    const res = spawnSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout) return res.stdout.trim();
  } catch {
    // ignore
  }
  return null;
}
