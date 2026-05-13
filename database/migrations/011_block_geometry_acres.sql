-- ─────────────────────────────────────────────
-- 011: Block-level geometry + PostGIS-derived acres
--
-- Adds:
--   • vineyard_blocks.geometry  — optional polygon for each block
--   • trg_block_acres trigger   — auto-computes vineyard_blocks.acres
--     from ST_Area(geometry::geography) / 4046.856422 whenever geometry
--     is inserted or updated. Manual acres values are preserved for rows
--     that have no geometry.
-- ─────────────────────────────────────────────

ALTER TABLE vineyard_blocks
  ADD COLUMN IF NOT EXISTS geometry GEOMETRY(Geometry, 4326);

CREATE INDEX IF NOT EXISTS idx_vb_geometry ON vineyard_blocks USING GIST(geometry);

-- ── Trigger function ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_block_acres()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.geometry IS NOT NULL THEN
    NEW.acres := ROUND(
      (ST_Area(NEW.geometry::geography) / 4046.856422)::numeric,
      3
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Trigger ──────────────────────────────────────────────────────────────────
-- Fires BEFORE INSERT or any UPDATE that touches the geometry column so that
-- the calculated acres value is always written in the same transaction.
DROP TRIGGER IF EXISTS trg_block_acres ON vineyard_blocks;
CREATE TRIGGER trg_block_acres
  BEFORE INSERT OR UPDATE OF geometry
  ON vineyard_blocks
  FOR EACH ROW
  EXECUTE FUNCTION compute_block_acres();

-- ── Backfill existing rows that already have geometry ────────────────────────
UPDATE vineyard_blocks
SET acres = ROUND(
  (ST_Area(geometry::geography) / 4046.856422)::numeric,
  3
)
WHERE geometry IS NOT NULL;
