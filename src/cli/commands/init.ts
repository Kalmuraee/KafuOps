import fs from 'node:fs';
import path from 'node:path';
import prompts from 'prompts';
import { ConfigSchema, KafuOpsConfig } from '../../config/schema.js';
import { detectFramework } from '../../scanner/framework.js';
import { writeConfig } from '../../config/loader.js';
import { ensureDirs, getPaths } from '../../util/paths.js';
import { log } from '../../util/logger.js';

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
  let answers: any;
  if (options.yes) {
    answers = {
      name: fw.service_name ?? path.basename(cwd),
      language: fw.language,
      framework: fw.framework,
      provider: 'none',
      mode: 'wrapper',
      llmProvider: 'openai',
      analysisModel: 'gpt-4o-mini',
      patchModel: 'gpt-4o-mini',
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
        { type: 'text', name: 'analysisModel', message: 'Model for analysis', initial: 'gpt-4o-mini' },
        { type: 'text', name: 'patchModel', message: 'Model for code patches', initial: 'gpt-4o-mini' },
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
    repo: { provider: answers.provider },
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

  log.ok(`Created ${configPath}`);
  log.ok(`Created ${paths.base}/`);
  log.info('');
  log.info('Next:');
  log.info('  kafuops doctor');
  log.info('  kafuops scan');
  log.info('  kafuops run -- <your backend command>');
}
