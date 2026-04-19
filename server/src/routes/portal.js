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
    // ── Acreage-change flagging for geometry_update requests ──────────────
    // If the winery is submitting a new geometry, compute Δ% acreage and flag
    // if the change is ≥ 5 % (absolute).
    let flag = null;
    let flag_detail = null;

    if (request_type === 'geometry_update' && sanitizedPayload.new_geometry && target_id) {
      const { rows: acreRows } = await pool.query(
        `SELECT
           acres AS before_acres,
           ROUND((ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326)::geography) / 4046.856422)::numeric, 3) AS after_acres
         FROM vineyard_parcels WHERE id = $2`,
        [JSON.stringify(sanitizedPayload.new_geometry), target_id]
      );
      if (acreRows.length > 0) {
        const before = acreRows[0].before_acres != null ? Number(acreRows[0].before_acres) : null;
        const after  = acreRows[0].after_acres  != null ? Number(acreRows[0].after_acres)  : null;
        if (before != null && before > 0 && after != null) {
          const pct = Math.abs((after - before) / before) * 100;
          if (pct >= 5) {
            flag = 'acreage_change';
            flag_detail = { before_acres: before, after_acres: after, pct_change: Math.round(pct * 10) / 10 };
          }
        }
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO edit_requests (winery_id, account_id, request_type, target_id, payload, origin, flag, flag_detail)
       VALUES ($1, $2, $3, $4, $5, 'winery', $6, $7)
       RETURNING id, request_type, status, created_at`,
      [wineryId, accountId, request_type, target_id || null, JSON.stringify(sanitizedPayload),
       flag, flag_detail ? JSON.stringify(flag_detail) : null]
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

/**
 * GET /api/portal/vineyards/:id/history
 * Returns the audit trail + pending/rejected requests for a parcel owned by this winery.
 */
router.get('/vineyards/:id/history', async (req, res) => {
  const { wineryId } = req.portalAccount;
  const parcelId = parseInt(req.params.id, 10);
  if (isNaN(parcelId)) return res.status(400).json({ error: 'Invalid id' });

  try {
    // Verify the parcel belongs to this winery
    const { rows: check } = await pool.query(
      `SELECT id FROM vineyard_parcels WHERE id = $1 AND winery_id = $2`,
      [parcelId, wineryId]
    );
    if (check.length === 0) {
      return res.status(403).json({ error: 'Parcel not found or not linked to your winery' });
    }

    // Applied changes (audit log)
    const { rows: log } = await pool.query(
      `SELECT
         wel.id, wel.request_id, wel.field_name, wel.old_value, wel.new_value,
         wel.action, wel.edited_at, wel.entity_type, wel.entity_id,
         er.request_type, er.admin_notes,
         aa.display_name AS reviewed_by
       FROM winery_edit_log wel
       LEFT JOIN edit_requests er ON er.id = wel.request_id
       LEFT JOIN admin_accounts aa ON aa.id = wel.admin_id
       WHERE wel.entity_type = 'vineyard_parcel' AND wel.entity_id = $1
       ORDER BY wel.edited_at DESC`,
      [parcelId]
    );

    // All requests (any status) for this parcel
    const { rows: requests } = await pool.query(
      `SELECT
         er.id AS request_id, er.request_type, er.status,
         er.payload, er.admin_notes, er.created_at, er.reviewed_at,
         aa.display_name AS reviewed_by
       FROM edit_requests er
       LEFT JOIN admin_accounts aa ON aa.id = er.reviewed_by
       WHERE er.winery_id = $1 AND er.target_id = $2
       ORDER BY er.created_at DESC`,
      [wineryId, parcelId]
    );

    res.json({ log, requests });
  } catch (err) {
    console.error('Portal history error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
