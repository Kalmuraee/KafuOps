/**
 * Library entrypoint (the `main` of the package). KafuOps is primarily a CLI, but
 * this exposes the embedded Node SDK and core types for programmatic use:
 *
 *   import { installErrorReporter } from 'kafuops';
 *   installErrorReporter({ endpoint: 'http://kafuops-agent:7878', service: 'api' });
 */
export { installErrorReporter, reportError, buildErrorEvent } from './sdk/node.js';
export type { ReporterOptions } from './sdk/node.js';
export type { RuntimeEvent, Incident, ContextBundle } from './types/index.js';
