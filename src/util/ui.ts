import ora from 'ora';
import chalk from 'chalk';
import { log } from './logger.js';

const ANSI_RE = /\[[0-9;]*m/g;

/** Visible length of a string, ignoring ANSI color codes. */
export function visibleLen(s: string): number {
  return s.replace(ANSI_RE, '').length;
}

/**
 * Render a titled, aligned Unicode box around a set of lines. Lines may contain
 * ANSI colors (width is measured on visible text). Pure — returns a string.
 */
export function box(title: string, lines: string[]): string {
  const w = Math.max(visibleLen(title), ...lines.map(visibleLen), 12);
  const bar = '─'.repeat(w + 2);
  const pad = (l: string): string => `│ ${l}${' '.repeat(w - visibleLen(l))} │`;
  return [
    chalk.dim('╭') + chalk.dim(bar) + chalk.dim('╮'),
    pad(chalk.bold.cyan(title)),
    chalk.dim('├') + chalk.dim(bar) + chalk.dim('┤'),
    ...lines.map(pad),
    chalk.dim('╰') + chalk.dim(bar) + chalk.dim('╯'),
  ].join('\n');
}

/** Print a box via the logger (skipped cleanly in JSON-logging mode). */
export function printBox(title: string, lines: string[]): void {
  if (process.env.KAFUOPS_LOG_FORMAT === 'json') {
    log.info(title);
    for (const l of lines) log.info(l.replace(ANSI_RE, ''));
    return;
  }
  for (const row of box(title, lines).split('\n')) console.log(row);
}

export interface Spin {
  update(text: string): void;
  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
}

/**
 * A spinner that animates on an interactive TTY and degrades to plain log lines
 * in CI / non-TTY / JSON-logging mode (so output stays clean and parseable).
 */
export function spinner(text: string): Spin {
  const quiet = !process.stdout.isTTY || process.env.KAFUOPS_LOG_FORMAT === 'json';
  if (quiet) {
    return {
      update() {},
      succeed(t) {
        if (t) log.ok(t);
      },
      fail(t) {
        if (t) log.error(t);
      },
      stop() {},
    };
  }
  const o = ora({ text, color: 'cyan' }).start();
  return {
    update(t) {
      o.text = t;
    },
    succeed(t) {
      o.succeed(t);
    },
    fail(t) {
      o.fail(t);
    },
    stop() {
      o.stop();
    },
  };
}
