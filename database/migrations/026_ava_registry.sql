-- Migration 026: AVA registry in the database
--
-- The avas / states / counties / ava_states / ava_counties / ava_hierarchy
-- tables have existed since the original schema but were never filled in prod;
-- AVA boundaries lived only as static public/data/*.geojson files inside the
-- WVWA frontend. With the API serving several frontends (WVWA, OWB statewide),
-- the database becomes the single source of AVA boundaries and hierarchy.
--
-- This migration is schema only. The data is loaded (and refreshed) by
-- server/scripts/load-avas.mjs from TTB's AVA Map Explorer polygons
-- (data-pipeline/scripts/fetch-ttb-avas.py → data-pipeline/data/ava/).
--
--   avas.status              'established' | 'pending' (TTB proposals).
--   avas.cfr_section         e.g. '27 CFR 9.180'.
--   avas.boundary_source     Provenance of the polygon.
--   avas.boundary_retrieved  When the polygon was fetched from the source.
--   avas.updated_at          Last load/refresh.
--
-- ava_hierarchy holds DIRECT parent → child links only (Laurelwood District's
-- parent is Chehalem Mountains, not also Willamette Valley); walk it
-- recursively for ancestors/descendants.
--
-- avas.centroid is filled with ST_PointOnSurface, not ST_Centroid, so the
-- label/anchor point is always inside the AVA (crescent-shaped AVAs).
--
-- Additive and reversible:
--   ALTER TABLE avas DROP COLUMN status, DROP COLUMN cfr_section,
--     DROP COLUMN boundary_source, DROP COLUMN boundary_retrieved, DROP COLUMN updated_at;
--
-- The loader's upsert keys (states.abbreviation, counties (name, state_id)) and
-- the ava_hierarchy child index already exist from the original schema.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE avas
  ADD COLUMN IF NOT EXISTS status             VARCHAR(20) NOT NULL DEFAULT 'established'
                                              CHECK (status IN ('established', 'pending')),
  ADD COLUMN IF NOT EXISTS cfr_section        VARCHAR(40),
  ADD COLUMN IF NOT EXISTS boundary_source    TEXT,
  ADD COLUMN IF NOT EXISTS boundary_retrieved DATE,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMP NOT NULL DEFAULT NOW();

COMMIT;
