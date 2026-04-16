import express from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool.js';

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
      const featureCategory = feature?.properties?.category || 'winery';
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
        category: feature?.properties?.category || 'winery',
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

    const categoryCondition = category
      ? `AND w.category = $${params.push(category)}`
      : '';

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
        ${categoryCondition}
        ${parcelsCondition}
      ORDER BY w.title
      `,
      params
    );

    res.json({
      type: 'FeatureCollection',
      features: rows.map((row) => ({
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
      },
      geometry: row.geometry,
    });
  } catch (err) {
    console.error('GET /api/wineries/:recid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function parseBbox(bboxStr) {
  if (!bboxStr) return null;
  const parts = bboxStr.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return null;
  const [w, s, e, n] = parts;
  if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) return null;
  return parts;
}

export default router;
