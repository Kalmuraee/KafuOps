export type ModelProvider = 'openai' | 'anthropic';

export interface ModelFetchResult {
  models: string[];
  /** 'live' = fetched from the provider; 'fallback' = curated list (offline/error). */
  source: 'live' | 'fallback';
}

export interface FetchOpts {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Curated fallbacks used when the provider's model list can't be fetched. */
export const CURATED: Record<ModelProvider, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'o4-mini'],
  anthropic: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
};

const NON_CHAT = /(embedding|tts|whisper|audio|realtime|transcribe|image|dall|moderation|search|instruct|babbage|davinci|ada|curie)/i;

/** Keep only chat-capable OpenAI model ids. */
export function filterOpenAIChatModels(ids: string[]): string[] {
  const chatLike = (id: string): boolean =>
    (/^(gpt-|o1|o3|o4|chatgpt)/i.test(id)) && !NON_CHAT.test(id);
  return [...new Set(ids.filter(chatLike))].sort((a, b) => b.localeCompare(a));
}

async function getJson(
  url: string,
  headers: Record<string, string>,
  opts: FetchOpts,
): Promise<unknown | null> {
  const f = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await f(url, { headers, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchOpenAIModels(apiKey: string, opts: FetchOpts = {}): Promise<ModelFetchResult> {
  const data = (await getJson('https://api.openai.com/v1/models', { Authorization: `Bearer ${apiKey}` }, opts)) as
    | { data?: Array<{ id: string }> }
    | null;
  const ids = data?.data?.map((m) => m.id);
  if (!ids || !ids.length) return { models: CURATED.openai, source: 'fallback' };
  const models = filterOpenAIChatModels(ids);
  return models.length ? { models, source: 'live' } : { models: CURATED.openai, source: 'fallback' };
}

export async function fetchAnthropicModels(apiKey: string, opts: FetchOpts = {}): Promise<ModelFetchResult> {
  const data = (await getJson(
    'https://api.anthropic.com/v1/models',
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    opts,
  )) as { data?: Array<{ id: string }> } | null;
  const ids = data?.data?.map((m) => m.id).filter(Boolean);
  if (!ids || !ids.length) return { models: CURATED.anthropic, source: 'fallback' };
  return { models: [...new Set(ids)].sort((a, b) => b.localeCompare(a)), source: 'live' };
}

export async function fetchModels(
  provider: ModelProvider,
  apiKey: string,
  opts: FetchOpts = {},
): Promise<ModelFetchResult> {
  return provider === 'anthropic' ? fetchAnthropicModels(apiKey, opts) : fetchOpenAIModels(apiKey, opts);
}

/**
 * Pick sensible defaults from a model list: a fast/cheap model for analysis and a
 * stronger one for patch generation.
 */
export function pickDefaults(provider: ModelProvider, models: string[]): { analysis: string; patch: string } {
  if (!models.length) {
    const c = CURATED[provider];
    return { analysis: c[1] ?? c[0], patch: c[0] };
  }
  const fast = models.find((m) => /mini|haiku|small|flash|nano/i.test(m)) ?? models[0];
  const strong =
    models.find((m) => /(sonnet|opus|gpt-4o$|gpt-4\.1$|gpt-4$|o3$)/i.test(m) && !/mini|haiku|nano/i.test(m)) ??
    models.find((m) => !/mini|haiku|nano/i.test(m)) ??
    models[0];
  return { analysis: fast, patch: strong };
}
