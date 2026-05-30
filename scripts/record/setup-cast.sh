#!/usr/bin/env bash
# Prepare two throwaway projects for the vhs landing recording:
#   newproj/     — a fresh Express skeleton, to show `kafuops quickstart`
#   checkout-svc/ — the demo-discount bug + a registered incident, for the live fix
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CAST="${1:-/tmp/kafuops-cast}"

rm -rf "$CAST"
mkdir -p "$CAST/bin"
cat > "$CAST/bin/kafuops" <<EOF
#!/usr/bin/env bash
exec node "$ROOT/bin/kafuops.js" "\$@"
EOF
chmod +x "$CAST/bin/kafuops"

# A) fresh project for the wizard
mkdir -p "$CAST/newproj/src"
printf '%s\n' '{ "name": "orders-api", "dependencies": { "express": "^4" }, "scripts": { "start": "node src/server.js" } }' > "$CAST/newproj/package.json"
printf 'import express from "express";\nconst app = express();\napp.listen(3000);\n' > "$CAST/newproj/src/server.js"

# B) the broken checkout service + a registered incident
cp -R "$ROOT/examples/demo-discount/." "$CAST/checkout-svc/"
node --input-type=module -e '
import { IncidentStore } from "'"$ROOT"'/dist/incident/store.js";
import { ensureDirs, getPaths } from "'"$ROOT"'/dist/util/paths.js";
const dir = "'"$CAST"'/checkout-svc";
ensureDirs(getPaths(dir));
new IncidentStore(dir).save({
  id: "inc_2026_checkout", service: "checkout-svc", environment: "production",
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
echo "cast ready at $CAST"
