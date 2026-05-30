#!/usr/bin/env bash
# The script asciinema records for the landing demo. Runs the REAL KafuOps flow
# with a typed-command feel: quickstart → broken service → live self-correcting
# fix → green → dashboard.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CAST="${KAFUOPS_CAST_DIR:-/tmp/kafuops-cast}"
bash "$ROOT/scripts/record/setup-cast.sh" "$CAST" >/dev/null 2>&1
export PATH="$CAST/bin:$PATH"
export KAFUOPS_ENV_FILE=/dev/null

PROMPT=$'\033[38;5;79m❯\033[0m '
type_cmd() {
  printf '%s' "$PROMPT"
  local s="$1" i
  for ((i = 0; i < ${#s}; i++)); do printf '%s' "${s:$i:1}"; sleep 0.014; done
  printf '\n'
}
step() { type_cmd "$1"; eval "$1"; sleep "${2:-1.2}"; }

cd "$CAST/newproj"; clear; sleep 0.7

step "kafuops quickstart -y" 2.2
cd "$CAST/checkout-svc"
step "node test.js" 1.6 || true
step "kafuops incidents open-mr inc_2026_checkout --in-place --dry-run" 1.6
step "node test.js" 1.6
step "kafuops status" 3.0
