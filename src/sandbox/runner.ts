import fs from 'node:fs';
import path from 'node:path';
import { simpleGit, SimpleGit } from 'simple-git';
import { KafuOpsConfig } from '../config/schema.js';
import { CodePatch, Incident, ValidationResult } from '../types/index.js';
import { run, runShell, tail } from '../util/shell.js';
import { log } from '../util/logger.js';
import { ensureDir, getPaths } from '../util/paths.js';

export interface SandboxOptions {
  rootDir: string;
  config: KafuOpsConfig;
  /** When true, applies patches in the original repo on a new branch.
   *  When false (default), copies the repo into .kafuops/sandbox/<id> first. */
  inPlace?: boolean;
}

export interface SandboxRunResult {
  branch: string;
  workdir: string;
  filesChanged: string[];
  patchApplied: boolean;
  validation: ValidationResult;
  reason?: string;
}

export class PatchSandbox {
  constructor(private readonly opts: SandboxOptions) {}

  async runPatch(incident: Incident, patch: CodePatch): Promise<SandboxRunResult> {
    const branch = `${this.opts.config.repo.mr.branch_prefix}/${incident.id}-${shortSummary(incident)}`;
    const workdir = this.opts.inPlace ? this.opts.rootDir : this.prepareWorkdir(incident.id);
    log.debug(`sandbox workdir=${workdir} branch=${branch}`);

    const git: SimpleGit = simpleGit(workdir);
    let inGit = true;
    try {
      await git.status();
    } catch {
      inGit = false;
    }

    if (inGit) {
      try {
        await git.checkoutLocalBranch(branch);
      } catch (err) {
        // Branch may already exist; try checking out
        try {
          await git.checkout(branch);
        } catch {
          // If we can't make a branch, continue without git but mark inGit false
          inGit = false;
        }
      }
    }

    const filesChanged: string[] = [];
    let patchApplied = false;
    if (patch.unified_diff && patch.unified_diff.trim()) {
      const patchFile = path.join(workdir, '.kafuops-patch.diff');
      fs.writeFileSync(patchFile, patch.unified_diff, 'utf8');
      let applyResult = await run('git', ['apply', '--whitespace=nowarn', '.kafuops-patch.diff'], {
        cwd: workdir,
        timeoutMs: 60_000,
      });
      if (applyResult.code !== 0) {
        applyResult = await run('git', ['apply', '-p0', '--whitespace=nowarn', '.kafuops-patch.diff'], {
          cwd: workdir,
          timeoutMs: 60_000,
        });
      }
      if (applyResult.code === 0) {
        patchApplied = true;
        const statusOut = await run('git', ['status', '--porcelain'], { cwd: workdir });
        for (const line of statusOut.stdout.split('\n')) {
          const m = /^[ MARD?]{2}\s+(.+)$/.exec(line);
          if (m) filesChanged.push(m[1]);
        }
        if (inGit) {
          await run('git', ['add', '-A'], { cwd: workdir });
        }
      } else {
        log.warn(`git apply failed: ${tail(applyResult.stderr, 10)}`);
      }
      try {
        fs.unlinkSync(patchFile);
      } catch {
        // ignore
      }
    } else {
      log.warn('No unified diff in patch; nothing applied.');
    }

    const validation = await this.validate(workdir);
    return {
      branch,
      workdir,
      filesChanged,
      patchApplied,
      validation,
      reason: patchApplied ? undefined : 'patch_did_not_apply',
    };
  }

  /**
   * Revert all changes in the sandbox workdir. Used after a post-apply policy denial
   * so the workspace isn't left in a half-applied state.
   */
  async revertAll(workdir: string): Promise<void> {
    // Best-effort: works when the workdir is a git repo. Otherwise it's a no-op.
    const stat = await run('git', ['rev-parse', '--git-dir'], { cwd: workdir });
    if (stat.code !== 0) return;
    await run('git', ['reset', '--hard', 'HEAD'], { cwd: workdir });
    await run('git', ['clean', '-fd'], { cwd: workdir });
  }

  private prepareWorkdir(incidentId: string): string {
    const base = path.join(getPaths(this.opts.rootDir).sandbox, incidentId);
    ensureDir(base);
    // For MVP we shallow-copy the existing repo using cp.
    // On Linux/macOS this is sufficient. Skip node_modules / .git copies; we re-init git inside.
    const target = path.join(base, 'repo');
    if (!fs.existsSync(target)) {
      ensureDir(target);
      // Use rsync via argv (no shell interpolation, so the repo path can contain anything).
      const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
      const rsync = spawnSync(
        'rsync',
        [
          '-a',
          '--exclude=node_modules',
          '--exclude=.git',
          '--exclude=dist',
          '--exclude=.kafuops',
          this.opts.rootDir + '/',
          target + '/',
        ],
        { stdio: 'ignore' },
      );
      if (rsync.status !== 0) {
        // Fallback: argv-based cp -R; still no shell metacharacters in play.
        const cp = spawnSync('cp', ['-R', this.opts.rootDir + '/.', target + '/'], {
          stdio: 'ignore',
        });
        if (cp.status !== 0) {
          log.warn('Sandbox copy failed (rsync and cp both errored)');
        }
      }
      // Initialize a clean git repo in the copy so MR push paths work without --in-place.
      const gitInit = spawnSync('git', ['init', '-q'], { cwd: target, stdio: 'ignore' });
      if (gitInit.status === 0) {
        spawnSync('git', ['-c', 'user.email=kafuops@local', '-c', 'user.name=KafuOps', 'add', '-A'], {
          cwd: target,
          stdio: 'ignore',
        });
        spawnSync(
          'git',
          ['-c', 'user.email=kafuops@local', '-c', 'user.name=KafuOps', 'commit', '-q', '-m', 'kafuops: snapshot before patch'],
          { cwd: target, stdio: 'ignore' },
        );
      }
    }
    return target;
  }

  private async validate(workdir: string): Promise<ValidationResult> {
    const sb = this.opts.config.sandbox;
    const result: ValidationResult = {
      install_command: sb.install_command,
      install_ok: true,
      install_output_tail: '',
      test_commands: [],
      tests_passed: false,
      tests_output_tail: '',
      ran_in_sandbox: !this.opts.inPlace,
    };

    if (sb.install_command) {
      const installRes = await runShell(sb.install_command, {
        cwd: workdir,
        timeoutMs: sb.timeout_seconds * 1000,
      });
      result.install_ok = installRes.code === 0;
      result.install_output_tail = tail(installRes.stdout + '\n' + installRes.stderr, 30);
      if (!result.install_ok) {
        result.notes = `install failed exit=${installRes.code}`;
        return result;
      }
    }

    if (sb.test_command) {
      result.test_commands.push(sb.test_command);
      const testRes = await runShell(sb.test_command, {
        cwd: workdir,
        timeoutMs: sb.timeout_seconds * 1000,
      });
      result.tests_passed = testRes.code === 0;
      result.tests_output_tail = tail(testRes.stdout + '\n' + testRes.stderr, 50);
      if (testRes.timedOut) result.notes = (result.notes ?? '') + ' test timed out';
    }
    return result;
  }
}

function shortSummary(incident: Incident): string {
  const base = incident.summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'fix';
}
