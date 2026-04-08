#!/usr/bin/env zsh
# ============================================================
# upload-terrain-r2.sh
# Uploads selected terrain COGs to Cloudflare R2
#
# Usage:
#   ./scripts/upload-terrain-r2.sh <BUCKET_NAME>
#
# Example:
#   ./scripts/upload-terrain-r2.sh terranthro-data
#
# Requires wrangler to be logged in:
#   npx wrangler login
# ============================================================

set -e

BUCKET="${1:?Usage: $0 <bucket-name>}"
BASE="/Volumes/T7/Terranthro/TerranthroSite/data-pipeline/data/topography"
WRANGLER="npx wrangler"

# ── Helper ────────────────────────────────────────────────────
upload_ava() {
  local state="$1"
  local ava="$2"
  local dir="$BASE/$state/$ava"

  if [[ ! -d "$dir" ]]; then
    echo "⚠️  MISSING: $state/$ava — skipping"
    return
  fi

  for product in elevation slope aspect; do
    local file="$dir/${product}.tif"
    if [[ ! -f "$file" ]]; then
      echo "  ⚠️  Missing $product.tif for $state/$ava — skipping"
      continue
    fi
    local key="topography-data/$state/$ava/${product}.tif"
    echo "  ⬆️  $key ($(du -sh "$file" | cut -f1))"
    $WRANGLER r2 object put "$BUCKET/$key" \
      --file "$file" \
      --content-type "image/tiff" 2>&1 | grep -v "^$"
  done
  echo "  ✅ $state/$ava done"
}

echo ""
echo "🗂️  Uploading terrain COGs to R2 bucket: $BUCKET"
echo "────────────────────────────────────────────────"

# ── CALIFORNIA: Napa Valley sub-AVAs ─────────────────────────
echo "\n📍 CA — Napa sub-AVAs"
for ava in \
  calistoga rutherford oakville yountville st__helena \
  stags_leap_district howell_mountain diamond_mountain_district \
  spring_mountain_district mt__veeder atlas_peak coombsville \
  chiles_valley crystal_springs_of_napa_valley \
  oak_knoll_district_of_napa_valley; do
  upload_ava CA "$ava"
done

# ── CALIFORNIA: Sonoma sub-AVAs ──────────────────────────────
echo "\n📍 CA — Sonoma sub-AVAs"
for ava in \
  dry_creek_valley russian_river_valley alexander_valley \
  knights_valley sonoma_valley chalk_hill \
  green_valley_of_russian_river_valley fort_ross_seaview \
  moon_mountain_district_sonoma_county rockpile \
  bennett_valley fountaingrove_district; do
  upload_ava CA "$ava"
done

# ── CALIFORNIA: Mendocino / Lake County ──────────────────────
echo "\n📍 CA — Mendocino / Lake County"
for ava in \
  anderson_valley redwood_valley potter_valley \
  mendocino_ridge clear_lake high_valley red_hills_lake_county \
  kelsey_bench_lake_county; do
  upload_ava CA "$ava"
done

# ── CALIFORNIA: Central Coast notable sub-AVAs ───────────────
echo "\n📍 CA — Central Coast sub-AVAs"
for ava in \
  santa_lucia_highlands arroyo_grande_valley edna_valley \
  sta__rita_hills happy_canyon_of_santa_barbara \
  ballard_canyon los_olivos_district santa_maria_valley \
  chalone paso_robles_highlands_district \
  paso_robles_willow_creek_district paso_robles_estrella_district \
  paso_robles_geneseo_district templeton_gap_district \
  adelaida_district; do
  upload_ava CA "$ava"
done

# ── CALIFORNIA: Livermore / Bay Area ─────────────────────────
echo "\n📍 CA — Bay Area sub-AVAs"
for ava in \
  livermore_valley santa_cruz_mountains contra_costa \
  lamorinda; do
  upload_ava CA "$ava"
done

# ── OREGON: Willamette Valley sub-AVAs ───────────────────────
echo "\n📍 OR — Willamette sub-AVAs"
for ava in \
  dundee_hills ribbon_ridge chehalem_mountains eola_amity_hills \
  mcminnville yamhill_carlton van_duzer_corridor laurelwood_district \
  tualatin_hills mount_pisgah__polk_county__oregon lower_long_tom; do
  upload_ava OR "$ava"
done

# ── NEW YORK ──────────────────────────────────────────────────
echo "\n📍 NY — Finger Lakes & Long Island"
for ava in \
  cayuga_lake seneca_lake niagara_escarpment \
  champlain_valley_of_new_york finger_lakes lake_erie \
  north_fork_of_long_island the_hamptons_long_island; do
  upload_ava NY "$ava"
done

# ── ARKANSAS ──────────────────────────────────────────────────
echo "\n📍 AR — All"
for ava in altus arkansas_mountain; do
  upload_ava AR "$ava"
done

# ── IDAHO ─────────────────────────────────────────────────────
echo "\n📍 ID — All"
upload_ava ID snake_river_valley

echo ""
echo "────────────────────────────────────────────────"
echo "🎉 Upload complete!"
