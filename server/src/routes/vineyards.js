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
 * Returns vineyard footprint polygons (one feature per vineyard entity) as a
 * GeoJSON FeatureCollection. Path kept as /parcels for client compatibility.
 *
 * Query params:
 *   ?bbox=west,south,east,north    — spatial filter (strongly recommended)
 *   ?ava=Chehalem+Mountains        — filter by nested_ava name (case-insensitive)
 *   ?dataset=adelsheim|chehalem-dundee|yamhill-carlton|wvwa-ml-2025
 *   ?variety=Pinot+Noir            — ILIKE match on varietals_list
 *   ?winery_id=42                  — only vineyards for a specific winery db id
 *   ?linked=true                   — only vineyards with a winery_id (linked to a winery record)
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

  // Optional ID allowlist (used by the filter modal to fetch only matching
  // parcel polygons for the map dimming overlay). Capped at 5000 ids.
  let idsCondition = '';
  if (req.query.ids) {
    const ids = String(req.query.ids)
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n) && n > 0)
      .slice(0, 5000);
    if (ids.length > 0) {
      params.push(ids);
      idsCondition = `AND vp.id = ANY($${params.length}::int[])`;
    } else {
      // Explicit empty list → return zero features
      return res.json({ type: 'FeatureCollection', features: [] });
    }
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        vp.id,
        vp.winery_id,
        vp.source_dataset,
        vp.vineyard_name,
        vp.vineyard_org,
        vp.ava_name,
        vp.nested_ava,
        vp.nested_nested_ava,
        vp.acres,
        vp.varietals_list,
        w.recid AS winery_recid,
        w.title AS winery_title,
        (vp.winery_id IS NOT NULL AND COALESCE(w.is_wvwa_member, false)) AS is_member,
        COALESCE(vc.color_index, -1) AS color_index,
        ST_AsGeoJSON(vp.geometry)::json AS geometry
      FROM vineyards vp
      LEFT JOIN wineries w ON vp.winery_id = w.id
      LEFT JOIN vineyard_colors vc
        ON vc.vineyard_key = LOWER(TRIM(vp.vineyard_name))
        AND vp.winery_id IS NOT NULL
        AND COALESCE(w.is_wvwa_member, false) = true
      WHERE ${bboxCondition}
        ${avaCondition}
        ${datasetCondition}
        ${varietyCondition}
        ${wineryCondition}
        ${linkedCondition}
        ${idsCondition}
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
          ava_name:         row.ava_name,
          nested_ava:       row.nested_ava,
          nested_nested_ava: row.nested_nested_ava,
          acres:            row.acres != null ? Number(row.acres) : null,
          varietals_list:   row.varietals_list,
          winery_recid:     row.winery_recid,
          winery_title:     row.winery_title,
          is_member:        row.is_member === true,
          color_index:      row.color_index != null ? Number(row.color_index) : -1,
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
      FROM vineyards vp
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
 * PATCH /api/vineyards/parcels/:id/metadata
 *
 * Updates editable text/numeric fields for a vineyard.
 * Body: any subset of { vineyard_name, vineyard_org, ava_name,
 *   nested_ava, nested_nested_ava, acres, varietals_list,
 *   source_dataset, winery_id }
 */
router.patch('/parcels/:id/metadata', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid vineyard id' });

  const ALLOWED = [
    'vineyard_name', 'vineyard_org', 'ava_name',
    'nested_ava', 'nested_nested_ava',
    'acres', 'varietals_list', 'source_dataset', 'winery_id',
  ];

  const updates = {};
  for (const key of ALLOWED) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      updates[key] = req.body[key] === '' ? null : req.body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  // Validate winery_id if provided
  if (updates.winery_id !== undefined && updates.winery_id !== null) {
    const wid = parseInt(updates.winery_id, 10);
    if (isNaN(wid)) return res.status(400).json({ error: 'winery_id must be an integer' });
    updates.winery_id = wid;
  }

  // Validate acres if provided
  if (updates.acres !== undefined && updates.acres !== null) {
    const ac = parseFloat(updates.acres);
    if (isNaN(ac) || ac < 0) return res.status(400).json({ error: 'acres must be a non-negative number' });
    updates.acres = ac;
  }

  const setClauses = Object.keys(updates).map((col, i) => `${col} = $${i + 1}`);
  const values = [...Object.values(updates), id];

  try {
    const { rowCount } = await pool.query(
      `UPDATE vineyards SET ${setClauses.join(', ')} WHERE id = $${values.length}`,
      values
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Vineyard not found' });
    res.json({ success: true, id, updated: Object.keys(updates) });
  } catch (err) {
    console.error('PATCH /api/vineyards/parcels/:id/metadata error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/vineyards/parcels/:id/geometry
 *
 * Replaces the PostGIS geometry for a specific vineyard footprint.
 * NOTE: footprints are derived from block unions post-018 — a direct write
 * here is an override and will be recomputed the next time any of the
 * vineyard's blocks change (trg_vineyard_footprint). Prefer editing blocks.
 * Body: { "geometry": <GeoJSON Geometry — Polygon or MultiPolygon> }
 * Protected by requireApiKey via the router-level middleware in app.js.
 */
router.patch('/parcels/:id/geometry', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid vineyard id' });

  const { geometry } = req.body;
  if (!geometry || typeof geometry !== 'object') {
    return res.status(400).json({ error: 'Request body must include a geometry object' });
  }
  if (!['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    return res.status(400).json({ error: 'geometry.type must be Polygon or MultiPolygon' });
  }
  if (!Array.isArray(geometry.coordinates)) {
    return res.status(400).json({ error: 'geometry.coordinates is required' });
  }

  try {
    const { rowCount, rows } = await pool.query(
      `UPDATE vineyards
       SET geometry = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326)),
           acres = ROUND((ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326)::geography) / 4046.856422)::numeric, 3)
       WHERE id = $2
       RETURNING acres`,
      [JSON.stringify(geometry), id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Vineyard not found' });
    res.json({ success: true, id, acres: rows[0].acres != null ? Number(rows[0].acres) : null });
  } catch (err) {
    console.error('PATCH /api/vineyards/parcels/:id/geometry error:', err);
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
        vineyard_id AS parcel_id,
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
      FROM vineyard_topo_stats
      WHERE vineyard_id = $1
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
        year_planted,
        fruit_sold_to,
        CASE
          WHEN geometry IS NOT NULL
          THEN ST_AsGeoJSON(geometry)::json
          ELSE NULL
        END AS geometry,
        COALESCE(
          (SELECT json_agg(json_build_object(
              'name', bb.buyer_name_raw,
              'winery_id', bb.buyer_winery_id,
              'winery_recid', bw.recid,
              'winery_title', bw.title
            ) ORDER BY bb.buyer_name_raw)
           FROM vineyard_block_buyers bb
           LEFT JOIN wineries bw ON bw.id = bb.buyer_winery_id
           WHERE bb.block_id = vineyard_blocks.id),
          '[]'::json
        ) AS buyers
      FROM vineyard_blocks
      WHERE vineyard_id = $1
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

/**
 * GET /api/vineyards/varieties
 *
 * Returns the distinct grape varieties found across vineyard parcels and
 * blocks, with usage counts. Used to populate the filter modal's variety
 * chip picker.
 *
 * vineyards.varietals_list is a free-form delimited string (commas,
 * pipes, semicolons or " and "), so it is split server-side here. Block-level
 * vineyard_blocks.variety is a single value per row.
 */
router.get('/varieties', async (_req, res) => {
  try {
    // Block-level varieties (clean, single-value column)
    const { rows: blockRows } = await pool.query(
      `SELECT TRIM(variety) AS name, COUNT(*)::int AS block_count
         FROM vineyard_blocks
        WHERE variety IS NOT NULL AND TRIM(variety) <> ''
     GROUP BY TRIM(variety)`
    );

    // Parcel-level varieties (delimited string, split client-side here)
    const { rows: parcelRows } = await pool.query(
      `SELECT varietals_list FROM vineyards
        WHERE varietals_list IS NOT NULL AND TRIM(varietals_list) <> ''`
    );

    const counts = new Map();
    const bump = (raw, kind) => {
      const name = String(raw).trim();
      if (!name) return;
      const key = name.toLowerCase();
      const entry = counts.get(key) || { name, parcel_count: 0, block_count: 0 };
      entry[kind] += 1;
      counts.set(key, entry);
    };

    for (const r of parcelRows) {
      // Split on commas, pipes, semicolons, slashes, or " and "
      const parts = String(r.varietals_list).split(/[,;|/]|\s+and\s+/i);
      for (const p of parts) bump(p, 'parcel_count');
    }
    for (const r of blockRows) {
      // Already split: bump by the actual count not by 1
      const name = String(r.name).trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const entry = counts.get(key) || { name, parcel_count: 0, block_count: 0 };
      entry.block_count += Number(r.block_count) || 0;
      counts.set(key, entry);
    }

    const varieties = Array.from(counts.values())
      .sort((a, b) =>
        (b.parcel_count + b.block_count) - (a.parcel_count + a.block_count) ||
        a.name.localeCompare(b.name)
      );

    res.json({ varieties });
  } catch (err) {
    console.error('GET /api/vineyards/varieties error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/vineyards/filter-ranges
 *
 * Returns the min/max of filterable numeric columns so the UI can scale its
 * sliders. Uses 1st/99th percentiles to ignore outlier nodata garbage.
 */
router.get('/filter-ranges', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        ROUND(percentile_cont(0.01) WITHIN GROUP (ORDER BY ts.elevation_mean_ft)::numeric, 0) AS elev_p01,
        ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY ts.elevation_mean_ft)::numeric, 0) AS elev_p99,
        ROUND(percentile_cont(0.01) WITHIN GROUP (ORDER BY ts.slope_mean_deg)::numeric, 1)    AS slope_p01,
        ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY ts.slope_mean_deg)::numeric, 1)    AS slope_p99
      FROM vineyard_topo_stats ts
    `);

    const { rows: acreRows } = await pool.query(`
      SELECT
        ROUND(MIN(acres)::numeric, 2) AS acres_min,
        ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY acres)::numeric, 1) AS acres_p99
      FROM vineyards
      WHERE acres IS NOT NULL AND acres > 0
    `);

    const t = rows[0] || {};
    const a = acreRows[0] || {};

    res.json({
      elevation_ft: { min: Number(t.elev_p01) || 0, max: Number(t.elev_p99) || 2000 },
      slope_deg:    { min: Number(t.slope_p01) || 0, max: Number(t.slope_p99) || 30 },
      acres:        { min: Number(a.acres_min) || 0, max: Number(a.acres_p99) || 100 },
    });
  } catch (err) {
    console.error('GET /api/vineyards/filter-ranges error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
