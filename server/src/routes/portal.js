/**
 * Portal routes — authenticated winery owner endpoints.
 * All routes require portalAuth middleware (attached in app.js).
 *
 * GET  /api/portal/profile                — winery profile + linked vineyards
 * POST /api/portal/requests               — submit an edit request
 * GET  /api/portal/requests               — list own requests
 * GET  /api/portal/vineyards              — vineyards linked to this winery
 * GET  /api/portal/vineyards/available     — unlinked parcels for claiming
 */
import express from 'express';
import { pool } from '../db/pool.js';

const router = express.Router();

// Allowed request types and the fields each one can propose changes to
const REQUEST_SCHEMAS = {
  profile: ['description', 'phone', 'url', 'image_url'],
  vineyard_varietals: ['varietals_list'],
  vineyard_blocks: ['block_name', 'variety', 'clone', 'rootstock', 'rows', 'spacing',
                     'vines_per_acre', 'vines', 'acres', 'year_planted',
                     'block_changes', 'new_blocks'],
  vineyard_claim: ['vineyard_name', 'notes'],
  vineyard_new: ['vineyard_name', 'notes', 'ava_name'],
  geometry_update: ['notes', 'geometry_description', 'old_geometry', 'new_geometry'],
};

/**
 * GET /api/portal/profile
 * Full winery profile with parcel count.
 */
router.get('/profile', async (req, res) => {
  const { wineryId } = req.portalAccount;

  try {
    const { rows } = await pool.query(
      `SELECT
         w.id, w.recid, w.title, w.description, w.phone, w.url,
         w.image_url, w.category,
         ST_AsGeoJSON(w.location)::json AS location,
         (SELECT COUNT(*) FROM vineyard_parcels vp WHERE vp.winery_id = w.id) AS parcel_count
       FROM wineries w
       WHERE w.id = $1`,
      [wineryId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Winery not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Portal profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/portal/vineyards
 * All vineyard parcels linked to this winery, with block details and topo stats.
 */
router.get('/vineyards', async (req, res) => {
  const { wineryId } = req.portalAccount;

  try {
    const { rows: parcels } = await pool.query(
      `SELECT
         vp.id, vp.vineyard_name, vp.vineyard_org, vp.owner_name,
         vp.ava_name, vp.nested_ava, vp.nested_nested_ava,
         vp.situs_address, vp.situs_city, vp.situs_zip,
         vp.acres, vp.varietals_list, vp.source_dataset,
         ST_AsGeoJSON(vp.geometry)::json AS geometry
       FROM vineyard_parcels vp
       WHERE vp.winery_id = $1
       ORDER BY vp.vineyard_name`,
      [wineryId]
    );

    // Fetch blocks for all parcels in one query
    const parcelIds = parcels.map((p) => p.id);
    let blocks = [];
    if (parcelIds.length > 0) {
      const { rows } = await pool.query(
        `SELECT
           vb.id, vb.vineyard_parcel_id, vb.vineyard_name, vb.block_name,
           vb.variety, vb.clone, vb.rootstock, vb.rows, vb.spacing,
           vb.vines_per_acre, vb.vines, vb.acres, vb.year_planted
         FROM vineyard_blocks vb
         WHERE vb.vineyard_parcel_id = ANY($1)
         ORDER BY vb.vineyard_name, vb.block_name`,
        [parcelIds]
      );
      blocks = rows;
    }

    // Fetch topo stats
    let topoStats = [];
    if (parcelIds.length > 0) {
      const { rows } = await pool.query(
        `SELECT parcel_id, elevation_min_ft, elevation_max_ft, elevation_mean_ft,
                slope_mean_deg, slope_max_deg, aspect_dominant_deg, aspect_mean_deg
         FROM vineyard_parcel_topo_stats
         WHERE parcel_id = ANY($1)`,
        [parcelIds]
      );
      topoStats = rows;
    }

    // Group blocks and topo by parcel
    const blocksByParcel = {};
    for (const b of blocks) {
      if (!blocksByParcel[b.vineyard_parcel_id]) blocksByParcel[b.vineyard_parcel_id] = [];
      blocksByParcel[b.vineyard_parcel_id].push(b);
    }
    const topoByParcel = {};
    for (const t of topoStats) {
      topoByParcel[t.parcel_id] = t;
    }

    const result = parcels.map((p) => ({
      ...p,
      blocks: blocksByParcel[p.id] || [],
      topo_stats: topoByParcel[p.id] || null,
    }));

    res.json(result);
  } catch (err) {
    console.error('Portal vineyards error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/portal/vineyards/available
 * Unlinked parcels that can be claimed. Supports bbox + search.
 */
router.get('/vineyards/available', async (req, res) => {
  const search = req.query.search || null;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  try {
    const params = [];
    let searchCondition = '';

    if (search) {
      params.push(`%${search}%`);
      searchCondition = `AND (vp.vineyard_name ILIKE $${params.length} OR vp.owner_name ILIKE $${params.length})`;
    }

    params.push(limit);

    const { rows } = await pool.query(
      `SELECT
         vp.id, vp.vineyard_name, vp.owner_name, vp.ava_name,
         vp.nested_ava, vp.acres, vp.situs_city,
         ST_AsGeoJSON(ST_Centroid(vp.geometry))::json AS centroid
       FROM vineyard_parcels vp
       WHERE vp.winery_id IS NULL
         ${searchCondition}
       ORDER BY vp.vineyard_name
       LIMIT $${params.length}`,
      params
    );

    res.json(rows);
  } catch (err) {
    console.error('Available vineyards error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/portal/requests
 * Submit an edit request.
 *
 * Body: {
 *   request_type: 'profile' | 'vineyard_varietals' | 'vineyard_blocks' |
 *                 'vineyard_claim' | 'vineyard_new' | 'geometry_update',
 *   target_id?: number,   // parcel or block id (required for vineyard/geometry edits)
 *   payload: { ...fields }
 * }
 */
router.post('/requests', async (req, res) => {
  const { accountId, wineryId } = req.portalAccount;
  const { request_type, target_id, payload } = req.body;

  // Validate request type
  if (!request_type || !REQUEST_SCHEMAS[request_type]) {
    return res.status(400).json({
      error: 'Invalid request_type',
      valid_types: Object.keys(REQUEST_SCHEMAS),
    });
  }

  // Validate payload is an object
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: 'payload must be an object' });
  }

  // Strip any fields not allowed for this request type
  const allowedFields = REQUEST_SCHEMAS[request_type];
  const sanitizedPayload = {};
  for (const key of allowedFields) {
    if (key in payload) {
      sanitizedPayload[key] = payload[key];
    }
  }

  if (Object.keys(sanitizedPayload).length === 0) {
    return res.status(400).json({
      error: 'No valid fields in payload',
      allowed_fields: allowedFields,
    });
  }

  // For vineyard edits, verify the parcel belongs to this winery
  if (['vineyard_varietals', 'vineyard_blocks', 'geometry_update'].includes(request_type)) {
    if (!target_id) {
      return res.status(400).json({ error: 'target_id is required for vineyard edits' });
    }

    const { rows } = await pool.query(
      `SELECT id FROM vineyard_parcels WHERE id = $1 AND winery_id = $2`,
      [target_id, wineryId]
    );
    if (rows.length === 0) {
      return res.status(403).json({ error: 'Parcel not found or not linked to your winery' });
    }
  }

  // For vineyard_claim, verify the parcel exists and is unlinked
  if (request_type === 'vineyard_claim') {
    if (!target_id) {
      return res.status(400).json({ error: 'target_id is required for vineyard claims' });
    }

    const { rows } = await pool.query(
      `SELECT id, winery_id FROM vineyard_parcels WHERE id = $1`,
      [target_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Parcel not found' });
    }
    if (rows[0].winery_id != null) {
      return res.status(409).json({ error: 'This parcel is already linked to a winery' });
    }
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO edit_requests (winery_id, account_id, request_type, target_id, payload)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, request_type, status, created_at`,
      [wineryId, accountId, request_type, target_id || null, JSON.stringify(sanitizedPayload)]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Submit request error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/portal/requests
 * List the winery's own edit requests.
 */
router.get('/requests', async (req, res) => {
  const { wineryId } = req.portalAccount;
  const status = req.query.status || null;

  try {
    const params = [wineryId];
    let statusFilter = '';
    if (status) {
      params.push(status);
      statusFilter = `AND er.status = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT
         er.id, er.request_type, er.target_id, er.payload,
         er.status, er.admin_notes, er.reviewed_at, er.created_at
       FROM edit_requests er
       WHERE er.winery_id = $1 ${statusFilter}
       ORDER BY er.created_at DESC
       LIMIT 100`,
      params
    );

    res.json(rows);
  } catch (err) {
    console.error('List requests error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
