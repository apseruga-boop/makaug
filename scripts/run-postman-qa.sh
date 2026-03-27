#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COLLECTION="$ROOT_DIR/docs/postman/MakaUg_GoLive_QA.postman_collection.json"
ENV_FILE="$ROOT_DIR/docs/postman/MakaUg_GoLive_QA.postman_environment.json"
REPORT_DIR="$ROOT_DIR/reports/postman"

BASE_URL="${BASE_URL:-https://makaug.com}"
ADMIN_API_KEY="${ADMIN_API_KEY:-}"
SUPER_ADMIN_KEY="${SUPER_ADMIN_KEY:-}"
OTP_PHONE="${OTP_PHONE:-+256770646879}"
LISTING_OTP_CODE="${LISTING_OTP_CODE:-}"

if [[ ! -f "$COLLECTION" ]]; then
  echo "[ERROR] Missing collection: $COLLECTION"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ERROR] Missing environment file: $ENV_FILE"
  exit 1
fi

if [[ -z "$ADMIN_API_KEY" ]]; then
  echo "[ERROR] ADMIN_API_KEY is required."
  echo "Set it first: export ADMIN_API_KEY='your-key'"
  exit 1
fi

if [[ -z "$SUPER_ADMIN_KEY" ]]; then
  echo "[ERROR] SUPER_ADMIN_KEY is required."
  echo "Set it first: export SUPER_ADMIN_KEY='your-super-key'"
  exit 1
fi

if [[ -z "$LISTING_OTP_CODE" ]]; then
  echo "[ERROR] LISTING_OTP_CODE is required for full listing workflow."
  echo "Request OTP from endpoint/API first, then set it:"
  echo "export LISTING_OTP_CODE='123456'"
  exit 1
fi

mkdir -p "$REPORT_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
JUNIT_FILE="$REPORT_DIR/newman-junit-$TIMESTAMP.xml"
JSON_FILE="$REPORT_DIR/newman-results-$TIMESTAMP.json"

echo "[INFO] Running Postman QA against: $BASE_URL"
echo "[INFO] Reports:"
echo "  - $JUNIT_FILE"
echo "  - $JSON_FILE"

npx --yes newman run "$COLLECTION" \
  -e "$ENV_FILE" \
  --env-var "base_url=$BASE_URL" \
  --env-var "admin_api_key=$ADMIN_API_KEY" \
  --env-var "super_admin_key=$SUPER_ADMIN_KEY" \
  --env-var "otp_phone=$OTP_PHONE" \
  --env-var "listing_otp_code=$LISTING_OTP_CODE" \
  --reporters cli,junit,json \
  --reporter-junit-export "$JUNIT_FILE" \
  --reporter-json-export "$JSON_FILE"

echo "[SUCCESS] Postman QA completed."
