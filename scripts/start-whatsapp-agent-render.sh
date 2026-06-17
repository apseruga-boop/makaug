#!/usr/bin/env bash
set -euo pipefail

export WHATSAPP_WEB_COPILOT_BASE_URL="${WHATSAPP_WEB_COPILOT_BASE_URL:-https://makaug.com}"
export WHATSAPP_WEB_COPILOT_PROFILE_DIR="${WHATSAPP_WEB_COPILOT_PROFILE_DIR:-/var/data/whatsapp-profile-live}"
export WHATSAPP_WEB_COPILOT_CLIENT_ID="${WHATSAPP_WEB_COPILOT_CLIENT_ID:-makaug-whatsapp-web-prod}"
export WHATSAPP_WEB_COPILOT_HEADLESS="${WHATSAPP_WEB_COPILOT_HEADLESS:-false}"
export DISPLAY="${DISPLAY:-:99}"

mkdir -p "${WHATSAPP_WEB_COPILOT_PROFILE_DIR}"

echo "render-whatsapp-agent-start profile=${WHATSAPP_WEB_COPILOT_PROFILE_DIR} headless=${WHATSAPP_WEB_COPILOT_HEADLESS} display=${DISPLAY}"
if command -v xvfb-run >/dev/null 2>&1; then
  echo "render-whatsapp-agent-xvfb available"
else
  echo "render-whatsapp-agent-xvfb missing"
fi

if [[ "${WHATSAPP_WEB_COPILOT_HEADLESS}" != "true" ]] && command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a --server-args="-screen 0 1440x980x24" npm run dev:whatsapp-agent
fi

exec npm run dev:whatsapp-agent
