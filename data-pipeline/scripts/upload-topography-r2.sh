#!/usr/bin/env zsh
# =============================================================================
# upload-topography-r2.sh
# Uploads selected topography COGs to Cloudflare R2.
#
# Usage:
#   ./upload-topography-r2.sh <bucket-name>
#   ./upload-topography-r2.sh <bucket-name> --dry-run
#
# Requirements:
#   - wrangler installed and authenticated (npx wrangler login)
#   - Run from the repo root or data-pipeline/scripts
# =============================================================================

set -uo pipefail

BUCKET="${1:?Usage: $0 <bucket-name> [--dry-run]}"
DRY_RUN="${2:-}"
BASE="/Volumes/T7/Terranthro/TerranthroSite/data-pipeline/data/topography"
TOTAL=0
COUNT=0
SKIP_COUNT=0

# Coloured output helpers
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

log()  { echo -e "${CYAN}[upload]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC}    $*"; }
warn() { echo -e "${YELLOW}[skip]${NC}  $*"; }
err()  { echo -e "${RED}[error]${NC} $*" >&2; }

# =============================================================================
# INCLUSION LIST
# Skip the giants: central_coast (3.5G), north_coast (1.7G),
# willamette_valley (2.1G), sierra_foothills (1.3G), south_coast (1.1G),
# san_francisco_bay (994M), hudson_river_region (1.2G),
# southern_oregon (1.1G), rogue_valley (642M), umpqua_valley (403M),
# long_island (464M), upper_hudson (556M)
# =============================================================================

SKIP_DIRS=(
  "CA/central_coast"
  "CA/north_coast"
  "CA/sierra_foothills"
  "CA/south_coast"
  "CA/san_francisco_bay"
  "OR/willamette_valley"
  "OR/southern_oregon"
  "OR/rogue_valley"
  "OR/umpqua_valley"
  "NY/hudson_river_region"
  "NY/long_island"
  "NY/upper_hudson"
)

is_skipped() {
  local rel="$1"
  for skip in "${SKIP_DIRS[@]}"; do
    if [[ "$rel" == "$skip" ]]; then
      return 0
    fi
  done
  return 1
}

upload_file() {
  local local_path="$1"
  local r2_key="$2"
  local size_bytes
  size_bytes=$(stat -f%z "$local_path" 2>/dev/null || stat -c%s "$local_path" 2>/dev/null || echo 0)

  TOTAL=$((TOTAL + size_bytes))
  COUNT=$((COUNT + 1))

  local size_mb
  size_mb=$(echo "scale=1; $size_bytes / 1048576" | bc)

  if [[ "$DRY_RUN" == "--dry-run" ]]; then
    echo "  [DRY-RUN] would upload: ${r2_key} (${size_mb}MB)"
    return
  fi

  local attempt=0
  local success=false
  while (( attempt < 3 )); do
    attempt=$(( attempt + 1 ))
    if npx wrangler r2 object put "${BUCKET}/${r2_key}" \
        --file="$local_path" \
        --content-type="image/tiff" \
        --remote \
        2>&1 | tail -1; then
      success=true
      break
    fi
    warn "Upload failed (attempt ${attempt}/3): ${r2_key} — retrying..."
    sleep 2
  done

  if $success; then
    ok "${r2_key} (${size_mb}MB)"
  else
    err "FAILED after 3 attempts: ${r2_key}"
  fi
}

process_state() {
  local state="$1"
  local state_dir="${BASE}/${state}"

  if [[ ! -d "$state_dir" ]]; then
    warn "State dir not found: $state_dir"
    return
  fi

  log "Processing state: ${state}"

  for ava_dir in "${state_dir}"/*/; do
    [[ -d "$ava_dir" ]] || continue
    local ava_name
    ava_name=$(basename "$ava_dir")
    local rel_path="${state}/${ava_name}"

    if is_skipped "$rel_path"; then
      warn "Skipping large parent AVA: ${rel_path}"
      SKIP_COUNT=$((SKIP_COUNT + 1))
      continue
    fi

    log "  → ${rel_path}"

    for product in elevation slope aspect; do
      local tif="${ava_dir}${product}.tif"
      if [[ -f "$tif" ]]; then
        upload_file "$tif" "topography-data/${state}/${ava_name}/${product}.tif"
      else
        warn "Missing: ${tif}"
      fi
    done
  done
}

# =============================================================================
# MAIN
# =============================================================================

echo ""
echo -e "${CYAN}════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Terranthro Topography → Cloudflare R2 Upload${NC}"
echo -e "${CYAN}  Bucket: ${BUCKET}${NC}"
[[ "$DRY_RUN" == "--dry-run" ]] && echo -e "${YELLOW}  DRY RUN — no files will actually be uploaded${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════${NC}"
echo ""

# Check wrangler is available
if ! npx wrangler --version &>/dev/null; then
  err "wrangler not found. Run: npm install wrangler"
  exit 1
fi

# Process all states
for state in CA OR NY AR ID; do
  process_state "$state"
  echo ""
done

# Summary
TOTAL_MB=$(echo "scale=1; $TOTAL / 1048576" | bc)
TOTAL_GB=$(echo "scale=2; $TOTAL / 1073741824" | bc)

echo ""
echo -e "${CYAN}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Upload complete!${NC}"
echo -e "  Files uploaded : ${COUNT}"
echo -e "  Files skipped  : ${SKIP_COUNT} (large parent AVAs)"
echo -e "  Total size     : ${TOTAL_GB}GB (${TOTAL_MB}MB)"
echo -e "${CYAN}════════════════════════════════════════════════════${NC}"
echo ""
