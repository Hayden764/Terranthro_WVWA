-- Migration 012: Per-vineyard-block topography statistics + aspect_bucket
--
-- 1. Creates vineyard_block_topo_stats (mirror of vineyard_parcel_topo_stats,
--    keyed on block_id). Populated by
--    data-pipeline/scripts/compute-block-topo-stats.py against
--    vineyard_blocks.geometry (added in migration 011).
--
-- 2. Adds an immutable, indexable `aspect_bucket` GENERATED column to BOTH
--    vineyard_parcel_topo_stats and vineyard_block_topo_stats. Buckets are
--    8-point compass directions, each 45° wide, centred on the cardinal
--    angle (N covers 337.5–360 ∪ 0–22.5). NULL when aspect_dominant_deg is
--    NULL or < 0 (flat).
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vineyard_block_topo_stats (
    id                  SERIAL PRIMARY KEY,
    block_id            INTEGER NOT NULL REFERENCES vineyard_blocks(id) ON DELETE CASCADE,
    elevation_min_ft    NUMERIC(10, 2),
    elevation_max_ft    NUMERIC(10, 2),
    elevation_mean_ft   NUMERIC(10, 2),
    elevation_std_ft    NUMERIC(10, 2),
    slope_mean_deg      NUMERIC(8, 4),
    slope_max_deg       NUMERIC(8, 4),
    slope_p10_deg       NUMERIC(8, 4),
    slope_p90_deg       NUMERIC(8, 4),
    aspect_dominant_deg NUMERIC(8, 2),
    aspect_mean_deg     NUMERIC(8, 2),
    pixel_count         INTEGER,
    data_source         VARCHAR(100) DEFAULT '3DEP 1m',
    computed_at         TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_vb_topo_stats_block UNIQUE (block_id)
);

CREATE INDEX IF NOT EXISTS idx_vbtopostats_block
    ON vineyard_block_topo_stats(block_id);

-- ── aspect_bucket generated column (8-point compass) ────────────────────────
-- N covers 337.5–22.5, NE 22.5–67.5, E 67.5–112.5, SE 112.5–157.5,
-- S 157.5–202.5, SW 202.5–247.5, W 247.5–292.5, NW 292.5–337.5.
-- aspect_dominant_deg < 0 means GDAL "flat" → NULL bucket.
ALTER TABLE vineyard_parcel_topo_stats
    ADD COLUMN IF NOT EXISTS aspect_bucket VARCHAR(2)
    GENERATED ALWAYS AS (
        CASE
            WHEN aspect_dominant_deg IS NULL OR aspect_dominant_deg < 0 THEN NULL
            WHEN aspect_dominant_deg >= 337.5 OR aspect_dominant_deg <  22.5 THEN 'N'
            WHEN aspect_dominant_deg <  67.5 THEN 'NE'
            WHEN aspect_dominant_deg < 112.5 THEN 'E'
            WHEN aspect_dominant_deg < 157.5 THEN 'SE'
            WHEN aspect_dominant_deg < 202.5 THEN 'S'
            WHEN aspect_dominant_deg < 247.5 THEN 'SW'
            WHEN aspect_dominant_deg < 292.5 THEN 'W'
            WHEN aspect_dominant_deg < 337.5 THEN 'NW'
            ELSE NULL
        END
    ) STORED;

ALTER TABLE vineyard_block_topo_stats
    ADD COLUMN IF NOT EXISTS aspect_bucket VARCHAR(2)
    GENERATED ALWAYS AS (
        CASE
            WHEN aspect_dominant_deg IS NULL OR aspect_dominant_deg < 0 THEN NULL
            WHEN aspect_dominant_deg >= 337.5 OR aspect_dominant_deg <  22.5 THEN 'N'
            WHEN aspect_dominant_deg <  67.5 THEN 'NE'
            WHEN aspect_dominant_deg < 112.5 THEN 'E'
            WHEN aspect_dominant_deg < 157.5 THEN 'SE'
            WHEN aspect_dominant_deg < 202.5 THEN 'S'
            WHEN aspect_dominant_deg < 247.5 THEN 'SW'
            WHEN aspect_dominant_deg < 292.5 THEN 'W'
            WHEN aspect_dominant_deg < 337.5 THEN 'NW'
            ELSE NULL
        END
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_vptopostats_aspect_bucket
    ON vineyard_parcel_topo_stats(aspect_bucket);
CREATE INDEX IF NOT EXISTS idx_vbtopostats_aspect_bucket
    ON vineyard_block_topo_stats(aspect_bucket);

-- ── Useful range indexes for filter queries ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_vptopostats_elev_mean
    ON vineyard_parcel_topo_stats(elevation_mean_ft);
CREATE INDEX IF NOT EXISTS idx_vptopostats_slope_mean
    ON vineyard_parcel_topo_stats(slope_mean_deg);
CREATE INDEX IF NOT EXISTS idx_vbtopostats_elev_mean
    ON vineyard_block_topo_stats(elevation_mean_ft);
CREATE INDEX IF NOT EXISTS idx_vbtopostats_slope_mean
    ON vineyard_block_topo_stats(slope_mean_deg);
