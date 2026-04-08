import express from 'express';
import { pool } from '../db/pool.js';

const router = express.Router();

/**
 * Parse and validate a bbox query string "west,south,east,north".
 * Returns [w, s, e, n] or null if absent/invalid.
 */
function parseBbox(bboxStr) {
  if (!bboxStr) return null;
  const parts = bboxStr.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return null;
  const [w, s, e, n] = parts;
  if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) return null;
  return parts;
}

/**
 * GET /api/vineyards/parcels
 *
 * Returns vineyard parcel polygons as a GeoJSON FeatureCollection.
 *
 * Query params:
 *   ?bbox=west,south,east,north    — spatial filter (strongly recommended)
 *   ?ava=Chehalem+Mountains        — filter by nested_ava name (case-insensitive)
 *   ?dataset=adelsheim|chehalem-dundee|yamhill-carlton
 *   ?variety=Pinot+Noir            — ILIKE match on varietals_list
 *   ?winery_id=42                  — only parcels for a specific winery db id
 */
router.get('/parcels', async (req, res) => {
  const bbox = parseBbox(req.query.bbox);
  const ava = req.query.ava || null;
  const dataset = req.query.dataset || null;
  const variety = req.query.variety || null;
  const wineryId = req.query.winery_id ? parseInt(req.query.winery_id, 10) : null;

  const params = [];

  let bboxCondition = 'TRUE';
  if (bbox) {
    params.push(...bbox);
    bboxCondition = `ST_Intersects(vp.geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))`;
  }

  const avaCondition = ava
    ? `AND vp.nested_ava ILIKE $${params.push(ava)}`
    : '';

  const datasetCondition = dataset
    ? `AND vp.source_dataset = $${params.push(dataset)}`
    : '';

  const varietyCondition = variety
    ? `AND vp.varietals_list ILIKE $${params.push('%' + variety + '%')}`
    : '';

  const wineryCondition = wineryId != null && !isNaN(wineryId)
    ? `AND vp.winery_id = $${params.push(wineryId)}`
    : '';

  try {
    const { rows } = await pool.query(
      `
      SELECT
        vp.id,
        vp.winery_id,
        vp.source_dataset,
        vp.vineyard_name,
        vp.vineyard_org,
        vp.acres,
        vp.nested_ava,
        vp.nested_nested_ava,
        vp.varietals_list,
        w.recid AS winery_recid,
        w.title AS winery_title,
        ST_AsGeoJSON(vp.geometry)::json AS geometry
      FROM vineyard_parcels vp
      LEFT JOIN wineries w ON vp.winery_id = w.id
      WHERE ${bboxCondition}
        ${avaCondition}
        ${datasetCondition}
        ${varietyCondition}
        ${wineryCondition}
      ORDER BY vp.vineyard_name
      `,
      params
    );

    res.json({
      type: 'FeatureCollection',
      features: rows.map((row) => ({
        type: 'Feature',
        properties: {
          id:               row.id,
          winery_id:        row.winery_id,
          source_dataset:   row.source_dataset,
          vineyard_name:    row.vineyard_name,
          vineyard_org:     row.vineyard_org,
          acres:            row.acres != null ? Number(row.acres) : null,
          nested_ava:       row.nested_ava,
          nested_nested_ava: row.nested_nested_ava,
          varietals_list:   row.varietals_list,
          winery_recid:     row.winery_recid,
          winery_title:     row.winery_title,
        },
        geometry: row.geometry,
      })),
    });
  } catch (err) {
    console.error('GET /api/vineyards/parcels error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/vineyards/parcels/by-winery/:recid
 *
 * Returns all vineyard parcels linked to a winery by its source recid.
 * Replaces the VINEYARD_BY_RECID client-side lookup in WVWAMap.jsx.
 *
 * NOTE: This route must be defined BEFORE /parcels/:id/blocks to avoid
 * Express matching "by-winery" as the :id param.
 */
router.get('/parcels/by-winery/:recid', async (req, res) => {
  const recid = parseInt(req.params.recid, 10);
  if (isNaN(recid)) return res.status(400).json({ error: 'Invalid recid' });

  try {
    const { rows } = await pool.query(
      `
      SELECT
        vp.id,
        vp.winery_id,
        vp.source_dataset,
        vp.vineyard_name,
        vp.vineyard_org,
        vp.acres,
        vp.nested_ava,
        vp.nested_nested_ava,
        vp.varietals_list,
        w.recid AS winery_recid,
        w.title AS winery_title,
        ST_AsGeoJSON(vp.geometry)::json AS geometry
      FROM vineyard_parcels vp
      JOIN wineries w ON vp.winery_id = w.id
      WHERE w.recid = $1
      ORDER BY vp.vineyard_name
      `,
      [recid]
    );

    res.json({
      type: 'FeatureCollection',
      features: rows.map((row) => ({
        type: 'Feature',
        properties: {
          id:               row.id,
          winery_id:        row.winery_id,
          source_dataset:   row.source_dataset,
          vineyard_name:    row.vineyard_name,
          vineyard_org:     row.vineyard_org,
          acres:            row.acres != null ? Number(row.acres) : null,
          nested_ava:       row.nested_ava,
          nested_nested_ava: row.nested_nested_ava,
          varietals_list:   row.varietals_list,
          winery_recid:     row.winery_recid,
          winery_title:     row.winery_title,
        },
        geometry: row.geometry,
      })),
    });
  } catch (err) {
    console.error('GET /api/vineyards/parcels/by-winery/:recid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/vineyards/parcels/:id/blocks
 *
 * Returns all block-level viticulture data for a specific vineyard parcel.
 */
router.get('/parcels/:id/blocks', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid parcel id' });

  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        vineyard_name,
        block_name,
        variety,
        clone,
        rootstock,
        rows,
        spacing,
        vines_per_acre,
        vines,
        acres,
        year_planted
      FROM vineyard_blocks
      WHERE vineyard_parcel_id = $1
      ORDER BY block_name
      `,
      [id]
    );

    res.json({ parcel_id: id, blocks: rows });
  } catch (err) {
    console.error('GET /api/vineyards/parcels/:id/blocks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
