#!/usr/bin/env node
// Suppress the noisy `punycode` deprecation warning emitted by a transitive
// dependency (not our code) so CLI output stays clean. Other warnings pass.
const __emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const msg = typeof warning === 'string' ? warning : warning && warning.message;
  if (msg && /punycode/i.test(msg)) return undefined;
  return __emitWarning(warning, ...args);
};

import('../dist/cli/index.js').catch((err) => {
  if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
    process.stderr.write(
      'KafuOps is not built yet. Run `npm install && npm run build` from the package directory.\n',
    );
    process.exit(1);
  }
  process.stderr.write(`KafuOps failed to start: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
