-- Migration 002: Per-vineyard-parcel topography statistics
-- Populated by data-pipeline/scripts/compute-parcel-topo-stats.py
-- Source: USGS 3DEP 1m LiDAR DEM (willamette_valley_1m COGs)

CREATE TABLE IF NOT EXISTS vineyard_parcel_topo_stats (
    id                  SERIAL PRIMARY KEY,
    parcel_id           INTEGER NOT NULL REFERENCES vineyard_parcels(id) ON DELETE CASCADE,
    elevation_min_ft    NUMERIC(10, 2),
    elevation_max_ft    NUMERIC(10, 2),
    elevation_mean_ft   NUMERIC(10, 2),
    elevation_std_ft    NUMERIC(10, 2),
    slope_mean_deg      NUMERIC(8, 4),
    slope_max_deg       NUMERIC(8, 4),
    slope_p10_deg       NUMERIC(8, 4),
    slope_p90_deg       NUMERIC(8, 4),
    aspect_dominant_deg NUMERIC(8, 2),   -- most common 22.5° bin centroid (0–360)
    aspect_mean_deg     NUMERIC(8, 2),
    pixel_count         INTEGER,         -- valid (non-nodata) pixels used for stats
    data_source         VARCHAR(100) DEFAULT '3DEP 1m',
    computed_at         TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_vp_topo_stats_parcel UNIQUE (parcel_id)
);

CREATE INDEX IF NOT EXISTS idx_vptopostats_parcel
    ON vineyard_parcel_topo_stats(parcel_id);
