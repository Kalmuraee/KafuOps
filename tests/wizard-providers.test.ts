import { describe, it, expect } from 'vitest';
import { buildProviderChoices } from '../src/wizard/providers.js';

describe('buildProviderChoices', () => {
  it('lists detected local CLIs first (zero-config), then APIs, then none', () => {
    const choices = buildProviderChoices({ codexCli: true, claudeCli: true, openaiKeyEnv: false, anthropicKeyEnv: false });
    const values = choices.map((c) => c.value);
    expect(values.slice(0, 2)).toEqual(['codex', 'claude-cli']);
    expect(values).toContain('openai');
    expect(values).toContain('anthropic');
    expect(values[values.length - 1]).toBe('none');
  });

  it('omits CLI options that are not installed', () => {
    const choices = buildProviderChoices({ codexCli: false, claudeCli: false, openaiKeyEnv: true, anthropicKeyEnv: false });
    const values = choices.map((c) => c.value);
    expect(values).not.toContain('codex');
    expect(values).not.toContain('claude-cli');
    expect(values[0]).toBe('openai');
  });

  it('annotates API providers whose key is already in the environment', () => {
    const choices = buildProviderChoices({ codexCli: false, claudeCli: false, openaiKeyEnv: true, anthropicKeyEnv: false });
    const openai = choices.find((c) => c.value === 'openai')!;
    expect(openai.title.toLowerCase()).toContain('key in env');
  });
});
