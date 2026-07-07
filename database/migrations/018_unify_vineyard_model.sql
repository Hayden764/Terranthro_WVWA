-- ─────────────────────────────────────────────────────────────────────────────
-- 018: Unify the vineyard data model
--
-- Before: two coexisting models.
--   • East AVAs (adelsheim / chehalem-dundee / yamhill-carlton): one
--     vineyard_parcels row PER TAX-LOT POLYGON; blocks attribute-only.
--   • West AVAs (wvwa-ml-2025): one parcel per vineyard entity (footprint
--     union), individual polygons in vineyard_blocks.geometry.
--
-- After (single model everywhere):
--   • vineyards (renamed from vineyard_parcels): one row per vineyard entity,
--     geometry = ST_Union footprint of its blocks.
--   • vineyard_blocks: one row per polygon, FK vineyard_id (renamed from
--     vineyard_parcel_id), provenance in source_dataset
--     ('wvwa-ml-2025' | 'tax-lot' | 'adelsheim-csv').
--   • legacy_parcel_map: permanent old-parcel-id → (vineyard, block) mapping
--     so historical edit_requests.target_id / winery_edit_log.record_id stay
--     resolvable. NEVER drop this table.
--   • trg_vineyard_footprint keeps vineyards.geometry/acres synced from block
--     unions (QGIS edits blocks directly against Postgres).
--
-- East grouping rules (validated against live data, 2026-07-07):
--   • Group key is dataset-scoped: (source_dataset, lower(trim(vineyard_name))).
--     The three east files have zero spatial overlap; same names across
--     datasets (caroline/ellis vineyards) are distinct vineyards km apart.
--   • Junk names ('??', 'unknown') and NULLs become singleton unnamed
--     vineyards — never merged into one fake vineyard.
--   • Names spanning two winery records (Durant twins, etzel, ridgecrest) are
--     contiguous single vineyards → ONE vineyard, winery_id = most common
--     non-null link (no sub-splitting).
--   • owner_name / situs_* / parcel_label are dropped from the DB; the county
--     parcel layer in QGIS is the reference for ownership. parcel_label values
--     are preserved as the new blocks' block_name.
--
-- Prerequisites (run first, outside this file):
--   pg_dump "$DATABASE_URL" -Fc -f backups/pre_018_<date>.dump
--   CREATE TABLE _bak_vineyard_parcels_018 AS TABLE vineyard_parcels;
--   CREATE TABLE _bak_vineyard_blocks_018  AS TABLE vineyard_blocks;
--   CREATE TABLE _bak_vp_topo_stats_018    AS TABLE vineyard_parcel_topo_stats;
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- PART 1 — additive schema changes
-- ═════════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE vineyard_blocks ADD COLUMN IF NOT EXISTS source_dataset VARCHAR(30);
ALTER TABLE vineyard_blocks ALTER COLUMN vineyard_name DROP NOT NULL;

-- Backfill provenance for existing block rows
UPDATE vineyard_blocks vb SET source_dataset = 'wvwa-ml-2025'
FROM vineyard_parcels vp
WHERE vb.vineyard_parcel_id = vp.id
  AND vp.source_dataset = 'wvwa-ml-2025'
  AND vb.source_dataset IS NULL;

UPDATE vineyard_blocks SET source_dataset = 'adelsheim-csv'
WHERE source_dataset IS NULL;

CREATE TABLE IF NOT EXISTS legacy_parcel_map (
    old_parcel_id   INTEGER PRIMARY KEY,
    new_vineyard_id INTEGER NOT NULL,
    new_block_id    INTEGER NOT NULL,
    migrated_at     TIMESTAMP DEFAULT NOW()
);
COMMENT ON TABLE legacy_parcel_map IS
  'Pre-018 vineyard_parcels ids → post-018 (vineyard, block) ids. Historical '
  'edit_requests.target_id / winery_edit_log.record_id resolve through this. Never drop.';

COMMIT;


-- ═════════════════════════════════════════════════════════════════════════════
-- PART 2 — restructure east data, then rename (single transaction)
-- ═════════════════════════════════════════════════════════════════════════════
BEGIN;

-- Staging columns give order-proof id mapping (sturdier than the RETURNING /
-- row_number pairing used in migration 004).
ALTER TABLE vineyard_parcels ADD COLUMN mig_group_key TEXT;
ALTER TABLE vineyard_blocks  ADD COLUMN mig_old_parcel_id INTEGER;

-- (1) One row per east tax-lot polygon, tagged with its vineyard group key.
CREATE TEMP TABLE east_grp AS
WITH e AS (
  SELECT vp.*,
         -- junk names count as unnamed
         NULLIF(NULLIF(LOWER(TRIM(vp.vineyard_name)), '??'), 'unknown') AS name_key
  FROM vineyard_parcels vp
  WHERE vp.source_dataset IN ('adelsheim', 'chehalem-dundee', 'yamhill-carlton')
)
SELECT
  e.id AS old_parcel_id,
  e.source_dataset,
  e.geometry,
  e.parcel_label,
  CASE WHEN e.name_key IS NULL THEN 'row:' || e.id
       ELSE e.source_dataset || '|' || e.name_key END AS group_key,
  CASE WHEN e.name_key IS NULL THEN NULL ELSE TRIM(e.vineyard_name) END AS vineyard_name_clean,
  e.winery_id, e.vineyard_org, e.ava_name, e.nested_ava, e.nested_nested_ava,
  e.varietals_list, e.ava_id, e.z1_vineyard_id
FROM e;

-- (2) Vineyard footprints per group (union computed once).
CREATE TEMP TABLE grp_geom AS
SELECT group_key,
       ST_Multi(ST_Union(ST_MakeValid(geometry))) AS geom
FROM east_grp
GROUP BY group_key;

-- (3) Insert one vineyard row per group.
INSERT INTO vineyard_parcels (
    winery_id, source_dataset, vineyard_name, vineyard_org,
    ava_name, nested_ava, nested_nested_ava, varietals_list,
    ava_id, z1_vineyard_id, geometry, acres, mig_group_key)
SELECT
  mode() WITHIN GROUP (ORDER BY eg.winery_id) FILTER (WHERE eg.winery_id IS NOT NULL),
  MIN(eg.source_dataset),
  MIN(eg.vineyard_name_clean),
  mode() WITHIN GROUP (ORDER BY eg.vineyard_org) FILTER (WHERE eg.vineyard_org IS NOT NULL),
  mode() WITHIN GROUP (ORDER BY eg.ava_name) FILTER (WHERE eg.ava_name IS NOT NULL),
  mode() WITHIN GROUP (ORDER BY eg.nested_ava) FILTER (WHERE eg.nested_ava IS NOT NULL),
  mode() WITHIN GROUP (ORDER BY eg.nested_nested_ava) FILTER (WHERE eg.nested_nested_ava IS NOT NULL),
  (SELECT string_agg(DISTINCT u.v, ', ')
     FROM unnest(array_agg(eg.varietals_list)) AS u(v)
    WHERE u.v IS NOT NULL AND TRIM(u.v) <> ''),
  MIN(eg.ava_id),
  MIN(eg.z1_vineyard_id),
  gg.geom,
  ROUND((ST_Area(gg.geom::geography) / 4046.856422)::numeric, 3),
  eg.group_key
FROM east_grp eg
JOIN grp_geom gg USING (group_key)
GROUP BY eg.group_key, gg.geom;

CREATE TEMP TABLE grp_map AS
SELECT mig_group_key AS group_key, id AS new_vineyard_id
FROM vineyard_parcels
WHERE mig_group_key IS NOT NULL;

-- (4) Each old tax-lot polygon → a block (trg_block_acres computes acres;
--     old parcel_label becomes the block's display name).
INSERT INTO vineyard_blocks (
    vineyard_parcel_id, vineyard_name, block_name,
    geometry, source_dataset, mig_old_parcel_id)
SELECT gm.new_vineyard_id, eg.vineyard_name_clean, eg.parcel_label,
       eg.geometry, 'tax-lot', eg.old_parcel_id
FROM east_grp eg
JOIN grp_map gm ON gm.group_key = eg.group_key;

-- (5) Permanent legacy id map.
INSERT INTO legacy_parcel_map (old_parcel_id, new_vineyard_id, new_block_id)
SELECT vb.mig_old_parcel_id, vb.vineyard_parcel_id, vb.id
FROM vineyard_blocks vb
WHERE vb.mig_old_parcel_id IS NOT NULL;

-- (6) Re-link pre-existing blocks (the adelsheim CSV attribute blocks) to the
--     new vineyard rows BEFORE deleting old parcels — the FK is ON DELETE CASCADE.
UPDATE vineyard_blocks vb
SET vineyard_parcel_id = m.new_vineyard_id
FROM legacy_parcel_map m
WHERE vb.vineyard_parcel_id = m.old_parcel_id
  AND vb.mig_old_parcel_id IS NULL;

-- (7) Old per-polygon topo stats semantically belong to the new blocks.
--     (vineyard-level footprint stats get recomputed by the pipeline later.)
INSERT INTO vineyard_block_topo_stats (
    block_id, elevation_min_ft, elevation_max_ft, elevation_mean_ft,
    elevation_std_ft, slope_mean_deg, slope_max_deg, slope_p10_deg,
    slope_p90_deg, aspect_dominant_deg, aspect_mean_deg, pixel_count,
    data_source, computed_at)
SELECT m.new_block_id, t.elevation_min_ft, t.elevation_max_ft, t.elevation_mean_ft,
       t.elevation_std_ft, t.slope_mean_deg, t.slope_max_deg, t.slope_p10_deg,
       t.slope_p90_deg, t.aspect_dominant_deg, t.aspect_mean_deg, t.pixel_count,
       t.data_source, t.computed_at
FROM vineyard_parcel_topo_stats t
JOIN legacy_parcel_map m ON m.old_parcel_id = t.parcel_id
ON CONFLICT (block_id) DO NOTHING;

-- (8) Delete old east per-polygon parcel rows (their topo stats CASCADE — copied above).
DELETE FROM vineyard_parcels vp
USING legacy_parcel_map m
WHERE vp.id = m.old_parcel_id;

-- (9) Enforce the footprint invariant on west vineyards too (pre-flight Report C:
--     only one 0.02-acre sliver drifts, so a straight reset is safe).
UPDATE vineyard_parcels v
SET geometry = u.geom,
    acres    = ROUND((ST_Area(u.geom::geography) / 4046.856422)::numeric, 3)
FROM (SELECT vineyard_parcel_id, ST_Multi(ST_Union(ST_MakeValid(geometry))) AS geom
      FROM vineyard_blocks
      WHERE geometry IS NOT NULL
      GROUP BY vineyard_parcel_id) u
WHERE u.vineyard_parcel_id = v.id
  AND v.source_dataset = 'wvwa-ml-2025';

-- (10) Drop tax-lot-only columns (ownership reference lives in the county
--      parcel layer in QGIS) and the staging columns.
ALTER TABLE vineyard_parcels
  DROP COLUMN owner_name,
  DROP COLUMN situs_address,
  DROP COLUMN situs_city,
  DROP COLUMN situs_zip,
  DROP COLUMN parcel_label,
  DROP COLUMN mig_group_key;
ALTER TABLE vineyard_blocks DROP COLUMN mig_old_parcel_id;

-- (11) Sanity checks — any failure aborts the whole transaction.
DO $$
DECLARE bad INT; expected INT;
BEGIN
  -- every old east parcel is mapped
  SELECT COUNT(*) INTO expected FROM _bak_vineyard_parcels_018
   WHERE source_dataset IN ('adelsheim','chehalem-dundee','yamhill-carlton');
  SELECT COUNT(*) INTO bad FROM legacy_parcel_map;
  IF bad <> expected THEN
    RAISE EXCEPTION 'legacy_parcel_map has % rows, expected %', bad, expected;
  END IF;

  -- no orphan blocks
  SELECT COUNT(*) INTO bad FROM vineyard_blocks b
   LEFT JOIN vineyard_parcels v ON v.id = b.vineyard_parcel_id
   WHERE b.vineyard_parcel_id IS NOT NULL AND v.id IS NULL;
  IF bad > 0 THEN RAISE EXCEPTION 'orphan blocks: %', bad; END IF;

  -- no block without provenance
  SELECT COUNT(*) INTO bad FROM vineyard_blocks WHERE source_dataset IS NULL;
  IF bad > 0 THEN RAISE EXCEPTION 'blocks with NULL source_dataset: %', bad; END IF;

  -- east acre conservation within 0.5% (geodesic recompute tolerance)
  SELECT COUNT(*) INTO bad FROM (
    SELECT ABS(
      (SELECT SUM(acres) FROM vineyard_blocks WHERE source_dataset = 'tax-lot') -
      (SELECT SUM(acres) FROM _bak_vineyard_parcels_018
        WHERE source_dataset IN ('adelsheim','chehalem-dundee','yamhill-carlton'))
    ) AS diff) d
  WHERE d.diff > 0.005 * (SELECT SUM(acres) FROM _bak_vineyard_parcels_018
        WHERE source_dataset IN ('adelsheim','chehalem-dundee','yamhill-carlton'));
  IF bad > 0 THEN RAISE EXCEPTION 'east acre sum drifted more than 0.5%%'; END IF;
END $$;

-- (12) Renames — last, so un-refactored code fails loudly after commit instead
--      of silently misreading restructured data.
ALTER TABLE vineyard_parcels RENAME TO vineyards;
ALTER SEQUENCE vineyard_parcels_id_seq RENAME TO vineyards_id_seq;
ALTER TABLE vineyard_blocks RENAME COLUMN vineyard_parcel_id TO vineyard_id;
ALTER TABLE vineyard_parcel_topo_stats RENAME TO vineyard_topo_stats;
ALTER TABLE vineyard_topo_stats RENAME COLUMN parcel_id TO vineyard_id;

ALTER INDEX IF EXISTS vineyard_parcels_pkey RENAME TO vineyards_pkey;
ALTER INDEX IF EXISTS idx_vp_geometry   RENAME TO idx_v_geometry;
ALTER INDEX IF EXISTS idx_vp_winery_id  RENAME TO idx_v_winery_id;
ALTER INDEX IF EXISTS idx_vp_ava_id     RENAME TO idx_v_ava_id;
ALTER INDEX IF EXISTS idx_vp_source     RENAME TO idx_v_source;
ALTER INDEX IF EXISTS idx_vp_ava_name   RENAME TO idx_v_ava_name;
ALTER INDEX IF EXISTS idx_vp_nested_ava RENAME TO idx_v_nested_ava;
ALTER INDEX IF EXISTS idx_vb_parcel_id  RENAME TO idx_vb_vineyard_id;
ALTER INDEX IF EXISTS vineyard_parcel_topo_stats_pkey RENAME TO vineyard_topo_stats_pkey;
ALTER INDEX IF EXISTS idx_vptopostats_parcel RENAME TO idx_vtopostats_vineyard;
ALTER INDEX IF EXISTS uq_vp_topo_stats_parcel RENAME TO uq_v_topo_stats_vineyard;

COMMIT;


-- ═════════════════════════════════════════════════════════════════════════════
-- PART 3 — footprint sync: vineyards.geometry/acres follow the union of their
-- blocks. Created after the bulk migration so it never fires during it.
-- ═════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION refresh_vineyard_footprint() RETURNS TRIGGER AS $$
DECLARE vid INT;
BEGIN
  FOREACH vid IN ARRAY ARRAY_REMOVE(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.vineyard_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.vineyard_id END], NULL)
  LOOP
    UPDATE vineyards v
    SET geometry = COALESCE(u.geom, v.geometry),   -- keep last footprint if all blocks gone
        acres    = COALESCE(ROUND((ST_Area(u.geom::geography) / 4046.856422)::numeric, 3), v.acres)
    FROM (SELECT ST_Multi(ST_Union(ST_MakeValid(geometry))) AS geom
          FROM vineyard_blocks
          WHERE vineyard_id = vid AND geometry IS NOT NULL) u
    WHERE v.id = vid;
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vineyard_footprint ON vineyard_blocks;
CREATE TRIGGER trg_vineyard_footprint
  AFTER INSERT OR DELETE OR UPDATE OF geometry, vineyard_id
  ON vineyard_blocks
  FOR EACH ROW
  EXECUTE FUNCTION refresh_vineyard_footprint();

-- One-shot batch resync for recovery / paranoia:
--   SELECT refresh_all_vineyard_footprints();
CREATE OR REPLACE FUNCTION refresh_all_vineyard_footprints() RETURNS INTEGER AS $$
DECLARE n INT;
BEGIN
  UPDATE vineyards v
  SET geometry = u.geom,
      acres    = ROUND((ST_Area(u.geom::geography) / 4046.856422)::numeric, 3)
  FROM (SELECT vineyard_id, ST_Multi(ST_Union(ST_MakeValid(geometry))) AS geom
        FROM vineyard_blocks
        WHERE geometry IS NOT NULL
        GROUP BY vineyard_id) u
  WHERE u.vineyard_id = v.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$ LANGUAGE plpgsql;

COMMIT;
