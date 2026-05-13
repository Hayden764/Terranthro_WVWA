-- ─────────────────────────────────────────────
-- 010: Block buyers, bulk-import support, winery aliases
--
-- Adds:
--   • vineyard_blocks.fruit_sold_to  — raw pipe-delimited string from CSV
--                                      preserved alongside the normalized
--                                      vineyard_block_buyers child rows.
--   • wineries.aliases TEXT[]        — alternate spellings used to match
--                                      buyer names from imported CSVs.
--   • vineyard_block_buyers          — many-to-many between blocks and the
--                                      wineries that purchase fruit from
--                                      them. buyer_winery_id is NULL when
--                                      the CSV string did not resolve.
-- ─────────────────────────────────────────────

ALTER TABLE vineyard_blocks
  ADD COLUMN IF NOT EXISTS fruit_sold_to TEXT;

-- Drop the now-unused hill column if a previous run of this migration created it.
ALTER TABLE vineyard_blocks
  DROP COLUMN IF EXISTS hill;

ALTER TABLE wineries
  ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS vineyard_block_buyers (
  id              SERIAL PRIMARY KEY,
  block_id        INTEGER NOT NULL REFERENCES vineyard_blocks(id) ON DELETE CASCADE,
  buyer_winery_id INTEGER REFERENCES wineries(id) ON DELETE SET NULL,
  buyer_name_raw  TEXT NOT NULL,
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE (block_id, buyer_name_raw)
);

CREATE INDEX IF NOT EXISTS idx_vbb_block_id        ON vineyard_block_buyers(block_id);
CREATE INDEX IF NOT EXISTS idx_vbb_buyer_winery_id ON vineyard_block_buyers(buyer_winery_id);
CREATE INDEX IF NOT EXISTS idx_wineries_aliases    ON wineries USING GIN (aliases);
