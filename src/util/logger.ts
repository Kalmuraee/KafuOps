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

export const log = {
  debug: (msg: string, ...rest: unknown[]) => {
    if (should('debug')) console.log(chalk.gray(`[debug] ${msg}`), ...rest);
  },
  info: (msg: string, ...rest: unknown[]) => {
    if (should('info')) console.log(msg, ...rest);
  },
  ok: (msg: string) => {
    if (should('info')) console.log(`${chalk.green('✓')} ${msg}`);
  },
  warn: (msg: string, ...rest: unknown[]) => {
    if (should('warn')) console.log(`${chalk.yellow('!')} ${msg}`, ...rest);
  },
  error: (msg: string, ...rest: unknown[]) => {
    if (should('error')) console.error(`${chalk.red('✗')} ${msg}`, ...rest);
  },
  banner: (msg: string) => {
    console.log(chalk.bold.cyan(msg));
  },
  dim: (msg: string) => {
    if (should('info')) console.log(chalk.dim(msg));
  },
};
