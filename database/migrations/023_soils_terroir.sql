-- Migration 023: SSURGO soils per vineyard block / vineyard + paired soil-over-bedrock views
--
-- Source: USDA NRCS SSURGO (Web Soil Survey map units + Soil Data Access
-- attributes), built by data-pipeline/scripts/download-ssurgo.py and computed by
-- data-pipeline/scripts/compute-soil-geology-stats.py. As with geology (022),
-- only the per-geometry result is stored, not the SSURGO polygons.
--
--   series / texture / parent_material / drainage / tax_*  from the dominant
--       (highest comppct) component of the map unit covering the most area
--   soil_class  grower-facing origin from parent material — 'Volcanic' |
--       'Sedimentary' | 'Loess' | 'Missoula Flood' | 'Alluvial' | 'Volcaniclastic' |
--       'Mixed volcanic & sedimentary' | 'Granitic' | 'Metamorphic' | 'Ultramafic' |
--       'Organic' (data-pipeline/scripts/terroir_classes.py)
--   units  every map unit covering >= 1% of the footprint, largest first
--
-- vineyard_block_terroir / vineyard_terroir pair soil with bedrock:
--   terroir_label   'Jory silty clay loam over Grande Ronde Basalt'
--   terroir_origin  soil class, with generic 'Sedimentary' sharpened to
--                   'Marine sedimentary' when the bedrock is marine (Willakenzie)
--
-- Additive and reversible:
--   DROP VIEW vineyard_block_terroir; DROP VIEW vineyard_terroir;
--   DROP TABLE vineyard_block_soils; DROP TABLE vineyard_soils;
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vineyard_block_soils (
    block_id            INTEGER PRIMARY KEY REFERENCES vineyard_blocks(id) ON DELETE CASCADE,
    mukey               VARCHAR(30),
    map_unit_name       VARCHAR(254),
    series              VARCHAR(100),
    component_pct       NUMERIC(5, 1),
    texture             VARCHAR(100),
    parent_material     VARCHAR(254),
    drainage            VARCHAR(60),
    tax_order           VARCHAR(40),
    tax_class           VARCHAR(254),
    bedrock_depth_cm    NUMERIC(6, 1),
    available_water_cm  NUMERIC(6, 2),
    soil_class          VARCHAR(40),
    dominant_pct        NUMERIC(5, 2),
    units               JSONB NOT NULL DEFAULT '[]'::jsonb,
    data_source         VARCHAR(50) NOT NULL DEFAULT 'USDA SSURGO',
    computed_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vineyard_soils (
    vineyard_id         INTEGER PRIMARY KEY REFERENCES vineyards(id) ON DELETE CASCADE,
    mukey               VARCHAR(30),
    map_unit_name       VARCHAR(254),
    series              VARCHAR(100),
    component_pct       NUMERIC(5, 1),
    texture             VARCHAR(100),
    parent_material     VARCHAR(254),
    drainage            VARCHAR(60),
    tax_order           VARCHAR(40),
    tax_class           VARCHAR(254),
    bedrock_depth_cm    NUMERIC(6, 1),
    available_water_cm  NUMERIC(6, 2),
    soil_class          VARCHAR(40),
    dominant_pct        NUMERIC(5, 2),
    units               JSONB NOT NULL DEFAULT '[]'::jsonb,
    data_source         VARCHAR(50) NOT NULL DEFAULT 'USDA SSURGO',
    computed_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_block_soils_class    ON vineyard_block_soils(soil_class);
CREATE INDEX IF NOT EXISTS idx_block_soils_series   ON vineyard_block_soils(series);
CREATE INDEX IF NOT EXISTS idx_vineyard_soils_class ON vineyard_soils(soil_class);
CREATE INDEX IF NOT EXISTS idx_vineyard_soils_series ON vineyard_soils(series);

CREATE OR REPLACE VIEW vineyard_block_terroir AS
SELECT
    b.id AS block_id,
    s.series            AS soil_series,
    s.texture           AS soil_texture,
    s.parent_material   AS soil_parent_material,
    s.drainage          AS soil_drainage,
    s.soil_class,
    s.dominant_pct      AS soil_pct,
    g.map_unit_name     AS bedrock_name,
    g.formation         AS bedrock_formation,
    g.age               AS bedrock_age,
    g.terroir_class     AS bedrock_class,
    g.dominant_pct      AS bedrock_pct,
    CASE WHEN s.soil_class = 'Sedimentary' AND g.terroir_class = 'Marine sedimentary'
         THEN 'Marine sedimentary'
         ELSE COALESCE(s.soil_class, g.terroir_class) END AS terroir_origin,
    NULLIF(concat_ws(' over ',
        NULLIF(trim(concat_ws(' ', s.series, lower(s.texture))), ''),
        COALESCE(g.formation, g.map_unit_name)), '') AS terroir_label
FROM vineyard_blocks b
LEFT JOIN vineyard_block_soils   s ON s.block_id = b.id
LEFT JOIN vineyard_block_geology g ON g.block_id = b.id
WHERE s.block_id IS NOT NULL OR g.block_id IS NOT NULL;

CREATE OR REPLACE VIEW vineyard_terroir AS
SELECT
    v.id AS vineyard_id,
    s.series            AS soil_series,
    s.texture           AS soil_texture,
    s.parent_material   AS soil_parent_material,
    s.drainage          AS soil_drainage,
    s.soil_class,
    s.dominant_pct      AS soil_pct,
    g.map_unit_name     AS bedrock_name,
    g.formation         AS bedrock_formation,
    g.age               AS bedrock_age,
    g.terroir_class     AS bedrock_class,
    g.dominant_pct      AS bedrock_pct,
    CASE WHEN s.soil_class = 'Sedimentary' AND g.terroir_class = 'Marine sedimentary'
         THEN 'Marine sedimentary'
         ELSE COALESCE(s.soil_class, g.terroir_class) END AS terroir_origin,
    NULLIF(concat_ws(' over ',
        NULLIF(trim(concat_ws(' ', s.series, lower(s.texture))), ''),
        COALESCE(g.formation, g.map_unit_name)), '') AS terroir_label
FROM vineyards v
LEFT JOIN vineyard_soils   s ON s.vineyard_id = v.id
LEFT JOIN vineyard_geology g ON g.vineyard_id = v.id
WHERE s.vineyard_id IS NOT NULL OR g.vineyard_id IS NOT NULL;
