import { loadConfigOrExit } from '../util.js';
import { initCommand } from './init.js';
import { scanCommand } from './scan.js';
import { loadEnvFile } from '../../util/dotenv.js';
import { printBox } from '../../util/ui.js';
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
  const next =
    config.runtime.mode === 'wrapper'
      ? ['kafuops doctor', 'kafuops run -- <your start command>']
      : ['kafuops doctor', 'kafuops agent start', 'kafuops worker start'];
  printBox('✓ Ready', ['Run next:', ...next.map((n) => `  ${n}`)]);
}
