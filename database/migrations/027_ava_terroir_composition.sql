-- Migration 027: Soil + bedrock make-up per AVA
--
-- Share of each AVA's land in each soil and bedrock class, from the same
-- statewide sources and class rules as the per-vineyard tables (migrations
-- 022/023): USDA SSURGO soils and DOGAMI OGDC-8 bedrock, classed by
-- data-pipeline/scripts/terroir_classes.py so the numbers match the map legend.
--
--   layer = 'soil'         soil_class (what the soil formed from)   — every class
--           'soil_series'  SSURGO dominant component (Jory, Nekia…) — top 12
--           'bedrock'      bedrock terroir_class                    — every class
--           'formation'    OGDC-8 thematic formation                — top 12
--   pct   = share of the AVA's mapped Oregon land (0–100). AVAs that cross the
--           state line are summarised over their Oregon part (the sources are
--           Oregon-only); `acres` is that Oregon acreage.
--   rank  = 1 for the largest share within (ava, layer).
--
-- Written by data-pipeline/scripts/compute-ava-terroir.py; replaces any
-- existing rows for the AVAs it computes. The older ava_soil_stats table (a
-- single texture/pH summary, never populated) is left alone.
--
-- Additive and reversible:  DROP TABLE ava_terroir_composition;
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS ava_terroir_composition (
  ava_id       INTEGER      NOT NULL REFERENCES avas(id) ON DELETE CASCADE,
  layer        VARCHAR(16)  NOT NULL CHECK (layer IN ('soil', 'soil_series', 'bedrock', 'formation')),
  class        VARCHAR(160) NOT NULL,
  acres        NUMERIC(12, 1) NOT NULL,
  pct          NUMERIC(5, 2)  NOT NULL,
  rank         SMALLINT     NOT NULL,
  data_source  VARCHAR(40),
  computed_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ava_id, layer, class)
);

COMMIT;
