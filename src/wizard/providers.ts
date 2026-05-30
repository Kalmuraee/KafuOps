import { AiTooling } from './discover.js';

export interface ProviderChoice {
  title: string;
  value: 'codex' | 'claude-cli' | 'openai' | 'anthropic' | 'none';
  description?: string;
}

/**
 * Build the LLM-provider menu for the wizard, ordered by least friction:
 * detected local CLIs first (no API key needed), then API providers (annotated
 * if a key is already in the environment), then "none".
 */
export function buildProviderChoices(tooling: AiTooling): ProviderChoice[] {
  const choices: ProviderChoice[] = [];
  if (tooling.codexCli) {
    choices.push({ title: 'OpenAI Codex CLI (local, no API key)', value: 'codex', description: 'detected on PATH' });
  }
  if (tooling.claudeCli) {
    choices.push({ title: 'Claude CLI (local, no API key)', value: 'claude-cli', description: 'detected on PATH' });
  }
  choices.push({
    title: `OpenAI API${tooling.openaiKeyEnv ? ' (key in env)' : ''}`,
    value: 'openai',
  });
  choices.push({
    title: `Anthropic Claude API${tooling.anthropicKeyEnv ? ' (key in env)' : ''}`,
    value: 'anthropic',
  });
  choices.push({ title: 'None for now (offline heuristics)', value: 'none' });
  return choices;
}
