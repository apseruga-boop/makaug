#!/usr/bin/env bash
set -euo pipefail

if [[ "${WHATSAPP_DELIVERY_MODE:-}" == "test" ]]; then
  echo "render-whatsapp-test-worker starting country=${COUNTRY_CODE:-UG}"
  exec node scripts/whatsapp-test-worker.js
fi

export WHATSAPP_WEB_COPILOT_BASE_URL="${WHATSAPP_WEB_COPILOT_BASE_URL:-https://makaug.com}"
export WHATSAPP_WEB_COPILOT_PROFILE_DIR="${WHATSAPP_WEB_COPILOT_PROFILE_DIR:-/var/data/whatsapp-profile-live}"
export WHATSAPP_WEB_COPILOT_CLIENT_ID="${WHATSAPP_WEB_COPILOT_CLIENT_ID:-makaug-whatsapp-web-prod}"
export WHATSAPP_WEB_COPILOT_HEADLESS="${WHATSAPP_WEB_COPILOT_HEADLESS:-true}"
export DISPLAY="${DISPLAY:-:99}"

mkdir -p "${WHATSAPP_WEB_COPILOT_PROFILE_DIR}"

echo "render-whatsapp-agent-start profile=${WHATSAPP_WEB_COPILOT_PROFILE_DIR} headless=${WHATSAPP_WEB_COPILOT_HEADLESS} display=${DISPLAY}"
if command -v xvfb-run >/dev/null 2>&1; then
  echo "render-whatsapp-agent-xvfb available"
else
  echo "render-whatsapp-agent-xvfb missing"
fi

if [[ "${WHATSAPP_WEB_COPILOT_HEADLESS}" != "true" ]] && command -v xvfb-run >/dev/null 2>&1; then
  echo "render-whatsapp-agent-xvfb supervised"
  export WHATSAPP_WEB_COPILOT_XVFB_MANAGED="true"
  exec xvfb-run -a -s "-screen 0 1440x980x24 -nolisten tcp" node scripts/whatsapp-web-agent.js
fi

echo "render-whatsapp-agent-node starting (agent will verify display or use headless fallback)"
exec node scripts/whatsapp-web-agent.js
