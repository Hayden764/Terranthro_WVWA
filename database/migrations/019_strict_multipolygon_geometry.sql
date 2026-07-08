-- ─────────────────────────────────────────────────────────────────────────────
-- 019: Constrain vineyards/vineyard_blocks geometry to strict MultiPolygon
--
-- Both columns were declared as untyped GEOMETRY(Geometry, 4326) and, in
-- practice, contained a mix of Polygon and MultiPolygon rows (an artifact of
-- the pre-018 source data). When a PostGIS column isn't constrained to one
-- type, QGIS's provider reports the generalized OGC type covering the mix —
-- which for Polygon+MultiPolygon is "MultiSurface". QGIS then treats the
-- LAYER itself as MultiSurface-typed, so even a straight-line edit gets
-- written back as MultiSurface WKB, which trg_block_acres then rejects
-- ("Geography type does not support MultiSurface") on save.
--
-- Fix: normalize every row to MultiPolygon and constrain the column type, so
-- QGIS (and everything else) sees a clean, single-typed MultiPolygon layer —
-- matching avas/states, which never had this problem.
--
-- Applied directly against production 2026-07-08 (this file documents that
-- change for schema.sql/history parity — see git history for the exact
-- script that ran it).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Triggers reference the geometry column, so they must be dropped before
-- ALTER COLUMN ... TYPE and recreated after.
DROP TRIGGER trg_block_acres ON vineyard_blocks;
DROP TRIGGER trg_vineyard_footprint ON vineyard_blocks;

-- ST_CollectionExtract(...,3) drops any stray non-polygonal fragments that
-- ST_MakeValid can introduce when fixing an invalid input ring; ST_Multi
-- forces the result to MultiPolygon.
ALTER TABLE vineyards
  ALTER COLUMN geometry TYPE geometry(MultiPolygon, 4326)
  USING ST_Multi(ST_CollectionExtract(ST_MakeValid(geometry), 3));

ALTER TABLE vineyard_blocks
  ALTER COLUMN geometry TYPE geometry(MultiPolygon, 4326)
  USING CASE WHEN geometry IS NULL THEN NULL
             ELSE ST_Multi(ST_CollectionExtract(ST_MakeValid(geometry), 3)) END;

CREATE TRIGGER trg_block_acres
  BEFORE INSERT OR UPDATE OF geometry
  ON vineyard_blocks
  FOR EACH ROW
  EXECUTE FUNCTION compute_block_acres();

CREATE TRIGGER trg_vineyard_footprint
  AFTER INSERT OR DELETE OR UPDATE OF geometry, vineyard_id
  ON vineyard_blocks
  FOR EACH ROW
  EXECUTE FUNCTION refresh_vineyard_footprint();

DO $$
DECLARE bad INT;
BEGIN
  SELECT count(*) INTO bad FROM vineyards WHERE ST_GeometryType(geometry) <> 'ST_MultiPolygon';
  IF bad > 0 THEN RAISE EXCEPTION 'vineyards: % rows not MultiPolygon', bad; END IF;

  SELECT count(*) INTO bad FROM vineyard_blocks
   WHERE geometry IS NOT NULL AND ST_GeometryType(geometry) <> 'ST_MultiPolygon';
  IF bad > 0 THEN RAISE EXCEPTION 'vineyard_blocks: % rows not MultiPolygon', bad; END IF;

  SELECT count(*) INTO bad FROM vineyards WHERE ST_IsEmpty(geometry);
  IF bad > 0 THEN RAISE EXCEPTION 'vineyards: % rows became empty geometry', bad; END IF;
END $$;

COMMIT;
