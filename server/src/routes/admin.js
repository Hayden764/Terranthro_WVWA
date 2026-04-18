/**
 * Admin routes — manage winery accounts, review edit requests, admin accounts.
 * All routes require adminAuth middleware (attached in app.js).
 *
 * POST /api/admin/login                       — admin login (email + password)
 * POST /api/admin/logout                      — clear admin cookie
 * GET  /api/admin/me                          — current admin info
 *
 * GET  /api/admin/requests                    — list edit requests (filterable)
 * POST /api/admin/requests/:id/approve        — approve and apply a request
 * POST /api/admin/requests/:id/reject         — reject a request
 *
 * GET  /api/admin/accounts                    — list winery accounts
 * POST /api/admin/accounts                    — create a winery account
 * DELETE /api/admin/accounts/:id              — remove a winery account
 *
 * POST /api/admin/admins                      — create an admin account (superadmin only)
 * GET  /api/admin/admins                      — list admin accounts (superadmin only)
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { signAdminToken, requireAdminAuth, requireSuperadmin } from '../middleware/adminAuth.js';

const router = express.Router();

// ─── Public admin routes (no auth required) ──────────────────────

/**
 * POST /api/admin/login
 * Body: { email, password }
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, display_name, role FROM admin_accounts WHERE LOWER(email) = $1`,
      [email.trim().toLowerCase()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const admin = rows[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last_login
    await pool.query(`UPDATE admin_accounts SET last_login = NOW() WHERE id = $1`, [admin.id]);

    const jwt = signAdminToken(admin.id, admin.email, admin.role);
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('admin_token', jwt, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({ success: true, display_name: admin.display_name, role: admin.role });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/logout', (_req, res) => {
  res.clearCookie('admin_token', { path: '/' });
  res.json({ success: true });
});

// ─── All routes below require admin auth ─────────────────────────

router.use(requireAdminAuth);

router.get('/me', (req, res) => {
  res.json(req.adminAccount);
});

// ─── Edit requests ───────────────────────────────────────────────

/**
 * GET /api/admin/requests
 * Query: ?status=pending|approved|rejected  &type=profile|vineyard_claim|...
 */
router.get('/requests', async (req, res) => {
  const status = req.query.status || null;
  const type = req.query.type || null;

  try {
    const params = [];
    const conditions = [];

    if (status) {
      params.push(status);
      conditions.push(`er.status = $${params.length}`);
    }
    if (type) {
      params.push(type);
      conditions.push(`er.request_type = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT
         er.id, er.winery_id, er.account_id, er.request_type,
         er.target_id, er.payload, er.status, er.admin_notes,
         er.reviewed_at, er.created_at,
         w.title AS winery_name,
         wa.contact_email,
         aa.display_name AS reviewed_by_name
       FROM edit_requests er
       JOIN wineries w ON w.id = er.winery_id
       JOIN winery_accounts wa ON wa.id = er.account_id
       LEFT JOIN admin_accounts aa ON aa.id = er.reviewed_by
       ${where}
       ORDER BY er.created_at DESC
       LIMIT 200`,
      params
    );

    res.json(rows);
  } catch (err) {
    console.error('Admin list requests error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/admin/requests/:id/approve
 * Body: { admin_notes?: string }
 *
 * Approves the request and applies the changes to the database.
 */
router.post('/requests/:id/approve', async (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const { admin_notes } = req.body;
  const { adminId } = req.adminAccount;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the request row
    const { rows } = await client.query(
      `SELECT * FROM edit_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }

    const request = rows[0];

    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Request is already ${request.status}` });
    }

    const payload = request.payload;

    // Apply the change based on type
    switch (request.request_type) {
      case 'profile': {
        const allowedCols = ['description', 'phone', 'url', 'image_url'];
        const sets = [];
        const vals = [];
        for (const col of allowedCols) {
          if (col in payload) {
            vals.push(payload[col]);
            sets.push(`${col} = $${vals.length}`);
          }
        }
        if (sets.length > 0) {
          vals.push(request.winery_id);
          // Log old values
          const { rows: old } = await client.query(
            `SELECT description, phone, url, image_url FROM wineries WHERE id = $1`,
            [request.winery_id]
          );
          await client.query(
            `UPDATE wineries SET ${sets.join(', ')} WHERE id = $${vals.length}`,
            vals
          );
          // Audit log
          for (const col of allowedCols) {
            if (col in payload && old[0]) {
              await client.query(
                `INSERT INTO winery_edit_log
                   (winery_id, account_id, admin_id, request_id, table_name, record_id, field_name, old_value, new_value)
                 VALUES ($1, $2, $3, $4, 'wineries', $5, $6, $7, $8)`,
                [request.winery_id, request.account_id, adminId, requestId,
                 request.winery_id, col, old[0][col], payload[col]]
              );
            }
          }
        }
        break;
      }

      case 'vineyard_varietals': {
        if (payload.varietals_list != null && request.target_id) {
          const { rows: old } = await client.query(
            `SELECT varietals_list FROM vineyard_parcels WHERE id = $1`,
            [request.target_id]
          );
          await client.query(
            `UPDATE vineyard_parcels SET varietals_list = $1 WHERE id = $2 AND winery_id = $3`,
            [payload.varietals_list, request.target_id, request.winery_id]
          );
          if (old[0]) {
            await client.query(
              `INSERT INTO winery_edit_log
                 (winery_id, account_id, admin_id, request_id, table_name, record_id, field_name, old_value, new_value)
               VALUES ($1, $2, $3, $4, 'vineyard_parcels', $5, 'varietals_list', $6, $7)`,
              [request.winery_id, request.account_id, adminId, requestId,
               request.target_id, old[0].varietals_list, payload.varietals_list]
            );
          }
        }
        break;
      }

      case 'vineyard_claim': {
        if (request.target_id) {
          await client.query(
            `UPDATE vineyard_parcels SET winery_id = $1 WHERE id = $2 AND winery_id IS NULL`,
            [request.winery_id, request.target_id]
          );
          await client.query(
            `INSERT INTO winery_edit_log
               (winery_id, account_id, admin_id, request_id, table_name, record_id, field_name, old_value, new_value, action)
             VALUES ($1, $2, $3, $4, 'vineyard_parcels', $5, 'winery_id', NULL, $6, 'update')`,
            [request.winery_id, request.account_id, adminId, requestId,
             request.target_id, String(request.winery_id)]
          );
        }
        break;
      }

      // vineyard_blocks, vineyard_new: no auto-apply, admin handles manually.
      case 'vineyard_blocks':
      case 'vineyard_new':
        break;

      case 'geometry_update': {
        // If the payload contains new_geometry (GeoJSON), apply it now.
        if (payload.new_geometry && request.target_id) {
          const geomType = payload.new_geometry.type;
          if (!['Polygon', 'MultiPolygon'].includes(geomType)) {
            await client.query('ROLLBACK');
            return res.status(422).json({ error: `Invalid geometry type: ${geomType}` });
          }
          const { rows: oldGeom } = await client.query(
            `SELECT ST_AsGeoJSON(geometry)::json AS geometry FROM vineyard_parcels WHERE id = $1`,
            [request.target_id]
          );
          await client.query(
            `UPDATE vineyard_parcels
             SET geometry = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                 acres = ROUND((ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography) / 4046.856422)::numeric, 3)
             WHERE id = $2 AND winery_id = $3`,
            [JSON.stringify(payload.new_geometry), request.target_id, request.winery_id]
          );
          await client.query(
            `INSERT INTO winery_edit_log
               (winery_id, account_id, admin_id, request_id, table_name, record_id, field_name, old_value, new_value)
             VALUES ($1, $2, $3, $4, 'vineyard_parcels', $5, 'geometry', $6, $7)`,
            [request.winery_id, request.account_id, adminId, requestId,
             request.target_id,
             oldGeom[0] ? JSON.stringify(oldGeom[0].geometry) : null,
             JSON.stringify(payload.new_geometry)]
          );
        }
        break;
      }

      default:
        break;
    }

    // Mark request as approved
    await client.query(
      `UPDATE edit_requests
       SET status = 'approved', admin_notes = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3`,
      [admin_notes || null, adminId, requestId]
    );

    await client.query('COMMIT');
    res.json({ success: true, status: 'approved' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Approve request error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/admin/requests/:id/reject
 * Body: { admin_notes?: string }
 */
router.post('/requests/:id/reject', async (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const { admin_notes } = req.body;
  const { adminId } = req.adminAccount;

  try {
    const { rows } = await pool.query(
      `UPDATE edit_requests
       SET status = 'rejected', admin_notes = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING id, status`,
      [admin_notes || null, adminId, requestId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Request not found or already processed' });
    }

    res.json({ success: true, status: 'rejected' });
  } catch (err) {
    console.error('Reject request error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Single request detail ───────────────────────────────────────

/**
 * GET /api/admin/requests/:id
 * Returns a single edit request by ID.
 */
router.get('/requests/:id', async (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  if (isNaN(requestId)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const { rows } = await pool.query(
      `SELECT
         er.id, er.winery_id, er.account_id, er.request_type,
         er.target_id, er.payload, er.status, er.admin_notes,
         er.reviewed_at, er.created_at,
         w.title AS winery_name,
         wa.contact_email,
         aa.display_name AS reviewed_by_name
       FROM edit_requests er
       JOIN wineries w ON w.id = er.winery_id
       JOIN winery_accounts wa ON wa.id = er.account_id
       LEFT JOIN admin_accounts aa ON aa.id = er.reviewed_by
       WHERE er.id = $1`,
      [requestId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const request = rows[0];

    // If there's a target_id, fetch the current parcel geometry for map context
    if (request.target_id) {
      const { rows: parcelRows } = await pool.query(
        `SELECT vineyard_name, acres, ava_name,
                ST_AsGeoJSON(geometry)::json AS geometry
         FROM vineyard_parcels WHERE id = $1`,
        [request.target_id]
      );
      if (parcelRows.length > 0) {
        request.parcel = parcelRows[0];
      }
    }

    res.json(request);
  } catch (err) {
    console.error('Admin get request error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Winery accounts management ─────────────────────────────────

/**
 * GET /api/admin/accounts
 * List all winery portal accounts.
 */
router.get('/accounts', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         wa.id, wa.winery_id, wa.contact_email, wa.email_verified,
         wa.last_login, wa.created_at,
         w.title AS winery_name
       FROM winery_accounts wa
       JOIN wineries w ON w.id = wa.winery_id
       ORDER BY w.title`
    );
    res.json(rows);
  } catch (err) {
    console.error('List accounts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/admin/accounts
 * Body: { winery_id: number, contact_email: string }
 */
router.post('/accounts', async (req, res) => {
  const { winery_id, contact_email } = req.body;

  if (!winery_id || !contact_email) {
    return res.status(400).json({ error: 'winery_id and contact_email are required' });
  }

  const email = contact_email.trim().toLowerCase();

  try {
    // Verify winery exists
    const { rows: w } = await pool.query(`SELECT id FROM wineries WHERE id = $1`, [winery_id]);
    if (w.length === 0) {
      return res.status(404).json({ error: 'Winery not found' });
    }

    const { rows } = await pool.query(
      `INSERT INTO winery_accounts (winery_id, contact_email)
       VALUES ($1, $2)
       ON CONFLICT (winery_id) DO UPDATE SET contact_email = $2
       RETURNING id, winery_id, contact_email, created_at`,
      [winery_id, email]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505' && err.constraint?.includes('contact_email')) {
      return res.status(409).json({ error: 'This email is already associated with another winery' });
    }
    console.error('Create account error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/admin/accounts/:id
 */
router.delete('/accounts/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM winery_accounts WHERE id = $1`,
      [id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Admin accounts management (superadmin only) ─────────────────

/**
 * GET /api/admin/admins
 */
router.get('/admins', requireSuperadmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, display_name, role, last_login, created_at
       FROM admin_accounts
       ORDER BY created_at`
    );
    res.json(rows);
  } catch (err) {
    console.error('List admins error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/admin/admins
 * Body: { email, password, display_name, role?: 'admin' | 'superadmin' }
 */
router.post('/admins', requireSuperadmin, async (req, res) => {
  const { email, password, display_name, role } = req.body;

  if (!email || !password || !display_name) {
    return res.status(400).json({ error: 'email, password, and display_name are required' });
  }

  if (password.length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters' });
  }

  const validRoles = ['admin', 'superadmin'];
  const adminRole = validRoles.includes(role) ? role : 'admin';

  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO admin_accounts (email, password_hash, display_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, display_name, role, created_at`,
      [email.trim().toLowerCase(), hash, display_name, adminRole]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    console.error('Create admin error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
