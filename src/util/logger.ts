import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let currentLevel: LogLevel = (process.env.KAFUOPS_LOG_LEVEL as LogLevel) || 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function should(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[currentLevel];
}

const ANSI = /\[[0-9;]*m/g;

/** Render a log line as a single-line JSON object (machine-readable mode). */
export function formatJsonLog(level: string, msg: string, ts = new Date().toISOString()): string {
  return JSON.stringify({ ts, level, msg: msg.replace(ANSI, '') });
}

/** Structured-logging mode, opt-in via KAFUOPS_LOG_FORMAT=json (good for k8s/agents). */
function jsonMode(): boolean {
  return process.env.KAFUOPS_LOG_FORMAT === 'json';
}

function emit(level: LogLevel, human: string, plain: string, rest: unknown[] = []): void {
  if (jsonMode()) {
    const extra = rest.length ? ` ${rest.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join(' ')}` : '';
    console.log(formatJsonLog(level, plain + extra));
    return;
  }
  console.log(human, ...rest);
}

export const log = {
  debug: (msg: string, ...rest: unknown[]) => {
    if (should('debug')) emit('debug', chalk.gray(`[debug] ${msg}`), `[debug] ${msg}`, rest);
  },
  info: (msg: string, ...rest: unknown[]) => {
    if (should('info')) emit('info', msg, msg, rest);
  },
  ok: (msg: string) => {
    if (should('info')) emit('info', `${chalk.green('✓')} ${msg}`, `✓ ${msg}`);
  },
  warn: (msg: string, ...rest: unknown[]) => {
    if (should('warn')) emit('warn', `${chalk.yellow('!')} ${msg}`, `! ${msg}`, rest);
  },
  error: (msg: string, ...rest: unknown[]) => {
    if (should('error')) {
      if (jsonMode()) {
        console.error(formatJsonLog('error', msg));
        return;
      }
      console.error(`${chalk.red('✗')} ${msg}`, ...rest);
    }
  },
  banner: (msg: string) => {
    if (jsonMode()) {
      console.log(formatJsonLog('info', msg));
      return;
    }
    console.log(chalk.bold.cyan(msg));
  },
  dim: (msg: string) => {
    if (should('info')) emit('info', chalk.dim(msg), msg);
  },
};
