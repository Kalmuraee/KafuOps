import { spawn } from 'node:child_process';

export interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  shell?: boolean;
  /** Cap captured stdout/stderr at this many bytes. */
  maxBuffer?: number;
}

/**
 * Run a command without ever using string interpolation in a shell. Pass argv.
 * If you need shell semantics, pass `shell: true` and quote properly.
 */
export function run(command: string, args: string[], opts: RunOptions = {}): Promise<ShellResult> {
  return new Promise((resolve) => {
    const maxBuffer = opts.maxBuffer ?? 1024 * 1024 * 4;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: opts.shell ?? false,
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 1500).unref();
        }, opts.timeoutMs)
      : null;
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < maxBuffer) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < maxBuffer) stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
  });
}

/** Run a command via the user's shell. Use when invoking config-provided commands like `npm test`. */
export function runShell(command: string, opts: RunOptions = {}): Promise<ShellResult> {
  return run(command, [], { ...opts, shell: true });
}

export function tail(text: string, lines = 30): string {
  const arr = text.split(/\r?\n/);
  return arr.slice(Math.max(0, arr.length - lines)).join('\n');
}
