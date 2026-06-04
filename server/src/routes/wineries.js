import express from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool.js';
import { classifyListingCategory } from '../lib/listingCategories.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_WINERIES_GEOJSON_PATH = path.resolve(__dirname, '../../../src/data/wineries.geojson');

function isPointWithinBbox(geometry, bbox) {
  if (!bbox || !geometry || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) {
    return true;
  }
  const [lng, lat] = geometry.coordinates;
  const [w, s, e, n] = bbox;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

async function loadLocalWineriesFallback({ bbox, hasParcels, category }) {
  const raw = await readFile(LOCAL_WINERIES_GEOJSON_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const features = Array.isArray(parsed?.features) ? parsed.features : [];

  const filtered = features
    .filter((feature) => isPointWithinBbox(feature.geometry, bbox))
    .filter((feature) => {
      const featureCategory = classifyListingCategory({
        recid: feature?.properties?.recid,
        title: feature?.properties?.title,
        description: feature?.properties?.description,
        category: feature?.properties?.category,
      });
      if (category && featureCategory !== category) return false;
      if (!hasParcels) return true;
      const parcelCount = Number(feature?.properties?.parcel_count ?? feature?.properties?.polygon_count ?? 0);
      return parcelCount > 0;
    });

  return {
    type: 'FeatureCollection',
    features: filtered.map((feature, index) => ({
      type: 'Feature',
      properties: {
        id: feature?.properties?.id ?? feature?.properties?.recid ?? index + 1,
        recid: feature?.properties?.recid ?? index + 1,
        title: feature?.properties?.title || `Winery ${index + 1}`,
        description: feature?.properties?.description || '',
        phone: feature?.properties?.phone || '',
        url: feature?.properties?.url || '',
        image_url: feature?.properties?.image_url || '',
        category: classifyListingCategory({
          recid: feature?.properties?.recid,
          title: feature?.properties?.title,
          description: feature?.properties?.description,
          category: feature?.properties?.category,
        }),
        parcel_count: Number(feature?.properties?.parcel_count ?? feature?.properties?.polygon_count ?? 0),
        data_source: 'local_fallback',
      },
      geometry: feature.geometry,
    })),
  };
}

/**
 * GET /api/wineries
 *
 * Returns all wineries as a GeoJSON FeatureCollection.
 *
 * Query params:
 *   ?bbox=west,south,east,north  — spatial filter
 *   ?has_parcels=true            — only wineries with linked vineyard parcels
 *   ?category=winery|hotel|...   — filter by category
 */
router.get('/', async (req, res) => {
  const bbox = parseBbox(req.query.bbox);
  const hasParcels = req.query.has_parcels === 'true';
  const category = req.query.category || null;

  try {
    const params = [];
    let bboxCondition = 'TRUE';
    if (bbox) {
      params.push(...bbox);
      bboxCondition = `ST_Intersects(w.location, ST_MakeEnvelope($1, $2, $3, $4, 4326))`;
    }

    const parcelsCondition = hasParcels
      ? `AND EXISTS (SELECT 1 FROM vineyard_parcels vp WHERE vp.winery_id = w.id)`
      : '';

    const { rows } = await pool.query(
      `
      SELECT
        w.id,
        w.recid,
        w.title,
        w.description,
        w.phone,
        w.url,
        w.image_url,
        w.category,
        ST_AsGeoJSON(w.location)::json AS geometry,
        (SELECT COUNT(*) FROM vineyard_parcels vp WHERE vp.winery_id = w.id) AS parcel_count
      FROM wineries w
      WHERE ${bboxCondition}
        ${parcelsCondition}
      ORDER BY w.title
      `,
      params
    );

    const classifiedRows = rows
      .map((row) => ({
        ...row,
        category: classifyListingCategory({
          recid: row.recid,
          title: row.title,
          description: row.description,
          category: row.category,
        }),
      }))
      .filter((row) => !category || row.category === category);

    res.json({
      type: 'FeatureCollection',
      features: classifiedRows.map((row) => ({
        type: 'Feature',
        properties: {
          id:           row.id,
          recid:        row.recid,
          title:        row.title,
          description:  row.description,
          phone:        row.phone,
          url:          row.url,
          image_url:    row.image_url,
          category:     row.category,
          parcel_count: Number(row.parcel_count),
        },
        geometry: row.geometry,
      })),
    });
  } catch (err) {
    console.error('GET /api/wineries error:', err);
    try {
      const fallbackData = await loadLocalWineriesFallback({ bbox, hasParcels, category });
      return res.json(fallbackData);
    } catch (fallbackErr) {
      console.error('GET /api/wineries local fallback error:', fallbackErr);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
});

/**
 * GET /api/wineries/query
 *
 * Roll-up query: returns wineries that have at least one vineyard parcel
 * matching the given topo / viticulture / location filters. Used by the
 * Wineries dock filter modal and to drive map dimming.
 *
 * All filters are AND-combined. Aspect uses the indexed aspect_bucket
 * generated column from migration 012. Filters that touch topo stats
 * inner-join vineyard_parcel_topo_stats, so parcels without computed
 * stats are excluded from those filtered queries.
 *
 * Query params (all optional):
 *   elevation_min, elevation_max   — feet, on elevation_mean_ft
 *   slope_min, slope_max           — degrees, on slope_mean_deg
 *   aspect=N,NE,SW                 — comma-separated 8-pt buckets
 *   variety=Pinot+Noir             — ILIKE on varietals_list
 *   ava=Dundee+Hills               — ILIKE on nested_ava OR ava_name
 *   acres_min, acres_max           — on parcel acres
 *   linked=true                    — only parcels with a winery_id
 *   limit, offset                  — pagination on wineries (default 200/0)
 *
 * Response:
 *   {
 *     wineries: [{ id, recid, title, category, lng, lat, ava_names,
 *                  matching_parcel_count, matching_acres, elevation_mean_ft }],
 *     matching_parcel_ids: [...],
 *     matching_parcel_total_count,
 *     winery_total_count
 *   }
 */
router.get('/query', async (req, res) => {
  const VALID_ASPECTS = new Set(['N','NE','E','SE','S','SW','W','NW']);

  const elevMin   = req.query.elevation_min != null ? Number(req.query.elevation_min) : null;
  const elevMax   = req.query.elevation_max != null ? Number(req.query.elevation_max) : null;
  const slopeMin  = req.query.slope_min     != null ? Number(req.query.slope_min)     : null;
  const slopeMax  = req.query.slope_max     != null ? Number(req.query.slope_max)     : null;
  const acresMin  = req.query.acres_min     != null ? Number(req.query.acres_min)     : null;
  const acresMax  = req.query.acres_max     != null ? Number(req.query.acres_max)     : null;
  const variety   = req.query.variety || null;
  const ava       = req.query.ava || null;
  const linkedOnly = req.query.linked === 'true';

  const aspects = (req.query.aspect || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => VALID_ASPECTS.has(s));

  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 200;
  const rawOffset = parseInt(req.query.offset, 10);
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  // Validate numerics
  for (const [name, val] of Object.entries({ elevMin, elevMax, slopeMin, slopeMax, acresMin, acresMax })) {
    if (val !== null && !Number.isFinite(val)) {
      return res.status(400).json({ error: `Invalid numeric value for ${name}` });
    }
  }

  // Decide whether we need to join topo stats. Linked-only / variety / ava /
  // acres filters work without stats; aspect / elevation / slope require them.
  const needsTopoJoin =
    elevMin != null || elevMax != null ||
    slopeMin != null || slopeMax != null ||
    aspects.length > 0;

  const params = [];
  const where = ['vp.winery_id IS NOT NULL']; // roll-up only meaningful for linked parcels
  // (linkedOnly is implied; the explicit param is kept for symmetry but is a no-op here.)

  if (elevMin != null) {
    params.push(elevMin);
    where.push(`ts.elevation_mean_ft >= $${params.length}`);
  }
  if (elevMax != null) {
    params.push(elevMax);
    where.push(`ts.elevation_mean_ft <= $${params.length}`);
  }
  if (slopeMin != null) {
    params.push(slopeMin);
    where.push(`ts.slope_mean_deg >= $${params.length}`);
  }
  if (slopeMax != null) {
    params.push(slopeMax);
    where.push(`ts.slope_mean_deg <= $${params.length}`);
  }
  if (aspects.length > 0) {
    params.push(aspects);
    where.push(`ts.aspect_bucket = ANY($${params.length}::varchar[])`);
  }
  if (variety) {
    params.push(`%${variety}%`);
    where.push(`vp.varietals_list ILIKE $${params.length}`);
  }
  if (ava) {
    params.push(`%${ava}%`);
    where.push(`(vp.nested_ava ILIKE $${params.length} OR vp.ava_name ILIKE $${params.length})`);
  }
  if (acresMin != null) {
    params.push(acresMin);
    where.push(`vp.acres >= $${params.length}`);
  }
  if (acresMax != null) {
    params.push(acresMax);
    where.push(`vp.acres <= $${params.length}`);
  }

  const join = needsTopoJoin
    ? 'JOIN vineyard_parcel_topo_stats ts ON ts.parcel_id = vp.id'
    : 'LEFT JOIN vineyard_parcel_topo_stats ts ON ts.parcel_id = vp.id';

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  // Outer query: roll up matching parcels per winery
  const sql = `
    WITH matched AS (
      SELECT
        vp.id          AS parcel_id,
        vp.winery_id,
        vp.acres,
        vp.nested_ava,
        vp.ava_name,
        ts.elevation_mean_ft
      FROM vineyard_parcels vp
      ${join}
      ${whereSql}
    ),
    rollup AS (
      SELECT
        m.winery_id,
        COUNT(*)::int                                   AS matching_parcel_count,
        ROUND(SUM(COALESCE(m.acres, 0))::numeric, 2)    AS matching_acres,
        ROUND(AVG(m.elevation_mean_ft)::numeric, 0)     AS elevation_mean_ft,
        ARRAY_AGG(DISTINCT COALESCE(m.nested_ava, m.ava_name))
          FILTER (WHERE COALESCE(m.nested_ava, m.ava_name) IS NOT NULL)
                                                         AS ava_names,
        ARRAY_AGG(m.parcel_id)                          AS parcel_ids
      FROM matched m
      GROUP BY m.winery_id
    )
    SELECT
      w.id,
      w.recid,
      w.title,
      w.category,
      ST_X(w.location::geometry) AS lng,
      ST_Y(w.location::geometry) AS lat,
      r.matching_parcel_count,
      r.matching_acres,
      r.elevation_mean_ft,
      r.ava_names,
      r.parcel_ids
    FROM rollup r
    JOIN wineries w ON w.id = r.winery_id
    ORDER BY w.title
    LIMIT ${limit} OFFSET ${offset}
  `;

  try {
    const { rows } = await pool.query(sql, params);

    // Flatten parcel ids and compute totals across the (paginated) result set.
    // For an accurate total of matching parcels regardless of pagination,
    // we run a small COUNT query.
    const countSql = `
      SELECT
        COUNT(DISTINCT vp.id)        AS matching_parcel_total_count,
        COUNT(DISTINCT vp.winery_id) AS winery_total_count
      FROM vineyard_parcels vp
      ${join}
      ${whereSql}
    `;
    const { rows: countRows } = await pool.query(countSql, params);
    const totals = countRows[0] || { matching_parcel_total_count: 0, winery_total_count: 0 };

    const matchingParcelIds = [];
    for (const r of rows) {
      if (Array.isArray(r.parcel_ids)) matchingParcelIds.push(...r.parcel_ids);
    }

    res.json({
      wineries: rows.map(r => ({
        id: r.id,
        recid: r.recid,
        title: r.title,
        category: r.category,
        lng: r.lng,
        lat: r.lat,
        matching_parcel_count: r.matching_parcel_count,
        matching_acres: r.matching_acres != null ? Number(r.matching_acres) : 0,
        elevation_mean_ft: r.elevation_mean_ft != null ? Number(r.elevation_mean_ft) : null,
        ava_names: Array.isArray(r.ava_names) ? r.ava_names : [],
      })),
      matching_parcel_ids: matchingParcelIds,
      matching_parcel_total_count: Number(totals.matching_parcel_total_count) || 0,
      winery_total_count: Number(totals.winery_total_count) || 0,
    });
  } catch (err) {
    console.error('GET /api/wineries/query error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/wineries/:recid
 *
 * Returns a single winery feature with all linked vineyard parcels embedded.
 */
router.get('/:recid', async (req, res) => {
  const recid = parseInt(req.params.recid, 10);
  if (isNaN(recid)) return res.status(400).json({ error: 'Invalid recid' });

  try {
    const { rows } = await pool.query(
      `
      SELECT
        w.id,
        w.recid,
        w.title,
        w.description,
        w.phone,
        w.url,
        w.image_url,
        w.category,
        ST_AsGeoJSON(w.location)::json AS geometry,
        json_agg(
          json_build_object(
            'id',            vp.id,
            'vineyard_name', vp.vineyard_name,
            'vineyard_org',  vp.vineyard_org,
            'acres',         vp.acres,
            'nested_ava',    vp.nested_ava,
            'varietals',     vp.varietals_list,
            'source',        vp.source_dataset,
            'geometry',      ST_AsGeoJSON(vp.geometry)::json
          ) ORDER BY vp.vineyard_name
        ) FILTER (WHERE vp.id IS NOT NULL) AS parcels
      FROM wineries w
      LEFT JOIN vineyard_parcels vp ON vp.winery_id = w.id
      WHERE w.recid = $1
      GROUP BY w.id
      `,
      [recid]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: `Winery not found: ${recid}` });
    }

    const row = rows[0];
    res.json({
      type: 'Feature',
      properties: {
        id:          row.id,
        recid:       row.recid,
        title:       row.title,
        description: row.description,
        phone:       row.phone,
        url:         row.url,
        image_url:   row.image_url,
        category:    row.category,
        parcels:     row.parcels || [],
        sourced_from: await loadSourcedFrom(row.id),
      },
      geometry: row.geometry,
    });
  } catch (err) {
    console.error('GET /api/wineries/:recid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Returns the list of blocks (at other vineyards) that this winery buys
 * fruit from, grouped by source vineyard. Powers the "Sourced From" section
 * on the winery detail page.
 */
async function loadSourcedFrom(wineryId) {
  try {
    const { rows } = await pool.query(
      `SELECT
         vb.id            AS block_id,
         vb.block_name,
         vb.variety,
         vb.clone,
         vb.acres         AS block_acres,
         vb.year_planted,
         vp.id            AS parcel_id,
         vp.vineyard_name,
         vp.parcel_label,
         w.id             AS source_winery_id,
         w.recid          AS source_winery_recid,
         COALESCE(w.title, 'Independent vineyard') AS source_winery_name
       FROM vineyard_block_buyers bb
       JOIN vineyard_blocks vb   ON vb.id = bb.block_id
       JOIN vineyard_parcels vp  ON vp.id = vb.vineyard_parcel_id
       LEFT JOIN wineries w      ON w.id  = vp.winery_id
       WHERE bb.buyer_winery_id = $1
       ORDER BY source_winery_name, vp.parcel_label, vb.block_name`,
      [wineryId]
    );
    return rows;
  } catch (err) {
    console.error('loadSourcedFrom error:', err);
    return [];
  }
}

function parseBbox(bboxStr) {
  if (!bboxStr) return null;
  const parts = bboxStr.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return null;
  const [w, s, e, n] = parts;
  if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) return null;
  return parts;
}

export default router;
