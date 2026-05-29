import { Octokit } from '@octokit/rest';
import { simpleGit } from 'simple-git';
import { KafuOpsConfig } from '../config/schema.js';
import { MrPayload } from './creator.js';
import { log } from '../util/logger.js';

export interface GithubPushOpts {
  workdir: string;
  config: KafuOpsConfig;
  payload: MrPayload;
  /** Override token. Defaults to KAFUOPS_GIT_TOKEN or GITHUB_TOKEN. */
  token?: string;
  dryRun?: boolean;
}

export interface MrCreateResult {
  provider: 'github' | 'gitlab' | 'dry-run';
  url?: string;
  number?: number;
  branch: string;
  dry_run: boolean;
}

/** Parse owner/repo from an SSH or HTTPS GitHub URL. */
export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const m =
    /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url) ||
    /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

export async function openGithubPr(opts: GithubPushOpts): Promise<MrCreateResult> {
  const token = opts.token ?? process.env.KAFUOPS_GIT_TOKEN ?? process.env.GITHUB_TOKEN;
  const repoUrl = opts.config.repo.url ?? '';
  const parsed = parseGithubUrl(repoUrl);

  if (opts.dryRun || !token || !parsed) {
    log.warn(`GitHub PR dry-run (token=${token ? 'set' : 'unset'} repoUrl=${repoUrl})`);
    return {
      provider: 'dry-run',
      branch: opts.payload.branch,
      dry_run: true,
    };
  }

  // Push branch
  const git = simpleGit(opts.workdir);
  const remoteUrl = `https://x-access-token:${token}@github.com/${parsed.owner}/${parsed.repo}.git`;
  try {
    await git.addConfig('remote.kafuops.url', remoteUrl, false, 'local');
  } catch {
    // ignore
  }
  // Commit current changes if not already
  const status = await git.status();
  if (status.files.length) {
    await git.add('-A');
    await git.commit(opts.payload.title);
  }
  await git.push('kafuops', opts.payload.branch);

  const octokit = new Octokit({ auth: token });
  let pr;
  try {
    pr = await octokit.pulls.create({
      owner: parsed.owner,
      repo: parsed.repo,
      title: opts.payload.title,
      body: opts.payload.body,
      head: opts.payload.branch,
      base: opts.payload.base,
    });
  } catch (err) {
    throw new Error(`GitHub PR creation failed: ${(err as Error).message}`);
  }
  try {
    if (opts.payload.labels.length) {
      await octokit.issues.addLabels({
        owner: parsed.owner,
        repo: parsed.repo,
        issue_number: pr.data.number,
        labels: opts.payload.labels,
      });
    }
  } catch (err) {
    log.warn(`Failed to add labels: ${(err as Error).message}`);
  }
  return {
    provider: 'github',
    url: pr.data.html_url,
    number: pr.data.number,
    branch: opts.payload.branch,
    dry_run: false,
  };
}

/** Merge a previously opened PR (used only when repo.mr.auto_merge is true). */
export async function mergeGithubPr(opts: { config: KafuOpsConfig; number: number; token?: string }): Promise<void> {
  const token = opts.token ?? process.env.KAFUOPS_GIT_TOKEN ?? process.env.GITHUB_TOKEN;
  const parsed = parseGithubUrl(opts.config.repo.url ?? '');
  if (!token || !parsed) throw new Error('cannot auto-merge: missing token or repo.url');
  const octokit = new Octokit({ auth: token });
  await octokit.pulls.merge({ owner: parsed.owner, repo: parsed.repo, pull_number: opts.number });
}
