import { describe, it, expect } from 'vitest';
import { buildDockerCommand, substituteTestCommand } from '../src/sandbox/runner.js';

describe('buildDockerCommand', () => {
  it('builds a docker run invocation mounting the workdir and running the command', () => {
    const { cmd, args } = buildDockerCommand({
      image: 'node:22',
      workdir: '/tmp/sandbox/repo',
      command: 'npm ci',
    });
    expect(cmd).toBe('docker');
    expect(args).toContain('run');
    expect(args).toContain('--rm');
    // Mounts the workdir into the container.
    expect(args.join(' ')).toContain('/tmp/sandbox/repo:/workspace');
    expect(args).toContain('node:22');
    // Runs the command through a shell inside the container.
    expect(args[args.length - 1]).toContain('npm ci');
  });
});

describe('substituteTestCommand', () => {
  it('substitutes {test_file} into a targeted test command', () => {
    expect(substituteTestCommand('npm test -- {test_file}', 'tests/payment.test.ts')).toBe(
      'npm test -- tests/payment.test.ts',
    );
  });

  it('leaves the command unchanged when there is no placeholder', () => {
    expect(substituteTestCommand('pytest', 'tests/x_test.py')).toBe('pytest');
  });
});
