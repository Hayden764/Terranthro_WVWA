#!/usr/bin/env bash
# generate-pmtiles.sh
#
# Exports vineyard parcels and winery points from PostGIS and builds PMTiles
# files for use with MapLibre GL JS (native pmtiles:// support in v4+).
#
# Prerequisites:
#   brew install tippecanoe gdal
#
# Usage:
#   ./generate-pmtiles.sh
#
# Output:
#   client-wvwa/public/tiles/vineyard_parcels.pmtiles
#   client-wvwa/public/tiles/wineries.pmtiles
#
# For production, upload the .pmtiles files to Cloudflare R2 and update the
# MapLibre source URLs to use the R2 endpoint.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
# Accepts DATABASE_URL (Supabase / Railway connection string) or individual vars.
# Examples:
#   DATABASE_URL="postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres" ./generate-pmtiles.sh
#   DB_HOST=localhost DB_USER=terranthro_user ./generate-pmtiles.sh

if [ -n "${DATABASE_URL:-}" ]; then
  # ogr2ogr accepts PostgreSQL connection strings directly via the PG: prefix
  PG_DSN="PG:${DATABASE_URL}"
else
  DB_HOST="${DB_HOST:-localhost}"
  DB_PORT="${DB_PORT:-5432}"
  DB_NAME="${DB_NAME:-terranthro}"
  DB_USER="${DB_USER:-terranthro_user}"
  DB_PASS="${DB_PASS:-terranthro_pass}"
  PG_DSN="PG:host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME} user=${DB_USER} password=${DB_PASS}"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
TILES_DIR="${REPO_ROOT}/TerranthroSite/client-wvwa/public/tiles"
TMP_DIR="$(mktemp -d)"

# Resolve tiles dir relative to this script's repo location
TILES_DIR="${SCRIPT_DIR}/../../client-wvwa/public/tiles"

echo "Creating tiles directory: ${TILES_DIR}"
mkdir -p "${TILES_DIR}"

# ── Vineyard Parcels ──────────────────────────────────────────────────────────
echo ""
echo "Step 1: Exporting vineyard parcels from PostGIS..."

PARCELS_GEOJSON="${TMP_DIR}/vineyard_parcels.geojson"

# Exclude PII columns: owner_name, situs_address, situs_city, situs_zip
ogr2ogr \
  -f GeoJSON "${PARCELS_GEOJSON}" \
  "${PG_DSN}" \
  -sql "
    SELECT
      vp.id,
      vp.winery_id,
      vp.source_dataset,
      vp.vineyard_name,
      vp.vineyard_org,
      vp.acres,
      vp.nested_ava,
      vp.nested_nested_ava,
      vp.varietals_list,
      w.recid AS winery_recid,
      w.title AS winery_title,
      vp.geometry
    FROM vineyard_parcels vp
    LEFT JOIN wineries w ON vp.winery_id = w.id
  "

echo "  Exported: ${PARCELS_GEOJSON}"

echo ""
echo "Step 2: Building vineyard_parcels.pmtiles..."

tippecanoe \
  --output="${TILES_DIR}/vineyard_parcels.pmtiles" \
  --layer=vineyard_parcels \
  --minimum-zoom=8 \
  --maximum-zoom=14 \
  --simplification=2 \
  --drop-densest-as-needed \
  --force \
  "${PARCELS_GEOJSON}"

echo "  Built: ${TILES_DIR}/vineyard_parcels.pmtiles"

# ── Winery Points ─────────────────────────────────────────────────────────────
echo ""
echo "Step 3: Exporting winery points from PostGIS..."

WINERIES_GEOJSON="${TMP_DIR}/wineries.geojson"

# Exclude phone (PII) — keep recid, title, category, parcel_count for map labels
ogr2ogr \
  -f GeoJSON "${WINERIES_GEOJSON}" \
  "${PG_DSN}" \
  -sql "
    SELECT
      w.id,
      w.recid,
      w.title,
      w.category,
      (SELECT COUNT(*) FROM vineyard_parcels vp WHERE vp.winery_id = w.id) AS parcel_count,
      w.location AS geometry
    FROM wineries w
  "

echo "  Exported: ${WINERIES_GEOJSON}"

echo ""
echo "Step 4: Building wineries.pmtiles..."

tippecanoe \
  --output="${TILES_DIR}/wineries.pmtiles" \
  --layer=wineries \
  --minimum-zoom=6 \
  --maximum-zoom=16 \
  --cluster-distance=5 \
  --force \
  "${WINERIES_GEOJSON}"

echo "  Built: ${TILES_DIR}/wineries.pmtiles"

# ── Cleanup ───────────────────────────────────────────────────────────────────
rm -rf "${TMP_DIR}"

echo ""
echo "Done. PMTiles files:"
ls -lh "${TILES_DIR}/"*.pmtiles

echo ""
echo "To upload to Cloudflare R2:"
echo "  aws s3 cp ${TILES_DIR}/vineyard_parcels.pmtiles s3://YOUR_BUCKET/tiles/vineyard_parcels.pmtiles \\"
echo "    --endpoint-url https://YOUR_ACCOUNT.r2.cloudflarestorage.com"
