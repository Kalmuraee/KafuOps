import { loadConfigOrExit } from '../util.js';
import { initCommand } from './init.js';
import { scanCommand } from './scan.js';
import { loadEnvFile } from '../../util/dotenv.js';
import { log } from '../../util/logger.js';

/**
 * `kafuops quickstart` — one command to go from zero to ready: run the setup
 * wizard, load any key it stored, and build project memory. Then tells you the
 * single next command to run.
 */
export async function quickstartCommand(opts: { yes?: boolean; cwd?: string } = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  log.banner('KafuOps quickstart');

  await initCommand({ yes: opts.yes, cwd });
  // The startup env-load ran before init wrote .kafuops/.env — load it now so
  // the rest of this process (and `doctor`) sees the key.
  loadEnvFile(cwd);

  log.info('');
  log.info('Building project memory…');
  await scanCommand({ write: true });

  const { config } = loadConfigOrExit({ cwd, allowMissing: true });
  log.info('');
  log.ok('Ready.');
  if (config.runtime.mode === 'wrapper') {
    log.info('  Next: kafuops doctor   then   kafuops run -- <your start command>');
  } else {
    log.info('  Next: kafuops doctor   then   kafuops agent start  +  kafuops worker start');
  }
}
