#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-${1:-http://localhost:8080}}"
ADMIN_API_KEY="${ADMIN_API_KEY:-}"
TIMEOUT="${TIMEOUT:-20}"

if ! command -v curl >/dev/null 2>&1; then
  echo "[FAIL] curl is required" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[FAIL] node is required" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

TOTAL=0
PASSED=0
FAILED=0
REQ_N=0
LAST_STATUS=""
LAST_BODY_FILE=""

green() { printf "\033[32m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }
red() { printf "\033[31m%s\033[0m\n" "$1"; }

step() {
  TOTAL=$((TOTAL + 1))
  echo ""
  echo "[$TOTAL] $1"
}

pass() {
  PASSED=$((PASSED + 1))
  green "  PASS"
}

fail() {
  FAILED=$((FAILED + 1))
  red "  FAIL: $1"
  if [[ -f "$LAST_BODY_FILE" ]]; then
    echo "  Response body:"
    sed 's/^/    /' "$LAST_BODY_FILE" | head -n 40
  fi
}

json_get() {
  local file="$1"
  local path="$2"
  node - "$file" "$path" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const path = process.argv[3];
let data;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  process.exit(2);
}
let cur = data;
for (const p of path.split('.')) {
  if (!p) continue;
  if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
    cur = cur[p];
  } else {
    process.exit(3);
  }
}
if (cur === undefined || cur === null) process.exit(4);
if (typeof cur === 'object') process.stdout.write(JSON.stringify(cur));
else process.stdout.write(String(cur));
NODE
}

request_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local auth_header="${4:-}"

  REQ_N=$((REQ_N + 1))
  local out="$TMP_DIR/resp_${REQ_N}.json"

  local -a args
  args=(
    -sS
    -m "$TIMEOUT"
    -o "$out"
    -w "%{http_code}"
    -X "$method"
    "$BASE_URL$path"
    -H "Accept: application/json"
  )

  if [[ -n "$body" ]]; then
    args+=( -H "Content-Type: application/json" --data "$body" )
  fi

  if [[ -n "$auth_header" ]]; then
    args+=( -H "$auth_header" )
  fi

  LAST_STATUS="$(curl "${args[@]}")" || {
    LAST_BODY_FILE="$out"
    LAST_STATUS="000"
    return 1
  }

  LAST_BODY_FILE="$out"
  return 0
}

assert_status() {
  local expected="$1"
  [[ "$LAST_STATUS" == "$expected" ]]
}

assert_ok_true() {
  local v
  v="$(json_get "$LAST_BODY_FILE" ok 2>/dev/null || true)"
  [[ "$v" == "true" ]]
}

rand8() {
  node -e "process.stdout.write(String((Date.now() + Math.floor(Math.random() * 100000000)) % 100000000).padStart(8, '0'))"
}

PHONE_MAIN="+2567$(rand8)"
PHONE_AGENT="+2567$(rand8)"
PHONE_REQ="+2567$(rand8)"
EMAIL_MAIN="smoke.$(date +%s)@example.com"
PASSWORD_MAIN="Pass@12345"
PASSWORD_NEW="Pass@54321"
SMOKE_IMAGE_DATA_URL="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="

listing_otp_token() {
  local phone="$1"
  local audience="${2:-listing}"
  local code=""

  if ! request_json POST /api/properties/request-submit-otp "{\"channel\":\"phone\",\"phone\":\"$phone\",\"audience\":\"$audience\"}"; then
    return 1
  fi
  if ! assert_status 200 || ! assert_ok_true; then
    return 1
  fi
  code="$(json_get "$LAST_BODY_FILE" data.dev_otp 2>/dev/null || true)"
  if [[ -z "$code" ]]; then
    return 2
  fi
  if ! request_json POST /api/properties/verify-submit-otp "{\"channel\":\"phone\",\"phone\":\"$phone\",\"code\":\"$code\"}"; then
    return 1
  fi
  if ! assert_status 200 || ! assert_ok_true; then
    return 1
  fi
  json_get "$LAST_BODY_FILE" data.listing_otp_token
}

echo "Running smoke test against: $BASE_URL"

# 1) Health
step "GET /api/health"
if request_json GET /api/health ""; then
  if assert_status 200 && assert_ok_true; then pass; else fail "Expected 200 with ok=true"; fi
else
  fail "Request failed (network or timeout)"
fi

# 2) Analytics event
step "POST /api/analytics/event"
if request_json POST /api/analytics/event '{"event_name":"smoke_test","client_id":"smoke.1","page_path":"/","source":"web","params":{"stage":"smoke"}}'; then
  if assert_status 201 && assert_ok_true; then pass; else fail "Expected 201 with ok=true"; fi
else
  fail "Request failed"
fi

# 2b) Mortgage rates
step "GET /api/mortgage-rates"
if request_json GET /api/mortgage-rates ""; then
  if assert_status 200 && assert_ok_true; then pass; else fail "Expected 200 with ok=true"; fi
else
  fail "Request failed"
fi

# 3) Looking request
step "POST /api/contact/looking-for-property"
if request_json POST /api/contact/looking-for-property "{\"name\":\"Smoke User\",\"phone\":\"$PHONE_REQ\",\"preferred_locations\":\"Kampala\",\"listing_type\":\"rent\",\"requirements\":\"Need 2-bed apartment\"}"; then
  if assert_status 201 && assert_ok_true; then pass; else fail "Expected 201 with ok=true"; fi
else
  fail "Request failed"
fi

# 4) Report listing
step "POST /api/contact/report-listing"
if request_json POST /api/contact/report-listing '{"property_reference":"SMOKE-REF-001","reason":"Incorrect information","details":"Automated smoke test"}'; then
  if assert_status 201 && assert_ok_true; then pass; else fail "Expected 201 with ok=true"; fi
else
  fail "Request failed"
fi

AGENT_LISTING_OTP_TOKEN=""
step "Request and verify broker listing OTP"
if AGENT_LISTING_OTP_TOKEN="$(listing_otp_token "$PHONE_AGENT" agent)"; then
  if [[ -n "$AGENT_LISTING_OTP_TOKEN" ]]; then pass; else fail "Expected listing_otp_token"; fi
else
  fail "Expected broker OTP token"
fi

# 5) Agent registration
step "POST /api/agents/register"
if request_json POST /api/agents/register "{\"full_name\":\"Smoke Agent\",\"licence_number\":\"AREA/SMOKE/$(date +%s)\",\"phone\":\"$PHONE_AGENT\",\"whatsapp\":\"$PHONE_AGENT\",\"email\":\"agent.$(date +%s)@example.com\",\"districts_covered\":\"Kampala, Wakiso\",\"nin\":\"SMOKE-NIN-123456\",\"verification_reason\":\"Smoke test broker verification request\",\"identity_document\":{\"name\":\"smoke-national-id.png\",\"type\":\"image/png\",\"data_url\":\"$SMOKE_IMAGE_DATA_URL\",\"size\":100},\"listing_otp_token\":\"$AGENT_LISTING_OTP_TOKEN\",\"otp_channel\":\"phone\",\"privacy_consent_accepted\":true,\"data_retention_notice_accepted\":true}"; then
  if assert_status 201 && assert_ok_true; then pass; else fail "Expected 201 with ok=true"; fi
else
  fail "Request failed"
fi

PROPERTY_LISTING_OTP_TOKEN=""
step "Request and verify property listing OTP"
if PROPERTY_LISTING_OTP_TOKEN="$(listing_otp_token "$PHONE_REQ" listing)"; then
  if [[ -n "$PROPERTY_LISTING_OTP_TOKEN" ]]; then pass; else fail "Expected listing_otp_token"; fi
else
  fail "Expected property OTP token"
fi

# 6) Property creation
PROPERTY_ID=""
PROPERTY_PREVIEW_URL=""
PROPERTY_PREVIEW_PATH=""
step "POST /api/properties"
if request_json POST /api/properties "{\"listing_type\":\"sale\",\"title\":\"Smoke Test Property $(date +%s)\",\"district\":\"Kampala\",\"area\":\"Ntinda\",\"description\":\"Smoke test listing submitted through the hardened launch flow.\",\"price\":350000000,\"property_type\":\"House\",\"title_type\":\"Freehold\",\"amenities\":[\"parking\",\"security\"],\"lister_name\":\"Smoke Owner\",\"lister_phone\":\"$PHONE_REQ\",\"lister_email\":\"owner.$(date +%s)@example.com\",\"lister_type\":\"owner\",\"listed_via\":\"website\",\"source\":\"smoke_test\",\"otp_channel\":\"phone\",\"listing_otp_token\":\"$PROPERTY_LISTING_OTP_TOKEN\",\"verification_terms_accepted\":true,\"id_number\":\"CM000000000000\",\"id_document_name\":\"smoke-national-id.png\",\"id_document_type\":\"image/png\",\"id_document_url\":\"$SMOKE_IMAGE_DATA_URL\",\"images\":[{\"url\":\"$SMOKE_IMAGE_DATA_URL\",\"slot_key\":\"front\",\"room_label\":\"Front view\"},{\"url\":\"$SMOKE_IMAGE_DATA_URL\",\"slot_key\":\"living\",\"room_label\":\"Living area\"},{\"url\":\"$SMOKE_IMAGE_DATA_URL\",\"slot_key\":\"kitchen\",\"room_label\":\"Kitchen\"},{\"url\":\"$SMOKE_IMAGE_DATA_URL\",\"slot_key\":\"bedroom\",\"room_label\":\"Bedroom\"},{\"url\":\"$SMOKE_IMAGE_DATA_URL\",\"slot_key\":\"bathroom\",\"room_label\":\"Bathroom\"}],\"status\":\"pending\"}"; then
  PROPERTY_ID="$(json_get "$LAST_BODY_FILE" data.id 2>/dev/null || true)"
  PROPERTY_PREVIEW_URL="$(json_get "$LAST_BODY_FILE" data.owner_preview_url 2>/dev/null || true)"
  PROPERTY_PREVIEW_PATH="$(node - "$PROPERTY_PREVIEW_URL" <<'NODE' 2>/dev/null || true
try {
  const url = new URL(process.argv[2]);
  process.stdout.write(`${url.pathname}${url.search}`);
} catch (_) {}
NODE
)"
  if assert_status 201 && assert_ok_true && [[ -n "$PROPERTY_ID" ]]; then
    pass
  else
    fail "Expected 201 with property id"
  fi
else
  fail "Request failed"
fi

# 7) Pending owner preview fetch
step "GET owner preview for pending property"
if [[ -z "$PROPERTY_PREVIEW_PATH" ]]; then
  fail "Skipped because property id was not created"
else
  if request_json GET "$PROPERTY_PREVIEW_PATH" ""; then
    if assert_status 200; then pass; else fail "Expected 200 for owner preview"; fi
  else
    fail "Request failed"
  fi
fi

LIVE_PROPERTY_ID=""
step "GET /api/properties?limit=1"
if request_json GET "/api/properties?limit=1" ""; then
  LIVE_PROPERTY_ID="$(json_get "$LAST_BODY_FILE" data.0.id 2>/dev/null || true)"
  if assert_status 200 && assert_ok_true; then pass; else fail "Expected 200 with ok=true"; fi
else
  fail "Request failed"
fi

# 8) Property inquiry
step "POST /api/properties/:id/inquiries"
if [[ -z "$LIVE_PROPERTY_ID" ]]; then
  yellow "  SKIP: no live property fixture available for public inquiry"
  PASSED=$((PASSED + 1))
else
  if request_json POST "/api/properties/$LIVE_PROPERTY_ID/inquiries" "{\"contact_name\":\"Smoke Buyer\",\"contact_phone\":\"$PHONE_REQ\",\"message\":\"Interested in viewing\"}"; then
    if assert_status 201 && assert_ok_true; then pass; else fail "Expected 201 with ok=true"; fi
  else
    fail "Request failed"
  fi
fi

# 9) Signup contact verification
SIGNUP_CONTACT_TOKEN=""
REGISTER_DEV_OTP=""
step "POST /api/auth/request-signup-otp + verify"
if request_json POST /api/auth/request-signup-otp "{\"channel\":\"phone\",\"first_name\":\"Smoke\",\"last_name\":\"User\",\"phone\":\"$PHONE_MAIN\",\"email\":\"$EMAIL_MAIN\",\"audience\":\"buyer\",\"preferred_language\":\"en\"}"; then
  REGISTER_DEV_OTP="$(json_get "$LAST_BODY_FILE" data.dev_otp 2>/dev/null || true)"
  if assert_status 200 && assert_ok_true && [[ -n "$REGISTER_DEV_OTP" ]]; then
    if request_json POST /api/auth/verify-signup-otp "{\"channel\":\"phone\",\"phone\":\"$PHONE_MAIN\",\"email\":\"$EMAIL_MAIN\",\"code\":\"$REGISTER_DEV_OTP\"}"; then
      SIGNUP_CONTACT_TOKEN="$(json_get "$LAST_BODY_FILE" data.contact_verification_token 2>/dev/null || true)"
      if assert_status 200 && assert_ok_true && [[ -n "$SIGNUP_CONTACT_TOKEN" ]]; then pass; else fail "Expected contact_verification_token"; fi
    else
      fail "Verify signup OTP request failed"
    fi
  else
    fail "Expected signup dev_otp"
  fi
else
  fail "Request failed"
fi

# 10) Auth register
AUTH_TOKEN=""
step "POST /api/auth/register"
if [[ -n "$SIGNUP_CONTACT_TOKEN" ]]; then
  if request_json POST /api/auth/register "{\"first_name\":\"Smoke\",\"last_name\":\"User\",\"phone\":\"$PHONE_MAIN\",\"email\":\"$EMAIL_MAIN\",\"role\":\"Buyer / Renter\",\"password\":\"$PASSWORD_MAIN\",\"confirm_password\":\"$PASSWORD_MAIN\",\"otp_channel\":\"phone\",\"contact_verification_token\":\"$SIGNUP_CONTACT_TOKEN\",\"terms_accepted\":true,\"privacy_accepted\":true,\"marketing_opt_in\":false,\"weekly_tips_opt_in\":false,\"preferred_contact_channel\":\"whatsapp\",\"preferred_language\":\"en\"}"; then
    AUTH_TOKEN="$(json_get "$LAST_BODY_FILE" data.token 2>/dev/null || true)"
    if assert_status 201 && assert_ok_true && [[ -n "$AUTH_TOKEN" ]]; then pass; else fail "Expected 201 with auth token"; fi
  else
    fail "Request failed"
  fi
else
  fail "Skipped because contact verification token was not created"
fi

if [[ -n "$AUTH_TOKEN" ]]; then
  # 11) Login with password
  step "POST /api/auth/login"
  if request_json POST /api/auth/login "{\"phone\":\"$PHONE_MAIN\",\"password\":\"$PASSWORD_MAIN\"}"; then
    AUTH_TOKEN="$(json_get "$LAST_BODY_FILE" data.token 2>/dev/null || true)"
    if assert_status 200 && assert_ok_true && [[ -n "$AUTH_TOKEN" ]]; then pass; else fail "Expected token"; fi
  else
    fail "Request failed"
  fi

  # 12) GET me
  step "GET /api/auth/me"
  if request_json GET /api/auth/me "" "Authorization: Bearer $AUTH_TOKEN"; then
    if assert_status 200 && assert_ok_true; then pass; else fail "Expected 200"; fi
  else
    fail "Request failed"
  fi

  # 13) PATCH me
  step "PATCH /api/auth/me"
  if request_json PATCH /api/auth/me '{"first_name":"SmokeUpdated"}' "Authorization: Bearer $AUTH_TOKEN"; then
    if assert_status 200 && assert_ok_true; then pass; else fail "Expected 200"; fi
  else
    fail "Request failed"
  fi

  # 14) Change password
  step "POST /api/auth/change-password"
  if request_json POST /api/auth/change-password "{\"old_password\":\"$PASSWORD_MAIN\",\"new_password\":\"$PASSWORD_NEW\"}" "Authorization: Bearer $AUTH_TOKEN"; then
    if assert_status 200 && assert_ok_true; then pass; else fail "Expected 200"; fi
  else
    fail "Request failed"
  fi

  # 15) Request reset password + reset
  RESET_OTP=""
  step "POST /api/auth/request-password-reset"
  if request_json POST /api/auth/request-password-reset "{\"phone\":\"$PHONE_MAIN\"}"; then
    RESET_OTP="$(json_get "$LAST_BODY_FILE" data.dev_otp 2>/dev/null || true)"
    if assert_status 200 && assert_ok_true; then pass; else fail "Expected 200"; fi
  else
    fail "Request failed"
  fi

  if [[ -n "$RESET_OTP" ]]; then
    step "POST /api/auth/reset-password"
    if request_json POST /api/auth/reset-password "{\"phone\":\"$PHONE_MAIN\",\"code\":\"$RESET_OTP\",\"new_password\":\"$PASSWORD_MAIN\"}"; then
      if assert_status 200 && assert_ok_true; then pass; else fail "Expected 200"; fi
    else
      fail "Request failed"
    fi
  else
    step "POST /api/auth/reset-password"
    yellow "  SKIP: no dev_otp returned (production-like OTP flow)"
    PASSED=$((PASSED + 1))
  fi
else
  step "OTP-dependent auth tests"
  yellow "  SKIP: dev_otp not returned (likely production mode). Manual SMS verification required."
  PASSED=$((PASSED + 1))
fi

# 16) Admin summary/users (optional)
if [[ -n "$ADMIN_API_KEY" ]]; then
  step "GET /api/admin/summary"
  if request_json GET /api/admin/summary "" "x-api-key: $ADMIN_API_KEY"; then
    if assert_status 200 && assert_ok_true; then pass; else fail "Expected 200"; fi
  else
    fail "Request failed"
  fi

  step "GET /api/admin/users"
  if request_json GET /api/admin/users "" "x-api-key: $ADMIN_API_KEY"; then
    if assert_status 200 && assert_ok_true; then pass; else fail "Expected 200"; fi
  else
    fail "Request failed"
  fi
else
  step "Admin endpoints"
  yellow "  SKIP: ADMIN_API_KEY not provided"
  PASSED=$((PASSED + 1))
fi

echo ""
echo "================ Smoke Test Summary ================"
echo "Base URL: $BASE_URL"
echo "Total steps: $TOTAL"
echo "Passed: $PASSED"
echo "Failed: $FAILED"

if [[ "$FAILED" -gt 0 ]]; then
  red "Smoke test completed with failures."
  exit 1
fi

green "Smoke test completed successfully."
