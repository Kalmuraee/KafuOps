import { KafuOpsConfig } from '../config/schema.js';

export interface RedactionPattern {
  name: string;
  regex: RegExp;
  replace_with: string;
}

export interface RedactionStats {
  patterns_matched: Record<string, number>;
}

export interface RedactionResult {
  text: string;
  stats: RedactionStats;
}

const DEFAULT_PATTERNS: RedactionPattern[] = [
  {
    name: 'email',
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replace_with: '[REDACTED_EMAIL]',
  },
  {
    name: 'bearer_token',
    regex: /Bearer\s+[A-Za-z0-9._\-]+/g,
    replace_with: 'Bearer [REDACTED_TOKEN]',
  },
  {
    name: 'jwt_like_token',
    regex: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replace_with: '[REDACTED_JWT]',
  },
  {
    name: 'api_key_param',
    regex: /(api[_-]?key|secret|token)=([^\s&"']+)/gi,
    replace_with: '$1=[REDACTED_SECRET]',
  },
  {
    name: 'credit_card_like',
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    replace_with: '[REDACTED_CARD]',
  },
  {
    name: 'aws_access_key',
    regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replace_with: '[REDACTED_AWS_KEY]',
  },
  {
    name: 'private_key_block',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace_with: '[REDACTED_PRIVATE_KEY]',
  },
  {
    name: 'ipv4',
    regex: /\b(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}\b/g,
    replace_with: '[REDACTED_IP]',
  },
];

export interface RedactorOptions {
  /** Per-pattern construction-time budget in ms. Patterns slower than this on a
   *  pathological input are rejected (logged via console.warn) to mitigate ReDoS
   *  from config-supplied regexes. */
  patternProbeBudgetMs?: number;
  /** Total redactText() budget in ms. If any pattern's `.replace()` blows past this
   *  cumulative time we short-circuit and stop redaction. */
  totalRedactBudgetMs?: number;
}

export class Redactor {
  private readonly patterns: RedactionPattern[];
  private readonly jsonFields: Set<string>;
  private readonly enabled: boolean;
  private readonly rejectedPatterns: Array<{ name: string; reason: string }> = [];
  private readonly totalBudgetMs: number;

  constructor(config: KafuOpsConfig, opts: RedactorOptions = {}) {
    this.enabled = config.redaction.enabled;
    this.totalBudgetMs = opts.totalRedactBudgetMs ?? 500;
    const probeBudget = opts.patternProbeBudgetMs ?? 50;
    // Default patterns are trusted (we wrote them). User-defined patterns go through
    // a ReDoS probe before being installed.
    const byName = new Map<string, RedactionPattern>();
    for (const p of DEFAULT_PATTERNS) byName.set(p.name, p);
    for (const raw of config.redaction.patterns) {
      // Static check first: this is the only way to reject a regex without
      // running it. JS regex execution cannot be interrupted, so a runtime probe
      // alone is insufficient — a pathological pattern can hang for minutes.
      const staticIssue = looksUnsafe(raw.regex);
      if (staticIssue) {
        this.rejectedPatterns.push({ name: raw.name, reason: staticIssue });
        continue;
      }
      let regex: RegExp;
      try {
        regex = new RegExp(raw.regex, 'g');
      } catch (err) {
        this.rejectedPatterns.push({
          name: raw.name,
          reason: `invalid regex: ${(err as Error).message}`,
        });
        continue;
      }
      const probe = probeRegex(regex, probeBudget);
      if (!probe.ok) {
        this.rejectedPatterns.push({ name: raw.name, reason: probe.reason });
        continue;
      }
      byName.set(raw.name, {
        name: raw.name,
        regex,
        replace_with: raw.replace_with,
      });
    }
    this.patterns = [...byName.values()];
    this.jsonFields = new Set(config.redaction.json_fields.map((f) => f.toLowerCase()));
  }

  /** Patterns rejected for ReDoS or invalid syntax. Surfaced by `kafuops doctor`. */
  getRejectedPatterns(): Array<{ name: string; reason: string }> {
    return [...this.rejectedPatterns];
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Apply all configured patterns to a string. Counts matches per pattern.
   *
   * If cumulative work exceeds the configured total budget (default 500ms), the
   * remaining patterns are skipped and the partially-redacted text is returned.
   * This is a defensive cap — patterns that pass the constructor probe are
   * usually safe, but the budget protects us from worst-case inputs. */
  redactText(input: string): RedactionResult {
    if (!this.enabled || input == null) {
      return { text: String(input ?? ''), stats: { patterns_matched: {} } };
    }
    const started = Date.now();
    let text = input;
    const matched: Record<string, number> = {};
    for (const p of this.patterns) {
      if (Date.now() - started > this.totalBudgetMs) {
        matched['__budget_exceeded__'] = (matched['__budget_exceeded__'] ?? 0) + 1;
        break;
      }
      // Reset lastIndex because regex is global.
      p.regex.lastIndex = 0;
      let count = 0;
      text = text.replace(p.regex, (...args) => {
        count += 1;
        // Build replacement using captured groups: replace_with may reference $1, $2.
        const replacement = p.replace_with.replace(/\$(\d)/g, (_, n) => {
          const groupIndex = Number(n);
          const groupValue = args[groupIndex];
          return typeof groupValue === 'string' ? groupValue : '';
        });
        return replacement;
      });
      if (count > 0) matched[p.name] = (matched[p.name] ?? 0) + count;
    }
    return { text, stats: { patterns_matched: matched } };
  }

  /**
   * Walk an arbitrary JSON-like value. Redact string leaves through `redactText` and
   * scrub configured field names entirely (replace their value with [REDACTED_FIELD]).
   */
  redactJson(value: unknown): { value: unknown; stats: RedactionStats } {
    const stats: RedactionStats = { patterns_matched: {} };
    const merge = (extra: RedactionStats): void => {
      for (const [k, v] of Object.entries(extra.patterns_matched)) {
        stats.patterns_matched[k] = (stats.patterns_matched[k] ?? 0) + v;
      }
    };
    const recurse = (v: unknown): unknown => {
      if (v == null) return v;
      if (typeof v === 'string') {
        const r = this.redactText(v);
        merge(r.stats);
        return r.text;
      }
      if (Array.isArray(v)) {
        return v.map(recurse);
      }
      if (typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          if (this.jsonFields.has(k.toLowerCase())) {
            stats.patterns_matched['json_field_' + k.toLowerCase()] =
              (stats.patterns_matched['json_field_' + k.toLowerCase()] ?? 0) + 1;
            out[k] = '[REDACTED_FIELD]';
          } else {
            out[k] = recurse(val);
          }
        }
        return out;
      }
      return v;
    };
    return { value: recurse(value), stats };
  }

  /**
   * Heuristic ReDoS probe: time the regex against a benign 128-char input and a
   * pathological input that triggers catastrophic backtracking when the pattern
   * has nested quantifiers. Reject if either exceeds the budget.
   */

  /** Combine many per-call stats. */
  static mergeStats(stats: RedactionStats[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of stats) {
      for (const [k, v] of Object.entries(s.patterns_matched)) {
        out[k] = (out[k] ?? 0) + v;
      }
    }
    return out;
  }
}

/**
 * Static heuristic: flag regex shapes known to cause catastrophic backtracking
 * BEFORE we ever execute them. This is the only reliable guard, because JS regex
 * execution cannot be interrupted.
 *
 * Patterns we reject (returning a non-empty reason):
 *  - nested quantifiers inside a quantified group:  (a+)+   (.*)+   (\w+)*
 *  - overlapping alternation under a quantifier:    (a|a)+  (x|xy)+
 */
function looksUnsafe(source: string): string | null {
  // Group containing a +/*/? immediately followed by another +/*: classic ReDoS.
  // We strip character classes first so quantifiers inside [] don't trip the check.
  const stripped = source.replace(/\[[^\]]*\]/g, '_');
  if (/\((?:[^()]*[*+?])+[^()]*\)\s*[*+?]/.test(stripped)) {
    return 'nested quantifier inside a quantified group (catastrophic backtracking risk)';
  }
  if (/\([^()]*\([^()]*[*+?][^()]*\)[^()]*\)\s*[*+?]/.test(stripped)) {
    return 'nested quantifier inside a quantified outer group (catastrophic backtracking risk)';
  }
  // Alternation with identical branches under a quantifier, e.g. (a|a)+
  const altMatch = /\(([^()|]+)\|\1\)[*+?]/.exec(stripped);
  if (altMatch) {
    return 'alternation with identical branches under a quantifier (ReDoS risk)';
  }
  return null;
}

/**
 * Time the regex against benign + pathological inputs. Catches edge cases that
 * the static check misses. The static check is the primary guard; this is a
 * defensive secondary check using a small (~20 char) pathological input so it
 * never hangs for long even if the static check misses something.
 */
function probeRegex(re: RegExp, budgetMs: number): { ok: true } | { ok: false; reason: string } {
  // Build a known-pathological input for nested-quantifier patterns like /(a+)+$/.
  // Kept short (length 20) so the worst-case probe finishes within ~seconds even
  // for patterns that slipped past the static check.
  const benign = 'a'.repeat(64) + ' ' + 'b'.repeat(64);
  const pathological = 'a'.repeat(20) + '!';
  const inputs = [benign, pathological];
  const safeRe = new RegExp(re.source, re.flags.replace('g', '')); // single-shot variant
  const start = Date.now();
  try {
    for (const input of inputs) {
      const t0 = Date.now();
      safeRe.lastIndex = 0;
      safeRe.test(input);
      const elapsed = Date.now() - t0;
      if (elapsed > budgetMs) {
        return {
          ok: false,
          reason: `regex exceeded ${budgetMs}ms ReDoS budget on probe input (took ${elapsed}ms)`,
        };
      }
    }
  } catch (err) {
    return { ok: false, reason: `regex threw during probe: ${(err as Error).message}` };
  }
  const total = Date.now() - start;
  if (total > budgetMs * 4) {
    return { ok: false, reason: `regex total probe time exceeded ${budgetMs * 4}ms (${total}ms)` };
  }
  return { ok: true };
}
