#!/usr/bin/env node
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
