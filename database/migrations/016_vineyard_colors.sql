-- Migration 016: Per-vineyard identity color assignments
-- Populated by data-pipeline/scripts/assign-vineyard-colors.py
--
-- Each named vineyard (grouped by normalized vineyard_name) gets a palette
-- slot (color_index) via geographic graph-coloring: no two spatially adjacent
-- vineyards share a slot. The palette hex values live in the frontend paint
-- expression (WVWAMap.jsx); this table stores only the slot index so colors
-- can be recomputed without touching parcel rows.
--
-- Parcels with no vineyard_name have no row here → the join COALESCEs to -1,
-- which the map renders white ("unnamed — help us name it").

CREATE TABLE IF NOT EXISTS vineyard_colors (
    vineyard_key    TEXT PRIMARY KEY,   -- normalized vineyard_name: lower(trim(vineyard_name))
    color_index     SMALLINT NOT NULL,  -- palette slot, 0..(palette_size-1)
    neighbor_count  INTEGER,            -- adjacency degree (diagnostics)
    palette_size    SMALLINT,           -- palette size used for this assignment run
    computed_at     TIMESTAMP DEFAULT NOW()
);
