#!/usr/bin/env bash
# Reproduce the KafuOps live demo: fix a planted bug in examples/demo-discount
# end-to-end (analyze → patch → sandbox test → MR), using whatever provider is
# set in its .kafuops.yml (default: the local Claude CLI — no API key needed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/examples/demo-discount"
[ -f "$ROOT/dist/cli/index.js" ] || { echo "Build first: npm run build"; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/kafuops-demo.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
cp -R "$SRC/." "$WORK/"

echo "### Before — the test fails (red):"
( cd "$WORK" && node test.js ) || true
echo

# Register the incident (as if ingested from logs/Sentry) pointing at the bug.
node --input-type=module -e '
import { IncidentStore } from "'"$ROOT"'/dist/incident/store.js";
import { ensureDirs, getPaths } from "'"$ROOT"'/dist/util/paths.js";
const dir = "'"$WORK"'";
ensureDirs(getPaths(dir));
new IncidentStore(dir).save({
  id: "inc_demo_discount", service: "checkout-svc", environment: "production",
  severity: "high", fingerprint: "checkout-svc|-|AssertionError|src/discount.js",
  status: "created", summary: "Discount math is wrong — totals go negative",
  first_seen: new Date().toISOString(), last_seen: new Date().toISOString(),
  event_count: 3, top_frame_file: "src/discount.js", top_frame_line: 5,
  events: [{ id: "e1", service: "checkout-svc", environment: "production",
    type: "uncaught_exception", severity: "error", timestamp: new Date().toISOString(),
    message: "AssertionError: 20% off $100 should be $80",
    stacktrace: "AssertionError: 20% off $100 should be $80\n    at Object.<anonymous> (test.js:4:8)\n    at applyDiscount (src/discount.js:5:17)" }],
});
'

echo "### KafuOps runs (provider from .kafuops.yml):"
( cd "$WORK" && node "$ROOT/bin/kafuops.js" incidents open-mr inc_demo_discount --in-place --dry-run )
echo
echo "### The fix KafuOps generated:"
cat "$WORK/.kafuops/incidents/inc_demo_discount/patch.diff"
echo
echo "### After — the test passes (green):"
( cd "$WORK" && node test.js )
echo
echo "Full MR body: $WORK/.kafuops/incidents/inc_demo_discount/mr-body.md (copied below is a temp dir)"
