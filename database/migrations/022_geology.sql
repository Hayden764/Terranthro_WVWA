-- Migration 022: Bedrock geology per vineyard block and per vineyard
--
-- Source: DOGAMI Oregon Geologic Data Compilation, release 8 (OGDC-8),
-- MapUnitPolys layer. Computed offline by
-- data-pipeline/scripts/compute-soil-geology-stats.py (area-weighted overlay of the
-- block / vineyard footprint against OGDC map units) — the OGDC polygons are
-- NOT stored in the DB, only the per-geometry result.
--
--   dominant_*    the map unit covering the largest share of the footprint
--   terroir_class grower-facing bucket derived from rock type + formation:
--                 'Volcanic' | 'Volcaniclastic' | 'Marine sedimentary' |
--                 'Sedimentary' | 'Missoula Flood' | 'Alluvial' | 'Loess' |
--                 'Landslide & colluvium' | 'Glacial' | 'Metamorphic' | 'Granitic' |
--                 'Ultramafic'
--                 (mapping lives in data-pipeline/scripts/terroir_classes.py)
--   units         every unit covering >= 1% of the footprint, largest first:
--                 [{map_unit, name, formation, member, rock_type, lithology,
--                   age, terroir_class, pct}]
--
-- Additive and reversible:
--   DROP TABLE vineyard_block_geology; DROP TABLE vineyard_geology;
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vineyard_block_geology (
    block_id        INTEGER PRIMARY KEY REFERENCES vineyard_blocks(id) ON DELETE CASCADE,
    map_unit        VARCHAR(100),
    map_unit_name   VARCHAR(254),
    formation       VARCHAR(200),
    member          VARCHAR(200),
    rock_type       VARCHAR(50),
    lithology       VARCHAR(50),
    age             VARCHAR(50),
    terroir_class   VARCHAR(40),
    dominant_pct    NUMERIC(5, 2),
    units           JSONB NOT NULL DEFAULT '[]'::jsonb,
    data_source     VARCHAR(50) NOT NULL DEFAULT 'DOGAMI OGDC-8',
    computed_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vineyard_geology (
    vineyard_id     INTEGER PRIMARY KEY REFERENCES vineyards(id) ON DELETE CASCADE,
    map_unit        VARCHAR(100),
    map_unit_name   VARCHAR(254),
    formation       VARCHAR(200),
    member          VARCHAR(200),
    rock_type       VARCHAR(50),
    lithology       VARCHAR(50),
    age             VARCHAR(50),
    terroir_class   VARCHAR(40),
    dominant_pct    NUMERIC(5, 2),
    units           JSONB NOT NULL DEFAULT '[]'::jsonb,
    data_source     VARCHAR(50) NOT NULL DEFAULT 'DOGAMI OGDC-8',
    computed_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_block_geology_class    ON vineyard_block_geology(terroir_class);
CREATE INDEX IF NOT EXISTS idx_vineyard_geology_class ON vineyard_geology(terroir_class);
