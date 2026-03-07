#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/prelaunch-check.sh [BASE_URL]

Environment variables:
  BASE_URL           Target base URL (default: http://localhost:8080)
  ADMIN_API_KEY      Admin key used for admin smoke checks (optional)
  RUN_MIGRATIONS     1/0 run migrations (default: 1)
  RUN_SEED           1/0 run seed (default: 1)
  AUTO_START_LOCAL   1/0 auto-start local server when BASE_URL is localhost and health fails (default: 1)
  HEALTH_WAIT_SECS   Seconds to wait for local health readiness (default: 45)
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" == -* ]]; then
  echo "Unknown option: $1" >&2
  usage
  exit 1
fi

BASE_URL="${BASE_URL:-${1:-http://localhost:8080}}"
ADMIN_API_KEY="${ADMIN_API_KEY:-}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-1}"
RUN_SEED="${RUN_SEED:-1}"
AUTO_START_LOCAL="${AUTO_START_LOCAL:-1}"
HEALTH_WAIT_SECS="${HEALTH_WAIT_SECS:-45}"

SERVER_STARTED_BY_SCRIPT=0
SERVER_PID=""
SERVER_LOG_FILE=""

green() { printf "\033[32m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }
red() { printf "\033[31m%s\033[0m\n" "$1"; }

cleanup() {
  if [[ "$SERVER_STARTED_BY_SCRIPT" == "1" && -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

run_step() {
  local title="$1"
  shift
  echo ""
  echo "==> $title"
  if "$@"; then
    green "PASS: $title"
  else
    red "FAIL: $title"
    return 1
  fi
}

health_ok() {
  curl -sS -m 5 "$BASE_URL/api/health" >/dev/null
}

start_local_server_if_needed() {
  if health_ok; then
    return 0
  fi

  if [[ "$AUTO_START_LOCAL" != "1" ]]; then
    return 1
  fi

  if [[ "$BASE_URL" != "http://localhost:8080" && "$BASE_URL" != "http://127.0.0.1:8080" ]]; then
    return 1
  fi

  SERVER_LOG_FILE="$(mktemp -t makaug-prelaunch-server.XXXX.log)"
  echo "Starting local server for prelaunch checks..."
  npm run start >"$SERVER_LOG_FILE" 2>&1 &
  SERVER_PID="$!"
  SERVER_STARTED_BY_SCRIPT=1

  local waited=0
  while [[ "$waited" -lt "$HEALTH_WAIT_SECS" ]]; do
    if health_ok; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done

  return 1
}

main() {
  echo "Prelaunch check starting"
  echo "BASE_URL=$BASE_URL"

  run_step "Node syntax check" npm run check

  if [[ "$RUN_MIGRATIONS" == "1" ]]; then
    run_step "Database migrations" npm run migrate
  else
    yellow "SKIP: migrations"
  fi

  if [[ "$RUN_SEED" == "1" ]]; then
    run_step "Database seed" npm run seed
  else
    yellow "SKIP: seed"
  fi

  echo ""
  echo "==> Health check"
  if start_local_server_if_needed; then
    green "PASS: service reachable at $BASE_URL"
  else
    red "FAIL: service not reachable at $BASE_URL"
    if [[ -n "$SERVER_LOG_FILE" && -f "$SERVER_LOG_FILE" ]]; then
      echo "Server log: $SERVER_LOG_FILE"
      sed 's/^/  /' "$SERVER_LOG_FILE" | tail -n 40
    fi
    echo ""
    red "NO-GO"
    exit 1
  fi

  echo ""
  echo "==> Smoke test"
  if BASE_URL="$BASE_URL" ADMIN_API_KEY="$ADMIN_API_KEY" npm run smoke; then
    green "PASS: smoke test"
  else
    red "FAIL: smoke test"
    if [[ -n "$SERVER_LOG_FILE" && -f "$SERVER_LOG_FILE" ]]; then
      echo "Server log: $SERVER_LOG_FILE"
      sed 's/^/  /' "$SERVER_LOG_FILE" | tail -n 40
    fi
    echo ""
    red "NO-GO"
    exit 1
  fi

  echo ""
  green "GO"
  echo "All prelaunch checks passed."
}

main "$@"
