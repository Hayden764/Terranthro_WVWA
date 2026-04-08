import express from 'express';
import { pool } from '../db/pool.js';

const router = express.Router();

/**
 * GET /api/avas/state/:stateAbbrev
 *
 * Returns a GeoJSON FeatureCollection of all AVAs for a given state.
 * Cross-state AVAs (e.g. Columbia Valley in OR+WA) appear in both states.
 *
 * Query params:
 *   ?geometry=false  — omit full geometry (faster list-only response)
 */
router.get('/state/:stateAbbrev', async (req, res) => {
  const abbrev = req.params.stateAbbrev.toUpperCase();
  const includeGeometry = req.query.geometry !== 'false';

  try {
    const { rows } = await pool.query(
      `
      SELECT
        a.id,
        a.slug,
        a.ava_id,
        a.name,
        a.aka,
        a.created,
        a.removed,
        a.cfr_index,
        a.valid_start,
        a.valid_end,
        ${includeGeometry ? 'ST_AsGeoJSON(a.geometry)::json AS geometry,' : ''}
        ST_AsGeoJSON(a.centroid)::json AS centroid,
        array_agg(DISTINCT s.abbreviation ORDER BY s.abbreviation) AS states,
        (
          SELECT string_agg(parent.name, '|' ORDER BY parent.name)
          FROM ava_hierarchy h
          JOIN avas parent ON h.parent_id = parent.id
          WHERE h.child_id = a.id
        ) AS within
      FROM avas a
      JOIN ava_states av ON a.id = av.ava_id
      JOIN states s ON av.state_id = s.id
      WHERE a.id IN (
        SELECT av2.ava_id
        FROM ava_states av2
        JOIN states s2 ON av2.state_id = s2.id
        WHERE s2.abbreviation = $1
      )
      GROUP BY a.id
      ORDER BY a.name
      `,
      [abbrev]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: `No AVAs found for state: ${abbrev}` });
    }

    const featureCollection = {
      type: 'FeatureCollection',
      features: rows.map((row) => ({
        type: 'Feature',
        properties: {
          id: row.id,
          slug: row.slug,
          ava_id: row.ava_id,
          name: row.name,
          aka: row.aka,
          created: row.created,
          removed: row.removed,
          cfr_index: row.cfr_index,
          valid_start: row.valid_start,
          valid_end: row.valid_end,
          states: row.states,
          within: row.within,   // pipe-delimited parent names for AVAListPanel hierarchy
          centroid: row.centroid,
        },
        geometry: includeGeometry ? row.geometry : null,
      })),
    };

    res.json(featureCollection);
  } catch (err) {
    console.error('GET /api/avas/state/:stateAbbrev error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/avas/:slug
 *
 * Returns a single AVA with full TTB metadata, geometry, states, counties,
 * and summary parent/child counts (use /parents and /children for the lists).
 */
router.get('/:slug', async (req, res) => {
  const { slug } = req.params;

  try {
    // Main AVA row
    const avaResult = await pool.query(
      `
      SELECT
        a.*,
        ST_AsGeoJSON(a.geometry)::json AS geometry_json,
        ST_AsGeoJSON(a.centroid)::json AS centroid_json
      FROM avas a
      WHERE a.slug = $1
      `,
      [slug]
    );

    if (avaResult.rows.length === 0) {
      return res.status(404).json({ error: `AVA not found: ${slug}` });
    }

    const ava = avaResult.rows[0];

    // States, counties, parents, children — run in parallel
    const [statesResult, countiesResult, parentsResult, childrenResult] =
      await Promise.all([
        pool.query(
          `SELECT s.abbreviation, s.name
           FROM states s
           JOIN ava_states av ON s.id = av.state_id
           WHERE av.ava_id = $1
           ORDER BY s.abbreviation`,
          [ava.id]
        ),
        pool.query(
          `SELECT c.name, s.abbreviation AS state
           FROM counties c
           JOIN ava_counties ac ON c.id = ac.county_id
           JOIN states s ON c.state_id = s.id
           WHERE ac.ava_id = $1
           ORDER BY s.abbreviation, c.name`,
          [ava.id]
        ),
        pool.query(
          `SELECT a.slug, a.name
           FROM avas a
           JOIN ava_hierarchy h ON a.id = h.parent_id
           WHERE h.child_id = $1
           ORDER BY a.name`,
          [ava.id]
        ),
        pool.query(
          `SELECT a.slug, a.name
           FROM avas a
           JOIN ava_hierarchy h ON a.id = h.child_id
           WHERE h.parent_id = $1
           ORDER BY a.name`,
          [ava.id]
        ),
      ]);

    res.json({
      type: 'Feature',
      properties: {
        id: ava.id,
        slug: ava.slug,
        ava_id: ava.ava_id,
        name: ava.name,
        aka: ava.aka,
        created: ava.created,
        removed: ava.removed,
        petitioner: ava.petitioner,
        cfr_author: ava.cfr_author,
        cfr_index: ava.cfr_index,
        cfr_revision_history: ava.cfr_revision_history,
        approved_maps: ava.approved_maps,
        boundary_description: ava.boundary_description,
        used_maps: ava.used_maps,
        valid_start: ava.valid_start,
        valid_end: ava.valid_end,
        lcsh: ava.lcsh,
        sameas: ava.sameas,
        states: statesResult.rows,
        counties: countiesResult.rows,
        parents: parentsResult.rows,
        children: childrenResult.rows,
      },
      geometry: ava.geometry_json,
    });
  } catch (err) {
    console.error('GET /api/avas/:slug error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/avas/:slug/children
 *
 * Returns all direct child AVAs (sub-AVAs) of the given AVA.
 */
router.get('/:slug/children', async (req, res) => {
  const { slug } = req.params;

  try {
    const { rows } = await pool.query(
      `
      SELECT child.slug, child.name, child.cfr_index,
             ST_AsGeoJSON(child.centroid)::json AS centroid,
             array_agg(DISTINCT s.abbreviation) AS states
      FROM avas child
      JOIN ava_hierarchy h ON child.id = h.child_id
      JOIN avas parent ON h.parent_id = parent.id
      JOIN ava_states av ON child.id = av.ava_id
      JOIN states s ON av.state_id = s.id
      WHERE parent.slug = $1
      GROUP BY child.id
      ORDER BY child.name
      `,
      [slug]
    );

    res.json({ slug, children: rows });
  } catch (err) {
    console.error('GET /api/avas/:slug/children error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/avas/:slug/parents
 *
 * Returns all parent AVAs that contain the given AVA.
 */
router.get('/:slug/parents', async (req, res) => {
  const { slug } = req.params;

  try {
    const { rows } = await pool.query(
      `
      SELECT parent.slug, parent.name, parent.cfr_index,
             ST_AsGeoJSON(parent.centroid)::json AS centroid,
             array_agg(DISTINCT s.abbreviation) AS states
      FROM avas parent
      JOIN ava_hierarchy h ON parent.id = h.parent_id
      JOIN avas child ON h.child_id = child.id
      JOIN ava_states av ON parent.id = av.ava_id
      JOIN states s ON av.state_id = s.id
      WHERE child.slug = $1
      GROUP BY parent.id
      ORDER BY parent.name
      `,
      [slug]
    );

    res.json({ slug, parents: rows });
  } catch (err) {
    console.error('GET /api/avas/:slug/parents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
