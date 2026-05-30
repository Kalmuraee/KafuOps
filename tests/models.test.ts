import { describe, it, expect } from 'vitest';
import {
  filterOpenAIChatModels,
  fetchOpenAIModels,
  fetchAnthropicModels,
  pickDefaults,
  CURATED,
} from '../src/llm/models.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('filterOpenAIChatModels', () => {
  it('keeps chat models and drops embeddings/audio/image/etc', () => {
    const ids = ['gpt-4o', 'gpt-4o-mini', 'o3', 'text-embedding-3-large', 'tts-1', 'dall-e-3', 'whisper-1', 'gpt-4o-realtime-preview', 'davinci-002'];
    const out = filterOpenAIChatModels(ids);
    expect(out).toContain('gpt-4o');
    expect(out).toContain('gpt-4o-mini');
    expect(out).toContain('o3');
    expect(out).not.toContain('text-embedding-3-large');
    expect(out).not.toContain('tts-1');
    expect(out).not.toContain('dall-e-3');
    expect(out).not.toContain('whisper-1');
    expect(out).not.toContain('gpt-4o-realtime-preview');
    expect(out).not.toContain('davinci-002');
  });
});

describe('fetchOpenAIModels', () => {
  it('returns filtered live models', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'text-embedding-3-small' }] })) as unknown as typeof fetch;
    const res = await fetchOpenAIModels('sk', { fetchImpl });
    expect(res.source).toBe('live');
    expect(res.models).toEqual(expect.arrayContaining(['gpt-4o', 'gpt-4o-mini']));
    expect(res.models).not.toContain('text-embedding-3-small');
  });

  it('falls back to the curated list on error', async () => {
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const res = await fetchOpenAIModels('sk', { fetchImpl });
    expect(res.source).toBe('fallback');
    expect(res.models).toEqual(CURATED.openai);
  });

  it('falls back on a non-OK response', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'nope' }, 401)) as unknown as typeof fetch;
    const res = await fetchOpenAIModels('sk', { fetchImpl });
    expect(res.source).toBe('fallback');
  });
});

describe('fetchAnthropicModels', () => {
  it('parses the models list', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ data: [{ id: 'claude-opus-4-8' }, { id: 'claude-sonnet-4-6' }] })) as unknown as typeof fetch;
    const res = await fetchAnthropicModels('sk', { fetchImpl });
    expect(res.source).toBe('live');
    expect(res.models).toContain('claude-opus-4-8');
  });

  it('falls back when offline', async () => {
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const res = await fetchAnthropicModels('sk', { fetchImpl });
    expect(res.source).toBe('fallback');
    expect(res.models).toEqual(CURATED.anthropic);
  });
});

describe('pickDefaults', () => {
  it('picks a fast model for analysis and a strong model for patch', () => {
    const d = pickDefaults('openai', ['gpt-4o', 'gpt-4o-mini', 'o3']);
    expect(d.analysis).toMatch(/mini/);
    expect(d.patch).not.toMatch(/mini/);
  });

  it('works for anthropic (haiku vs sonnet/opus)', () => {
    const d = pickDefaults('anthropic', ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
    expect(d.analysis).toMatch(/haiku/);
    expect(d.patch).toMatch(/sonnet|opus/);
  });

  it('degrades gracefully for a single-model list', () => {
    const d = pickDefaults('openai', ['gpt-4o']);
    expect(d.analysis).toBe('gpt-4o');
    expect(d.patch).toBe('gpt-4o');
  });
});
