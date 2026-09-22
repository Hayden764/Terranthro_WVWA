-- Migration 024: Monthly PRISM climate per AVA and per vineyard, 1991 onward
--
-- One row per (entity, year, month), straight from the PRISM 800m monthly
-- time series (data-pipeline/scripts/download-prism-monthly.py →
-- compute-climate-monthly.py). Values stay in PRISM's native units
-- (°C, mm); the API converts to °F / inches and derives everything else —
-- season summaries, growing degree days (Winkler, Apr–Oct), and the two
-- baselines (1991–2020 normal, 2016–2025 recent) — from these rows, so a
-- baseline always comes from the same dataset as the vintage it is compared to.
--
--   entity_type  'ava'      → entity_key = AVA slug (e.g. 'dundee-hills',
--                              'willamette-valley'); zonal mean over the AVA
--                'vineyard' → entity_key = vineyards.id; value at the pixel
--                              under the vineyard's interior point
--
-- Additive and reversible:  DROP TABLE climate_monthly;
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS climate_monthly (
    entity_type  VARCHAR(10) NOT NULL CHECK (entity_type IN ('ava', 'vineyard')),
    entity_key   VARCHAR(60) NOT NULL,
    year         SMALLINT    NOT NULL,
    month        SMALLINT    NOT NULL CHECK (month BETWEEN 1 AND 12),
    tmean_c      REAL,
    tmin_c       REAL,
    tmax_c       REAL,
    ppt_mm       REAL,
    data_source  VARCHAR(40) NOT NULL DEFAULT 'PRISM 800m monthly',
    computed_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (entity_type, entity_key, year, month)
);
