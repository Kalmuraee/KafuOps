import { loadConfigOrExit } from '../util.js';
import { recordDeploy } from '../../incident/deploys.js';
import { log } from '../../util/logger.js';

/**
 * `kafuops deploy <version>` — record a deploy marker. Later error-level events
 * within the deployment_regression window are correlated to this release. Call
 * it from CI after a deploy.
 */
export async function deployCommand(version: string, opts: { commit?: string } = {}): Promise<void> {
  const { rootDir } = loadConfigOrExit({ allowMissing: true });
  const rec = recordDeploy(rootDir, { version, commit: opts.commit });
  log.ok(`Recorded deploy ${rec.version}${rec.commit ? ` (${rec.commit})` : ''} at ${rec.at}`);
}
