import express from 'express';
import { pool } from '../db/pool.js';
import { resolveAssociation, membersOf, badAssociation } from '../lib/associations.js';

const router = express.Router();

// AVA boundaries + hierarchy come from the avas / ava_hierarchy tables
// (migration 026, loaded by server/scripts/load-avas.mjs from TTB's polygons).

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

// Recomputing the spatial sums unions every block against each AVA in scope,
// so cache briefly per scope. Block geometry changes rarely (admin edits); a
// short TTL keeps the number effectively live.
const ACRES_CACHE_TTL_MS = 5 * 60 * 1000;
const acresCache = new Map(); // 'parent:<slug>' | 'state:<abbr>' → { at, payload }

/**
 * GET /api/avas/acres?parent=willamette-valley
 *
 * Live "mapped vineyard acres" for every AVA nested (at any depth) inside
 * `parent` (default 'willamette-valley'), plus the parent's own de-duplicated
 * total, computed from vineyard_blocks.acres.
 *
 * A block counts toward an AVA when its representative interior point falls
 * inside that AVA's boundary — the same rule /members and the export scripts
 * use — so nested sub-AVAs (Ribbon Ridge, Laurelwood) roll up into their
 * parents, and the parent total counts every block once.
 *
 * Response: { avas: { '<slug>': <acres>, ... }, total: <parent acres> }
 *
 * GET /api/avas/acres?state=OR instead covers every AVA in the state; `total`
 * then counts each block once even where AVAs overlap.
 */
router.get('/acres', async (req, res) => {
  if (req.query.state) return stateAcres(req, res);

  const parent = String(req.query.parent || 'willamette-valley').toLowerCase();
  if (!/^[a-z0-9-]+$/.test(parent)) {
    return res.status(400).json({ error: 'Invalid AVA slug' });
  }
  const cached = acresCache.get(`parent:${parent}`);
  if (cached && Date.now() - cached.at < ACRES_CACHE_TTL_MS) {
    return res.json(cached.payload);
  }

  try {
    const { rows } = await pool.query(
      `
      WITH RECURSIVE scope AS (
        SELECT id, slug, geometry FROM avas WHERE slug = $1
        UNION
        SELECT c.id, c.slug, c.geometry
        FROM scope s
        JOIN ava_hierarchy h ON h.parent_id = s.id
        JOIN avas c ON c.id = h.child_id
      )
      SELECT a.slug,
             COALESCE(SUM(b.acres), 0)::float AS acres
      FROM scope a
      LEFT JOIN vineyard_blocks b
        ON b.geometry IS NOT NULL
       AND b.geometry && a.geometry
       AND ST_Contains(a.geometry, ST_PointOnSurface(b.geometry))
      GROUP BY a.slug
      `,
      [parent]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: `AVA not found: ${parent}` });
    }

    const avas = {};
    for (const r of rows) avas[r.slug] = r.acres;
    const total = avas[parent] ?? 0;
    delete avas[parent];

    const payload = { avas, total };
    acresCache.set(`parent:${parent}`, { at: Date.now(), payload });
    res.json(payload);
  } catch (err) {
    console.error('GET /api/avas/acres error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function stateAcres(req, res) {
  const abbr = String(req.query.state).toUpperCase();
  if (!/^[A-Z]{2}$/.test(abbr)) {
    return res.status(400).json({ error: 'Invalid state' });
  }
  const cached = acresCache.get(`state:${abbr}`);
  if (cached && Date.now() - cached.at < ACRES_CACHE_TTL_MS) {
    return res.json(cached.payload);
  }

  try {
    const { rows } = await pool.query(
      `
      WITH scope AS (
        -- the AVA's part inside the state (migration 028), else the whole AVA
        SELECT a.id, a.slug, COALESCE(av.geometry, a.geometry) AS geometry
        FROM avas a
        JOIN ava_states av ON av.ava_id = a.id
        JOIN states s ON s.id = av.state_id
        WHERE s.abbreviation = $1
      ),
      hits AS (
        SELECT a.slug, b.id AS block_id, b.acres
        FROM scope a
        JOIN vineyard_blocks b
          ON b.geometry IS NOT NULL
         AND b.geometry && a.geometry
         AND ST_Contains(a.geometry, ST_PointOnSurface(b.geometry))
      )
      SELECT a.slug,
             COALESCE((SELECT SUM(h.acres) FROM hits h WHERE h.slug = a.slug), 0)::float AS acres,
             (SELECT COALESCE(SUM(acres), 0) FROM (SELECT DISTINCT block_id, acres FROM hits) d)::float AS total
      FROM scope a
      `,
      [abbr]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: `No AVAs found for state: ${abbr}` });
    }

    const avas = {};
    for (const r of rows) avas[r.slug] = r.acres;
    const payload = { avas, total: rows[0].total };
    acresCache.set(`state:${abbr}`, { at: Date.now(), payload });
    res.json(payload);
  } catch (err) {
    console.error('GET /api/avas/acres?state error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

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
 * GET /api/avas/:slug/terroir
 *
 * Soil and bedrock make-up of the AVA (ava_terroir_composition, migration 027):
 * share of the AVA's Oregon land in each class, largest first.
 *   soil / bedrock          every class (shares sum to 100)
 *   soil_series / formation the 12 largest named units
 *   states                  states the AVA touches; the sources are Oregon-only,
 *                           so a multi-state AVA is summarised over its Oregon part
 */
router.get('/:slug/terroir', async (req, res) => {
  const { slug } = req.params;
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Invalid AVA slug' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT c.layer, c.class, c.acres::float AS acres, c.pct::float AS pct,
              (SELECT array_agg(st.abbreviation ORDER BY st.abbreviation) FROM ava_states av
                JOIN states st ON st.id = av.state_id WHERE av.ava_id = a.id) AS states
       FROM ava_terroir_composition c
       JOIN avas a ON a.id = c.ava_id
       WHERE a.slug = $1
       ORDER BY c.layer, c.rank`,
      [slug]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: `No soil or bedrock data for AVA: ${slug}` });
    }

    const out = { slug, states: rows[0].states || [], soil: [], soil_series: [], bedrock: [], formation: [] };
    for (const r of rows) out[r.layer]?.push({ class: r.class, pct: r.pct, acres: r.acres });
    // Changes only when the pipeline re-runs.
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(out);
  } catch (err) {
    console.error('GET /api/avas/:slug/terroir error:', err);
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

/**
 * GET /api/avas/:slug/members
 *
 * Returns the recids of member wineries (?association=, default wvwa) that own at least one vineyard
 * whose representative interior point falls inside this AVA boundary.
 *
 * This is the vineyard-ownership complement to the frontend's client-side
 * tasting-room point-in-polygon filter: a member who farms a vineyard inside
 * the AVA but whose tasting room sits elsewhere still belongs in the AVA's
 * directory. The frontend unions these recids with the point-inside set.
 *
 * The AVA boundary comes from the `avas` table (TTB polygons, migration 026).
 *
 * Interior-point rule (ST_PointOnSurface + ST_Contains) mirrors the
 * export-ava-vineyards.py classification convention, so a vineyard lists in
 * exactly one AVA per hierarchy level. Because a child AVA's polygon nests
 * inside its parent's, sub-AVA vineyard owners roll up into parent AVAs
 * automatically.
 */
router.get('/:slug/members', async (req, res) => {
  const { slug } = req.params;

  // Slugs are lowercase kebab-case only.
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Invalid AVA slug' });
  }

  try {
    const association = await resolveAssociation(req);
    if (!association) return badAssociation(res);

    const { rows: found } = await pool.query('SELECT 1 FROM avas WHERE slug = $1', [slug]);
    if (found.length === 0) {
      return res.status(404).json({ error: `AVA not found: ${slug}` });
    }

    const { rows } = await pool.query(
      `
      SELECT DISTINCT w.recid
      FROM avas a
      JOIN vineyards v ON v.geometry && a.geometry
                      AND ST_Contains(a.geometry, ST_PointOnSurface(v.geometry))
      JOIN wineries w ON w.id = v.winery_id
      WHERE a.slug = $1
        AND w.id IN ${membersOf('$2')}
      ORDER BY w.recid
      `,
      [slug, association]
    );

    res.json({ slug, recids: rows.map((r) => r.recid) });
  } catch (err) {
    console.error('GET /api/avas/:slug/members error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
