#!/usr/bin/env bash
# =============================================================================
#  Cloudflare Cache Purge — /api/v1/meta/* Namespace
#  ShopSmart ERP — Run after any meta.entities or meta.fields mutation
#
#  Usage:
#    ./purge-meta-cache.sh                      # purge root + all known slugs
#    ./purge-meta-cache.sh vehicle patient       # purge specific entity slugs
#    ./purge-meta-cache.sh --all                 # nuclear: purge EVERYTHING (use sparingly)
#
#  Required environment variables (export or use a .env file):
#    CF_API_TOKEN   — Cloudflare API Token (Zone:Cache Purge permission)
#    CF_ZONE_ID     — Cloudflare Zone ID   (Dashboard → domain → Overview sidebar)
#    API_BASE_URL   — e.g. https://api.yourdomain.com (no trailing slash)
#
#  Plan requirements:
#    URL purge (this script's default): FREE
#    Prefix purge (commented section):  PRO+
#    Everything purge (--all flag):      FREE (use only in emergencies)
# =============================================================================

set -euo pipefail

# ── Load environment ──────────────────────────────────────────────────────────
# Load from .env if present (for local/CI use); otherwise rely on exported vars.
if [[ -f "$(dirname "$0")/../../.env" ]]; then
  # shellcheck source=/dev/null
  set -o allexport
  source "$(dirname "$0")/../../.env"
  set +o allexport
fi

: "${CF_API_TOKEN:?CF_API_TOKEN is required}"
: "${CF_ZONE_ID:?CF_ZONE_ID is required}"
: "${API_BASE_URL:?API_BASE_URL is required (e.g. https://api.yourdomain.com)}"

CF_API="https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache"

# ── Colour output helpers ─────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
info()    { echo -e "${GREEN}[INFO]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

# ── Parse arguments ───────────────────────────────────────────────────────────
ENTITY_SLUGS=()
PURGE_ALL=false

for arg in "$@"; do
  case "$arg" in
    --all) PURGE_ALL=true ;;
    *)     ENTITY_SLUGS+=("$arg") ;;
  esac
done

# ── Helper: call Cloudflare purge API ─────────────────────────────────────────
purge() {
  local description="$1"
  local body="$2"

  info "Purging: ${description}"

  local response
  response=$(curl --silent --show-error --fail-with-body \
    --request POST "${CF_API}" \
    --header "Authorization: Bearer ${CF_API_TOKEN}" \
    --header "Content-Type: application/json" \
    --data "${body}" 2>&1) || {
      error "Cloudflare API call failed:\n${response}"
      exit 1
    }

  # Check CF success flag in the JSON response
  local success
  success=$(echo "${response}" | grep -o '"success":[^,}]*' | head -1 | cut -d: -f2 | tr -d ' ')

  if [[ "${success}" != "true" ]]; then
    error "Cloudflare returned an error:\n${response}"
    exit 1
  fi

  info "Purged successfully ✓"
}

# ── Nuclear option: purge everything ─────────────────────────────────────────
if [[ "${PURGE_ALL}" == "true" ]]; then
  warn "PURGING ENTIRE ZONE CACHE — this will slow all users temporarily."
  warn "Press Ctrl+C within 5 seconds to abort..."
  sleep 5
  purge "Entire zone cache" '{"purge_everything": true}'
  info "Done. All cached content cleared."
  exit 0
fi

# ── Build list of URLs to purge ───────────────────────────────────────────────
#
# Cloudflare free tier allows purging up to 30 specific URLs per API call
# (and up to 30,000 purge calls per month).
#
# We purge:
#   1. The root entities listing   → /api/v1/meta/entities
#   2. Per-entity detail endpoint  → /api/v1/meta/entities/{slug}
#   3. Per-entity fields endpoint  → /api/v1/meta/fields/{slug}
#
# If no slugs are passed, we purge only the listing endpoints.

URLS=()

# Always purge the top-level listing
URLS+=("${API_BASE_URL}/api/v1/meta/entities")
URLS+=("${API_BASE_URL}/api/v1/meta/fields")

# Purge entity-specific paths for each slug provided
if [[ ${#ENTITY_SLUGS[@]} -gt 0 ]]; then
  for slug in "${ENTITY_SLUGS[@]}"; do
    URLS+=("${API_BASE_URL}/api/v1/meta/entities/${slug}")
    URLS+=("${API_BASE_URL}/api/v1/meta/fields/${slug}")
    info "Queued: ${slug}"
  done
fi

# Build the JSON array of URLs
#   ["url1","url2", ...]
FILES_JSON=$(printf '%s\n' "${URLS[@]}" | jq -R . | jq -sc .)
BODY=$(printf '{"files":%s}' "${FILES_JSON}")

info "URLs to purge: ${#URLS[@]}"
for url in "${URLS[@]}"; do
  echo "  → ${url}"
done

purge "${#URLS[@]} meta URLs" "${BODY}"

# ── PRO+ alternative: purge by prefix ────────────────────────────────────────
# Uncomment this block and comment out the URL purge above if you are on Pro+.
# A single prefix purge invalidates ALL cached responses under that path,
# without needing to enumerate individual URLs.
#
# DOMAIN=$(echo "${API_BASE_URL}" | sed 's|https://||')
# PREFIX="${DOMAIN}/api/v1/meta/"
# purge "prefix ${PREFIX}" "{\"prefixes\":[\"${PREFIX}\"]}"

echo ""
info "Cache purge complete."
info "Edge will re-populate from origin on the next request to each URL."
info "Browser caches (1h TTL) will refresh naturally."
