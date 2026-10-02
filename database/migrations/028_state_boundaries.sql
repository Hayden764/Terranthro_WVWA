-- Migration 028: State boundaries + each AVA's portion per state
--
-- The explorers are scoped to a state (OWB = Oregon), but four Oregon AVAs
-- cross a state line: Columbia Valley, Walla Walla Valley and Columbia Gorge
-- (into WA) and Snake River Valley (into ID). Stats and maps should cover
-- only the Oregon side.
--
--   states.geometry   legal boundary (Census TIGER/Line: river centrelines,
--                     3 nmi of territorial sea) — used for clipping
--   states.outline    shoreline-clipped cartographic boundary (Census 1:500k)
--                     — used for drawing the state on maps
--   ava_states.geometry / acres
--                     the part of the AVA inside that state. avas.geometry
--                     stays the full TTB boundary.
--
-- Filled by data-pipeline/scripts/load-state-boundaries.py, which calls
-- refresh_ava_state_portions(); server/scripts/load-avas.mjs calls it again
-- whenever AVA boundaries are reloaded.
--
-- Additive and reversible:
--   DROP FUNCTION refresh_ava_state_portions();
--   ALTER TABLE ava_states DROP COLUMN geometry, DROP COLUMN acres;
--   ALTER TABLE states DROP COLUMN outline, DROP COLUMN boundary_source;
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE states
  ADD COLUMN IF NOT EXISTS outline         geometry(MultiPolygon, 4326),
  ADD COLUMN IF NOT EXISTS boundary_source VARCHAR(80);

ALTER TABLE ava_states
  ADD COLUMN IF NOT EXISTS geometry geometry(MultiPolygon, 4326),
  ADD COLUMN IF NOT EXISTS acres    NUMERIC(12, 1);

CREATE INDEX IF NOT EXISTS idx_ava_states_geometry ON ava_states USING gist (geometry);

-- Recompute every AVA's per-state portion from avas.geometry ∩ states.geometry.
-- Returns the number of rows updated. States without a boundary are skipped.
CREATE OR REPLACE FUNCTION refresh_ava_state_portions() RETURNS integer
LANGUAGE sql AS $$
  WITH portions AS (
    SELECT av.ava_id, av.state_id,
           ST_Multi(ST_CollectionExtract(
             ST_MakeValid(ST_Intersection(ST_MakeValid(a.geometry), s.geometry)), 3)) AS geom
    FROM ava_states av
    JOIN avas a   ON a.id = av.ava_id
    JOIN states s ON s.id = av.state_id
    WHERE s.geometry IS NOT NULL AND a.geometry IS NOT NULL
  ), upd AS (
    UPDATE ava_states av
       SET geometry = p.geom,
           acres    = round((ST_Area(p.geom::geography) / 4046.8564224)::numeric, 1)
      FROM portions p
     WHERE av.ava_id = p.ava_id AND av.state_id = p.state_id
    RETURNING 1
  )
  SELECT count(*)::int FROM upd;
$$;

COMMIT;
