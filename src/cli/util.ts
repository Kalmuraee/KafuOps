import { loadConfig, LoadConfigOptions, LoadedConfig } from '../config/loader.js';
import { log } from '../util/logger.js';

export function loadConfigOrExit(opts: LoadConfigOptions = {}): LoadedConfig {
  try {
    return loadConfig(opts);
  } catch (err) {
    log.error((err as Error).message);
    process.exit(1);
  }
}
