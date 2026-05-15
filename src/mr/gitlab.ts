import { simpleGit } from 'simple-git';
import { KafuOpsConfig } from '../config/schema.js';
import { MrPayload } from './creator.js';
import { MrCreateResult } from './github.js';
import { log } from '../util/logger.js';

export interface GitlabPushOpts {
  workdir: string;
  config: KafuOpsConfig;
  payload: MrPayload;
  token?: string;
  dryRun?: boolean;
}

export function parseGitlabUrl(
  url: string,
): { host: string; projectPath: string } | null {
  // ssh: git@gitlab.com:org/sub/repo.git  https: https://gitlab.com/org/sub/repo.git
  const ssh = /^(?:[\w-]+@)?([\w.-]+):(.+?)(?:\.git)?$/.exec(url);
  const https = /^https?:\/\/([\w.-]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  const m = ssh || https;
  if (!m) return null;
  return { host: m[1], projectPath: m[2] };
}

export async function openGitlabMr(opts: GitlabPushOpts): Promise<MrCreateResult> {
  const token = opts.token ?? process.env.KAFUOPS_GIT_TOKEN ?? process.env.GITLAB_TOKEN;
  const repoUrl = opts.config.repo.url ?? '';
  const parsed = parseGitlabUrl(repoUrl);
  const apiBase = opts.config.repo.base_url ?? (parsed ? `https://${parsed.host}` : 'https://gitlab.com');

  if (opts.dryRun || !token || !parsed) {
    log.warn(`GitLab MR dry-run (token=${token ? 'set' : 'unset'} repoUrl=${repoUrl})`);
    return {
      provider: 'dry-run',
      branch: opts.payload.branch,
      dry_run: true,
    };
  }

  const git = simpleGit(opts.workdir);
  const remoteUrl = `https://oauth2:${token}@${parsed.host}/${parsed.projectPath}.git`;
  try {
    await git.addConfig('remote.kafuops.url', remoteUrl, false, 'local');
  } catch {
    // ignore
  }
  const status = await git.status();
  if (status.files.length) {
    await git.add('-A');
    await git.commit(opts.payload.title);
  }
  await git.push('kafuops', opts.payload.branch);

  const projectEncoded = encodeURIComponent(parsed.projectPath);
  const mrRes = await fetch(`${apiBase}/api/v4/projects/${projectEncoded}/merge_requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': token,
    },
    body: JSON.stringify({
      source_branch: opts.payload.branch,
      target_branch: opts.payload.base,
      title: opts.payload.title,
      description: opts.payload.body,
      labels: opts.payload.labels.join(','),
      remove_source_branch: false,
    }),
  });
  if (!mrRes.ok) {
    const text = await mrRes.text();
    throw new Error(`GitLab MR creation failed: ${mrRes.status} ${text}`);
  }
  const mr = (await mrRes.json()) as { web_url: string; iid: number };
  return {
    provider: 'gitlab',
    url: mr.web_url,
    number: mr.iid,
    branch: opts.payload.branch,
    dry_run: false,
  };
}
