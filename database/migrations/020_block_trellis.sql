-- Migration 020: Add `trellis` to vineyard_blocks
--
-- Trellis / training system for a block (e.g. VSP, Scott Henry, Lyre, Geneva
-- Double Curtain). Free text, nullable. Editable via the portal block editor and
-- the admin block editor — added to the block-edit whitelists in the same change.
--
-- Additive and reversible:  ALTER TABLE vineyard_blocks DROP COLUMN trellis;
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE vineyard_blocks
    ADD COLUMN IF NOT EXISTS trellis VARCHAR(100);
