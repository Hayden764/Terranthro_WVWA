-- Migration 032: The OWB dataset and its releases
--
-- The statewide contract (Exhibit A, "GIS Database") requires a full
-- attribute record on every block: acreage (and planted acreage where
-- distinguished), county and AVA(s), standing-or-removed status and imagery
-- year, size class, and the sub-2.0-acre flag — plus historical change
-- against 2020 and 2022 OSIP imagery. This migration adds what the live
-- tables were missing, and the release snapshots the OWB Portal's Data tab
-- reads from.
--
--   counties.fips / geometry          Census TIGER 2024 county boundaries
--                                     (load-county-boundaries.py)
--   vineyard_blocks.owb_dataset       block was delineated under the contract;
--                                     only these go into OWB releases
--                 .imagery_year       OSIP year the boundary was traced on
--                 .block_status       standing | removed
--                 .planted_acres      where distinguished from block acreage
--                 .name_source        how the delivered name was confirmed
--                 .verification       deepest validation tier reached
--   vineyard_block_observations       present / absent per OSIP year
--                                     (2020, 2022, 2024, 2026 …) → change
--   owb_size_class(acres)             size classes; the M1 method document
--                                     is the authority, edit to match it
--   ava_subdivided / county_subdivided
--                                     the AVA and county boundaries cut into
--                                     small pieces, so point-in-polygon
--                                     lookups take milliseconds instead of
--                                     seconds; refresh_lookup_geometry()
--                                     rebuilds them after boundaries reload
--
--   contract_releases                 a frozen, cumulative copy of the OWB
--   contract_release_blocks           dataset, tied to a delivered milestone.
--                                     The Data tab's stats and exports come
--                                     only from releases, never live tables,
--                                     so delivered figures never move.
--
-- Release snapshots copy contract-derived attributes only. Grower-entered
-- fields (variety, clone, rootstock, rows, spacing, vines, year planted,
-- fruit buyers, trellis, notes) are deliberately left out until growers
-- consent under the Grower Enrichment Portal terms of use.
--
-- Additive and reversible:
--   DROP TABLE contract_release_blocks, contract_releases, vineyard_block_observations,
--              ava_subdivided, county_subdivided;
--   DROP FUNCTION owb_size_class(numeric), refresh_lookup_geometry();
--   ALTER TABLE vineyard_blocks DROP COLUMN owb_dataset, DROP COLUMN imagery_year,
--     DROP COLUMN block_status, DROP COLUMN planted_acres, DROP COLUMN name_source,
--     DROP COLUMN verification;
--   ALTER TABLE counties DROP COLUMN fips, DROP COLUMN geometry;

BEGIN;

-- ── Counties ────────────────────────────────────────────────────────────────
ALTER TABLE counties
    ADD COLUMN fips      VARCHAR(5),
    ADD COLUMN geometry  geometry(MultiPolygon, 4326);
CREATE UNIQUE INDEX counties_fips_idx ON counties (fips) WHERE fips IS NOT NULL;
CREATE INDEX counties_geometry_idx ON counties USING GIST (geometry);

-- ── Fast boundary lookups ────────────────────────────────────────────────────
CREATE TABLE ava_subdivided (
    ava_id    INTEGER NOT NULL REFERENCES avas(id) ON DELETE CASCADE,
    geometry  geometry(Geometry, 4326) NOT NULL
);
CREATE INDEX ava_subdivided_geometry_idx ON ava_subdivided USING GIST (geometry);

CREATE TABLE county_subdivided (
    county_id INTEGER NOT NULL REFERENCES counties(id) ON DELETE CASCADE,
    geometry  geometry(Geometry, 4326) NOT NULL
);
CREATE INDEX county_subdivided_geometry_idx ON county_subdivided USING GIST (geometry);

CREATE FUNCTION refresh_lookup_geometry() RETURNS void
LANGUAGE sql AS $$
    TRUNCATE ava_subdivided;
    INSERT INTO ava_subdivided (ava_id, geometry)
    SELECT id, ST_Subdivide(geometry, 255) FROM avas
    WHERE removed IS NULL AND geometry IS NOT NULL;
    TRUNCATE county_subdivided;
    INSERT INTO county_subdivided (county_id, geometry)
    SELECT id, ST_Subdivide(geometry, 255) FROM counties
    WHERE geometry IS NOT NULL;
$$;

SELECT refresh_lookup_geometry();   -- AVAs now; counties fill once loaded

-- ── Contract attributes on blocks ───────────────────────────────────────────
ALTER TABLE vineyard_blocks
    ADD COLUMN owb_dataset    BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN imagery_year   SMALLINT,
    ADD COLUMN block_status   VARCHAR(10) NOT NULL DEFAULT 'standing'
                                CHECK (block_status IN ('standing', 'removed')),
    ADD COLUMN planted_acres  NUMERIC(10,3),
    ADD COLUMN name_source    VARCHAR(30)
                                CHECK (name_source IN ('parcel_records', 'vineyard_website',
                                                       'owb_records', 'field_verification')),
    ADD COLUMN verification   VARCHAR(20)
                                CHECK (verification IN ('imagery', 'street_level', 'field', 'needs_field'));
CREATE INDEX vineyard_blocks_owb_idx ON vineyard_blocks (id) WHERE owb_dataset;

CREATE TABLE vineyard_block_observations (
    block_id      INTEGER  NOT NULL REFERENCES vineyard_blocks(id) ON DELETE CASCADE,
    imagery_year  SMALLINT NOT NULL,
    present       BOOLEAN  NOT NULL,
    PRIMARY KEY (block_id, imagery_year)
);

CREATE FUNCTION owb_size_class(acres NUMERIC) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN acres IS NULL THEN NULL
        WHEN acres < 2   THEN 'Under 2 ac'
        WHEN acres < 5   THEN '2–5 ac'
        WHEN acres < 10  THEN '5–10 ac'
        WHEN acres < 25  THEN '10–25 ac'
        WHEN acres < 50  THEN '25–50 ac'
        ELSE '50+ ac'
    END
$$;

-- ── Releases ────────────────────────────────────────────────────────────────
CREATE TABLE contract_releases (
    id                   SERIAL PRIMARY KEY,
    contract_id          INTEGER      NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    milestone_id         INTEGER      REFERENCES contract_milestones(id) ON DELETE SET NULL,
    label                VARCHAR(200) NOT NULL,
    -- Blocks in these AVAs (or outside every AVA) are copied fresh from the
    -- live tables; everything else is carried forward from the previous release.
    scope_avas           TEXT[]       NOT NULL DEFAULT '{}',
    scope_outside_avas   BOOLEAN      NOT NULL DEFAULT FALSE,
    based_on_release_id  INTEGER      REFERENCES contract_releases(id) ON DELETE SET NULL,
    notes                TEXT,
    block_count          INTEGER,
    acres                NUMERIC(12,3),
    published_at         TIMESTAMPTZ,                         -- NULL = draft, admin only
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX contract_releases_contract_idx ON contract_releases (contract_id, created_at DESC);

CREATE TABLE contract_release_blocks (
    release_id           INTEGER      NOT NULL REFERENCES contract_releases(id) ON DELETE CASCADE,
    block_id             INTEGER      NOT NULL,               -- no FK: outlives the live block
    vineyard_id          INTEGER,
    vineyard_name        TEXT,                                -- the vineyard business
    block_name           TEXT,
    acres                NUMERIC(10,3),
    planted_acres        NUMERIC(10,3),
    county_name          TEXT,
    county_fips          VARCHAR(5),
    ava_slugs            TEXT[]       NOT NULL DEFAULT '{}',  -- every AVA the block falls in
    ava_names            TEXT[]       NOT NULL DEFAULT '{}',
    block_status         VARCHAR(10),
    imagery_year         SMALLINT,
    size_class           TEXT,
    under_2_acres        BOOLEAN,
    in_headline          BOOLEAN,      -- false only for isolated blocks under 2 ac
    name_source          VARCHAR(30),
    verification         VARCHAR(20),
    observations         JSONB        NOT NULL DEFAULT '{}',  -- {"2020": true, "2022": false, …}
    elevation_min_ft     NUMERIC,
    elevation_mean_ft    NUMERIC,
    elevation_max_ft     NUMERIC,
    slope_mean_deg       NUMERIC,
    aspect_dominant_deg  NUMERIC,
    soil_series          TEXT,
    soil_class           TEXT,
    soil_drainage        TEXT,
    available_water_cm   NUMERIC,
    soil_units           JSONB,        -- area-weighted SSURGO map unit composition
    geology_formation    TEXT,
    rock_type            TEXT,
    geometry             geometry(MultiPolygon, 4326),
    PRIMARY KEY (release_id, block_id)
);
CREATE INDEX contract_release_blocks_avas_idx ON contract_release_blocks USING GIN (ava_slugs);

COMMIT;
