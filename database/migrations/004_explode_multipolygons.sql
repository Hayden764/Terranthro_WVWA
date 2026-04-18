-- Migration: explode MultiPolygon vineyard_parcels into individual Polygon rows
-- Each sub-polygon gets its own row with all metadata copied from the parent.
-- Blocks linked to the original parcel are re-linked to the largest sub-polygon.
-- Topo stats for the originals are deleted (need recompute on new parcel IDs).
--
-- NOTE: ST_Dump must only be called ONCE per SELECT to avoid N² row explosion.
-- We pre-compute the dump into a temp table and reference it by ctid.

BEGIN;

-- 1. Expand each MultiPolygon into individual polygon rows (one ST_Dump call only)
CREATE TEMP TABLE mp_staging AS
SELECT
  vp.id                                                         AS original_id,
  (d).path[1]                                                   AS sub_index,
  ST_SetSRID((d).geom, 4326)                                    AS geometry,
  ROUND((ST_Area(ST_SetSRID((d).geom, 4326)::geography) / 4047.0)::numeric, 3) AS acres,
  -- Rank by area DESC so area_rank=1 is the largest sub-polygon
  rank() OVER (
    PARTITION BY vp.id
    ORDER BY ST_Area((d).geom) DESC
  )                                                             AS area_rank,
  vp.vineyard_name, vp.vineyard_org, vp.owner_name,
  vp.ava_name, vp.nested_ava, vp.nested_nested_ava,
  vp.situs_address, vp.situs_city, vp.situs_zip,
  vp.varietals_list, vp.source_dataset, vp.winery_id
FROM vineyard_parcels vp,
     LATERAL ST_Dump(vp.geometry) d        -- single expansion, no window re-call
WHERE ST_GeometryType(vp.geometry) = 'ST_MultiPolygon';

-- 2. Insert new single-polygon rows and capture their IDs via a mapping table
CREATE TEMP TABLE mp_id_map AS
WITH inserted AS (
  INSERT INTO vineyard_parcels (
    vineyard_name, vineyard_org, owner_name,
    ava_name, nested_ava, nested_nested_ava,
    situs_address, situs_city, situs_zip,
    varietals_list, source_dataset, winery_id,
    geometry, acres
  )
  SELECT
    vineyard_name, vineyard_org, owner_name,
    ava_name, nested_ava, nested_nested_ava,
    situs_address, situs_city, situs_zip,
    varietals_list, source_dataset, winery_id,
    geometry, acres
  FROM mp_staging
  ORDER BY original_id, sub_index         -- deterministic insertion order
  RETURNING id
),
-- Number inserted rows in insertion order
ins_numbered AS (
  SELECT id AS new_id, row_number() OVER () AS rn FROM inserted
),
-- Number staging rows in the same ORDER BY as the INSERT
stg_numbered AS (
  SELECT original_id, area_rank, row_number() OVER (ORDER BY original_id, sub_index) AS rn
  FROM mp_staging
)
SELECT ins_numbered.new_id, stg_numbered.original_id, stg_numbered.area_rank
FROM ins_numbered
JOIN stg_numbered USING (rn);

-- 3. Re-link vineyard_blocks to the largest sub-polygon (area_rank = 1)
UPDATE vineyard_blocks vb
SET vineyard_parcel_id = m.new_id
FROM mp_id_map m
WHERE m.original_id = vb.vineyard_parcel_id
  AND m.area_rank = 1;

-- 4. Delete stale topo stats for original MultiPolygon rows
DELETE FROM vineyard_parcel_topo_stats
WHERE parcel_id IN (SELECT DISTINCT original_id FROM mp_staging);

-- 5. Delete the original MultiPolygon rows
DELETE FROM vineyard_parcels
WHERE id IN (SELECT DISTINCT original_id FROM mp_staging);

COMMIT;

-- Each sub-polygon gets its own row with all metadata copied from the parent.
-- Blocks linked to the original parcel are re-linked to the largest sub-polygon.
-- Topo stats for the originals are deleted (need recompute on new parcel IDs).
--
-- Uses a RETURNING-based mapping table so block re-links are ID-exact.

BEGIN;

-- 1. Staging table: one row per sub-polygon, with rank + original parent id
CREATE TEMP TABLE mp_staging AS
SELECT
  vp.id                                                      AS original_id,
  vp.vineyard_name, vp.vineyard_org, vp.owner_name,
  vp.ava_name, vp.nested_ava, vp.nested_nested_ava,
  vp.situs_address, vp.situs_city, vp.situs_zip,
  vp.varietals_list, vp.source_dataset, vp.winery_id,
  ST_SetSRID((ST_Dump(vp.geometry)).geom, 4326)              AS geometry,
  ROUND((ST_Area(
    ST_SetSRID((ST_Dump(vp.geometry)).geom, 4326)::geography
  ) / 4047.0)::numeric, 3)                                   AS acres,
  row_number() OVER (
    PARTITION BY vp.id
    ORDER BY ST_Area((ST_Dump(vp.geometry)).geom) DESC
  )                                                          AS area_rank
FROM vineyard_parcels vp
WHERE ST_GeometryType(vp.geometry) = 'ST_MultiPolygon';

-- 2. Insert new single-polygon rows, capture new IDs via RETURNING
CREATE TEMP TABLE mp_id_map (new_id int, original_id int, area_rank int);

WITH inserted AS (
  INSERT INTO vineyard_parcels (
    vineyard_name, vineyard_org, owner_name,
    ava_name, nested_ava, nested_nested_ava,
    situs_address, situs_city, situs_zip,
    varietals_list, source_dataset, winery_id,
    geometry, acres
  )
  SELECT
    vineyard_name, vineyard_org, owner_name,
    ava_name, nested_ava, nested_nested_ava,
    situs_address, situs_city, situs_zip,
    varietals_list, source_dataset, winery_id,
    geometry, acres
  FROM mp_staging
  RETURNING id, ctid
),
staging_ordered AS (
  -- Pair inserted rows back to staging rows in insertion order
  SELECT id, row_number() OVER (ORDER BY ctid) AS rn FROM inserted
),
staging_src AS (
  SELECT original_id, area_rank, row_number() OVER (ORDER BY original_id, area_rank) AS rn
  FROM mp_staging
)
INSERT INTO mp_id_map (new_id, original_id, area_rank)
SELECT so.id, ss.original_id, ss.area_rank
FROM staging_ordered so
JOIN staging_src ss ON ss.rn = so.rn;

-- 3. Re-link vineyard_blocks to the largest sub-polygon (area_rank = 1)
UPDATE vineyard_blocks vb
SET vineyard_parcel_id = m.new_id
FROM mp_id_map m
WHERE m.original_id = vb.vineyard_parcel_id
  AND m.area_rank = 1;

-- 4. Delete stale topo stats for original MultiPolygon rows
DELETE FROM vineyard_parcel_topo_stats
WHERE parcel_id IN (SELECT DISTINCT original_id FROM mp_staging);

-- 5. Delete the original MultiPolygon rows
DELETE FROM vineyard_parcels
WHERE id IN (SELECT DISTINCT original_id FROM mp_staging);

COMMIT;

-- Each sub-polygon gets its own row with all metadata copied from the parent.
-- Blocks linked to the original parcel are re-linked to the largest sub-polygon
-- (best proxy for the "primary" parcel until data is manually curated).
-- Topo stats for the original are deleted (will need to be recomputed).
--
-- Safe to re-run: only affects rows where ST_GeometryType = 'ST_MultiPolygon'.

BEGIN;

-- 1. Create new rows for every sub-polygon, recording the original parent id.
--    We use a temp table so we can update FKs before deleting originals.
CREATE TEMP TABLE exploded_parcels AS
SELECT
  -- All original columns
  vp.vineyard_name,
  vp.vineyard_org,
  vp.owner_name,
  vp.ava_name,
  vp.nested_ava,
  vp.nested_nested_ava,
  vp.situs_address,
  vp.situs_city,
  vp.situs_zip,
  vp.varietals_list,
  vp.source_dataset,
  vp.winery_id,
  -- Sub-polygon geometry
  (ST_Dump(vp.geometry)).geom AS geometry,
  -- Rank by area so we can identify the largest sub-polygon
  row_number() OVER (
    PARTITION BY vp.id
    ORDER BY ST_Area((ST_Dump(vp.geometry)).geom) DESC
  ) AS area_rank,
  -- Computed acreage for each sub-polygon
  ROUND((ST_Area((ST_Dump(vp.geometry)).geom::geography) / 4047.0)::numeric, 3) AS acres,
  -- Original parent id so we can re-link blocks
  vp.id AS original_id
FROM vineyard_parcels vp
WHERE ST_GeometryType(vp.geometry) = 'ST_MultiPolygon';

-- 2. Insert the new single-polygon rows
INSERT INTO vineyard_parcels (
  vineyard_name, vineyard_org, owner_name,
  ava_name, nested_ava, nested_nested_ava,
  situs_address, situs_city, situs_zip,
  varietals_list, source_dataset, winery_id,
  geometry, acres
)
SELECT
  vineyard_name, vineyard_org, owner_name,
  ava_name, nested_ava, nested_nested_ava,
  situs_address, situs_city, situs_zip,
  varietals_list, source_dataset, winery_id,
  ST_SetSRID(geometry, 4326),
  acres
FROM exploded_parcels;

-- 3. Re-link vineyard_blocks from original MultiPolygon parcel
--    → to the newly inserted largest sub-polygon (area_rank = 1)
UPDATE vineyard_blocks vb
SET vineyard_parcel_id = new_parcels.new_id
FROM (
  -- Map: original_id → new id of the largest sub-polygon
  SELECT ep.original_id, vp.id AS new_id
  FROM exploded_parcels ep
  JOIN vineyard_parcels vp ON (
    vp.source_dataset = ep.source_dataset
    AND (vp.winery_id = ep.winery_id OR (vp.winery_id IS NULL AND ep.winery_id IS NULL))
    AND ST_Equals(vp.geometry, ST_SetSRID(ep.geometry, 4326))
  )
  WHERE ep.area_rank = 1
) new_parcels
WHERE vb.vineyard_parcel_id = new_parcels.original_id;

-- 4. Re-link winery_accounts claims (if any portal claims reference the old parcel)
--    No direct FK in winery_accounts — nothing to do here.

-- 5. Delete topo stats for originals (stale — covers the full multi-polygon area)
DELETE FROM vineyard_parcel_topo_stats
WHERE parcel_id IN (
  SELECT DISTINCT original_id FROM exploded_parcels
);

-- 6. Delete the original MultiPolygon rows
DELETE FROM vineyard_parcels
WHERE id IN (
  SELECT DISTINCT original_id FROM exploded_parcels
);

COMMIT;
