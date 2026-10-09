-- Migration 029: Terrain distribution per AVA
--
-- How each AVA's Oregon land (ava_states.geometry, migration 028) spreads
-- across elevation, slope and aspect, from DOGAMI 3 m lidar. Fine bins, so the
-- explorers can roll them up into whatever classes their map legend uses:
--
--   layer = 'elevation'  bin_lo..bin_hi in feet, 100 ft bins
--           'slope'      degrees, 1° bins (the last bin is open-ended: 45°+)
--           'aspect'     degrees clockwise from north, 8 compass sectors
--                        centred on N/NE/…/NW (N = -22.5..22.5); flat land
--                        (slope < 3°) is its own row with bin_lo = bin_hi = -1
--   pct   = share of the AVA's mapped Oregon land (0–100)
--
-- ava_topo_stats (one summary row per AVA; created earlier, never filled) gets
-- the matching min/max/mean elevation, mean/max slope and dominant aspect.
--
-- Written by data-pipeline/scripts/compute-ava-terrain.py, which replaces the
-- rows for each AVA it computes.
--
-- Additive and reversible:  DROP TABLE ava_terrain_distribution;
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS ava_terrain_distribution (
  ava_id       INTEGER      NOT NULL REFERENCES avas(id) ON DELETE CASCADE,
  layer        VARCHAR(16)  NOT NULL CHECK (layer IN ('elevation', 'slope', 'aspect')),
  bin_lo       NUMERIC(8, 2) NOT NULL,
  bin_hi       NUMERIC(8, 2) NOT NULL,
  acres        NUMERIC(12, 1) NOT NULL,
  pct          NUMERIC(5, 2)  NOT NULL,
  data_source  VARCHAR(40),
  computed_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ava_id, layer, bin_lo)
);

COMMIT;
