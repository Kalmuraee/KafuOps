#!/usr/bin/env bash
# Short, snappy TUI hero: the one-command setup + the boxed dashboard. No model
# call, so it stays tight (~12s) — used as the landing hero.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CAST="${KAFUOPS_CAST_DIR:-/tmp/kafuops-cast}"
bash "$ROOT/scripts/record/setup-cast.sh" "$CAST" >/dev/null 2>&1
export PATH="$CAST/bin:$PATH"
export KAFUOPS_ENV_FILE=/dev/null

PROMPT=$'\033[38;5;79m❯\033[0m '
type_cmd() { printf '%s' "$PROMPT"; local s="$1" i; for ((i=0;i<${#s};i++)); do printf '%s' "${s:$i:1}"; sleep 0.016; done; printf '\n'; }
step() { type_cmd "$1"; eval "$1"; sleep "${2:-1.2}"; }

cd "$CAST/newproj"; clear; sleep 0.8
step "kafuops quickstart -y" 3.4
cd "$CAST/checkout-svc"
step "kafuops status" 4.0
