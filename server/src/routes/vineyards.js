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
 *   ?linked=true                   — only parcels with a winery_id (linked to a winery record)
 */
router.get('/parcels', async (req, res) => {
  const bbox = parseBbox(req.query.bbox);
  const ava = req.query.ava || null;
  const dataset = req.query.dataset || null;
  const variety = req.query.variety || null;
  const wineryId = req.query.winery_id ? parseInt(req.query.winery_id, 10) : null;
  const linkedOnly = req.query.linked === 'true';

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

  const linkedCondition = linkedOnly ? 'AND vp.winery_id IS NOT NULL' : '';

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
        ${linkedCondition}
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
 * GET /api/vineyards/parcels/:id/topo-stats
 *
 * Returns 1m LiDAR topography statistics for a specific vineyard parcel.
 */
router.get('/parcels/:id/topo-stats', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid parcel id' });

  try {
    const { rows } = await pool.query(
      `
      SELECT
        parcel_id,
        elevation_min_ft,
        elevation_max_ft,
        elevation_mean_ft,
        elevation_std_ft,
        slope_mean_deg,
        slope_max_deg,
        slope_p10_deg,
        slope_p90_deg,
        aspect_dominant_deg,
        aspect_mean_deg,
        pixel_count,
        data_source
      FROM vineyard_parcel_topo_stats
      WHERE parcel_id = $1
      `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No topo stats found for this parcel' });
    }

    const r = rows[0];
    const topo = {
      elevation_min_ft:    r.elevation_min_ft != null ? Number(r.elevation_min_ft) : null,
      elevation_max_ft:    r.elevation_max_ft != null ? Number(r.elevation_max_ft) : null,
      elevation_mean_ft:   r.elevation_mean_ft != null ? Number(r.elevation_mean_ft) : null,
      elevation_std_ft:    r.elevation_std_ft != null ? Number(r.elevation_std_ft) : null,
      slope_mean_deg:      r.slope_mean_deg != null ? Number(r.slope_mean_deg) : null,
      slope_max_deg:       r.slope_max_deg != null ? Number(r.slope_max_deg) : null,
      slope_p10_deg:       r.slope_p10_deg != null ? Number(r.slope_p10_deg) : null,
      slope_p90_deg:       r.slope_p90_deg != null ? Number(r.slope_p90_deg) : null,
      aspect_dominant_deg: r.aspect_dominant_deg != null ? Number(r.aspect_dominant_deg) : null,
      aspect_mean_deg:     r.aspect_mean_deg != null ? Number(r.aspect_mean_deg) : null,
      aspect_label:        degreesToCompass(r.aspect_dominant_deg),
      pixel_count:         r.pixel_count,
      data_source:         r.data_source,
    };

    res.json({ parcel_id: id, topo });
  } catch (err) {
    console.error('GET /api/vineyards/parcels/:id/topo-stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Convert aspect degrees (0–360) to a 16-point compass label.
 * Returns 'Flat' for negative values (flat terrain from GDAL).
 */
function degreesToCompass(deg) {
  if (deg == null || deg < 0) return 'Flat';
  const labels = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];
  const idx = Math.round(Number(deg) / 22.5) % 16;
  return labels[idx];
}

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
