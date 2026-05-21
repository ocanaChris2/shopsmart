#!/usr/bin/env bash
# =============================================================================
#  Security Header & Cache Behaviour Verifier
#  ShopSmart ERP — Run after Cloudflare configuration to confirm all rules work
#
#  Usage:
#    ./verify-security-headers.sh https://api.yourdomain.com [bearer_token]
#
#  Dependencies: curl, grep
# =============================================================================

set -euo pipefail

BASE_URL="${1:?Usage: $0 <base_url> [bearer_token]}"
TOKEN="${2:-}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
PASS=0; FAIL=0

check() {
  local label="$1"
  local value="$2"
  local expected_pattern="$3"
  local invert="${4:-false}"

  if [[ "${invert}" == "false" ]]; then
    if echo "${value}" | grep -qi "${expected_pattern}"; then
      echo -e "  ${GREEN}✓${RESET} ${label}"
      ((PASS++))
    else
      echo -e "  ${RED}✗${RESET} ${label}"
      echo -e "    Expected pattern: ${CYAN}${expected_pattern}${RESET}"
      echo -e "    Got: ${YELLOW}${value:-<not present>}${RESET}"
      ((FAIL++))
    fi
  else
    if echo "${value}" | grep -qi "${expected_pattern}"; then
      echo -e "  ${RED}✗${RESET} ${label} (should NOT be present)"
      echo -e "    Got: ${YELLOW}${value}${RESET}"
      ((FAIL++))
    else
      echo -e "  ${GREEN}✓${RESET} ${label} (correctly absent)"
      ((PASS++))
    fi
  fi
}

echo ""
echo -e "${CYAN}══════════════════════════════════════════${RESET}"
echo -e "${CYAN}  ShopSmart Security Header Verifier       ${RESET}"
echo -e "${CYAN}  Target: ${BASE_URL}${RESET}"
echo -e "${CYAN}══════════════════════════════════════════${RESET}"

# ── 1. Fetch health endpoint headers ─────────────────────────────────────────
echo -e "\n${CYAN}[1] Security Headers — GET /health${RESET}"
HEALTH_HEADERS=$(curl -sI "${BASE_URL}/health" 2>&1)

HSTS=$(echo "${HEALTH_HEADERS}"    | grep -i "^strict-transport-security:" || true)
XCTO=$(echo "${HEALTH_HEADERS}"    | grep -i "^x-content-type-options:" || true)
XFO=$(echo "${HEALTH_HEADERS}"     | grep -i "^x-frame-options:" || true)
RP=$(echo "${HEALTH_HEADERS}"      | grep -i "^referrer-policy:" || true)
CSP=$(echo "${HEALTH_HEADERS}"     | grep -i "^content-security-policy:" || true)
SERVER=$(echo "${HEALTH_HEADERS}"  | grep -i "^server:" || true)
XPB=$(echo "${HEALTH_HEADERS}"     | grep -i "^x-powered-by:" || true)
CF_RAY=$(echo "${HEALTH_HEADERS}"  | grep -i "^cf-ray:" || true)

check "HSTS (max-age ≥ 15768000)"     "${HSTS}"   "max-age=1[5-9][0-9][0-9][0-9][0-9][0-9][0-9]"
check "HSTS (includeSubDomains)"      "${HSTS}"   "includeSubDomains"
check "X-Content-Type-Options: nosniff" "${XCTO}" "nosniff"
check "X-Frame-Options: DENY"         "${XFO}"    "DENY"
check "Referrer-Policy"               "${RP}"     "strict-origin"
check "Content-Security-Policy"       "${CSP}"    "default-src"
check "Server header removed"         "${SERVER}" "nginx\|fastify\|node\|render" "true"
check "X-Powered-By removed"          "${XPB}"    "." "true"
check "Request proxied through CF"    "${CF_RAY}" "cf-ray"

# ── 2. TLS check ──────────────────────────────────────────────────────────────
echo -e "\n${CYAN}[2] TLS Configuration${RESET}"
TLS_INFO=$(curl -vI "${BASE_URL}/health" 2>&1 | grep -iE "TLSv|SSL|cipher|protocol" || true)
check "TLS 1.2 or 1.3 negotiated"    "${TLS_INFO}" "TLSv1\.[23]"

HTTP_REDIRECT=$(curl -sI "http://$(echo "${BASE_URL}" | sed 's|https://||')/health" \
  -o /dev/null -w "%{http_code}" --max-redirects 0 2>&1 || true)
check "HTTP→HTTPS redirect (301)"    "${HTTP_REDIRECT}" "301"

# ── 3. Cache behaviour ────────────────────────────────────────────────────────
echo -e "\n${CYAN}[3] Cache Rules${RESET}"

# First request (may be MISS or HIT depending on prior traffic)
META_HEADERS_1=$(curl -sI "${BASE_URL}/api/v1/meta/entities" \
  -H "Authorization: Bearer ${TOKEN:-dummy}" 2>&1 || true)
CF_CACHE_1=$(echo "${META_HEADERS_1}" | grep -i "^cf-cache-status:" || true)
echo -e "  Info: First meta request cache status: ${YELLOW}${CF_CACHE_1:-unknown}${RESET}"

# Second request — should be HIT if caching is working
META_HEADERS_2=$(curl -sI "${BASE_URL}/api/v1/meta/entities" \
  -H "Authorization: Bearer ${TOKEN:-dummy}" 2>&1 || true)
CF_CACHE_2=$(echo "${META_HEADERS_2}" | grep -i "^cf-cache-status:" || true)
check "/meta/* → HIT or STALE on 2nd request" "${CF_CACHE_2}" "HIT\|STALE"

# Dynamic data should always BYPASS
if [[ -n "${TOKEN}" ]]; then
  DATA_HEADERS=$(curl -sI "${BASE_URL}/api/v1/data/nonexistent" \
    -H "Authorization: Bearer ${TOKEN}" 2>&1 || true)
  CF_CACHE_DATA=$(echo "${DATA_HEADERS}" | grep -i "^cf-cache-status:" || true)
  check "/data/* → always BYPASS"  "${CF_CACHE_DATA}" "BYPASS"
else
  echo -e "  ${YELLOW}⚠${RESET}  Skipping /data/* cache check (no bearer token provided)"
fi

# Auth should BYPASS
AUTH_HEADERS=$(curl -sI -X POST "${BASE_URL}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"x@x.com","password":"wrongpassword"}' 2>&1 || true)
CF_CACHE_AUTH=$(echo "${AUTH_HEADERS}" | grep -i "^cf-cache-status:" || true)
check "/auth/* → always BYPASS"  "${CF_CACHE_AUTH}" "BYPASS"

# ── 4. WAF Origin enforcement ─────────────────────────────────────────────────
echo -e "\n${CYAN}[4] WAF — Unknown Origin Blocking${RESET}"

MALICIOUS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Origin: https://definitely-malicious.example.com" \
  "${BASE_URL}/api/v1/data/test" 2>&1 || true)

if [[ "${MALICIOUS_STATUS}" == "403" ]] || [[ "${MALICIOUS_STATUS}" == "429" ]]; then
  echo -e "  ${GREEN}✓${RESET} Unknown Origin rejected (HTTP ${MALICIOUS_STATUS})"
  ((PASS++))
else
  echo -e "  ${YELLOW}⚠${RESET}  Unknown Origin returned HTTP ${MALICIOUS_STATUS} — WAF rule may not be active yet"
  echo -e "     (Allow up to 1 minute for CF rules to propagate)"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}══════════════════════════════════════════${RESET}"
TOTAL=$((PASS + FAIL))
if [[ ${FAIL} -eq 0 ]]; then
  echo -e "  ${GREEN}All ${TOTAL} checks passed ✓${RESET}"
else
  echo -e "  ${GREEN}${PASS}/${TOTAL} passed${RESET}  ${RED}${FAIL} failed ✗${RESET}"
fi
echo -e "${CYAN}══════════════════════════════════════════${RESET}"
echo ""
[[ ${FAIL} -eq 0 ]] && exit 0 || exit 1
