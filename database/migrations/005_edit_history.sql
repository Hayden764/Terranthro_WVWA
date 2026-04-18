-- Migration 005: Edit History — entity columns on winery_edit_log
--
-- Adds explicit entity_type / entity_id columns so we can query
-- "all changes ever made to vineyard_parcel #342" in O(1) without
-- joining or parsing table_name + record_id.
--
-- Also backfills existing rows so no history is lost.

-- ─────────────────────────────────────────────
-- Add columns
-- ─────────────────────────────────────────────
ALTER TABLE winery_edit_log
  ADD COLUMN IF NOT EXISTS entity_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS entity_id   INTEGER;

-- ─────────────────────────────────────────────
-- Backfill from existing table_name / record_id values
-- ─────────────────────────────────────────────
UPDATE winery_edit_log
SET
  entity_type = CASE table_name
    WHEN 'wineries'          THEN 'winery'
    WHEN 'vineyard_parcels'  THEN 'vineyard_parcel'
    WHEN 'vineyard_blocks'   THEN 'vineyard_block'
    ELSE table_name
  END,
  entity_id = record_id
WHERE entity_type IS NULL;

-- ─────────────────────────────────────────────
-- Index for fast per-entity lookups
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wel_entity
  ON winery_edit_log(entity_type, entity_id);
