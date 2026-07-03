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
 * POST /api/admin/accounts/:id/password       — set/reset winery account password (superadmin)
 * DELETE /api/admin/accounts/:id              — remove a winery account
 *
 * POST /api/admin/admins                      — create an admin account (superadmin only)
 * GET  /api/admin/admins                      — list admin accounts (superadmin only)
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { signAdminToken, requireAdminAuth, requireSuperadmin } from '../middleware/adminAuth.js';
import { bulkApplyBlocks } from '../services/blockBulkApply.js';
import { logAuthEvent } from '../services/authActivity.js';

const router = express.Router();

// ─── Public admin routes (no auth required) ──────────────────────

/**
 * POST /api/admin/login
 * Body: { email, password }
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, display_name, role FROM admin_accounts WHERE LOWER(email) = $1`,
      [normalizedEmail]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const admin = rows[0];
    // If a row has a malformed or missing hash, fail closed instead of throwing.
    const storedHash = typeof admin.password_hash === 'string' ? admin.password_hash : '';
    if (!storedHash.startsWith('$2')) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    let valid = false;
    try {
      valid = await bcrypt.compare(password, storedHash);
    } catch {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

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
      maxAge: 12 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({ success: true, display_name: admin.display_name, role: admin.role });
  } catch (err) {
    console.error('Admin login error:', err);

    if (err?.code === '42P01') {
      return res.status(503).json({ error: 'Admin auth is not initialized (missing admin_accounts table)' });
    }

    if (err?.message?.includes('ADMIN_JWT_SECRET')) {
      return res.status(503).json({ error: 'Admin auth is not configured on the server' });
    }

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
  const flag = req.query.flag || null;

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
    if (flag) {
      params.push(flag);
      conditions.push(`er.flag = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT
         er.id, er.winery_id, er.account_id, er.request_type,
         er.target_id, er.payload, er.status, er.admin_notes,
         er.reviewed_at, er.created_at,
         er.origin, er.flag, er.flag_detail,
         COALESCE(w.title, 'Independent vineyard') AS winery_name,
         wa.contact_email,
         aa.display_name AS reviewed_by_name,
         sa.display_name AS submitted_by_admin_name
       FROM edit_requests er
       LEFT JOIN wineries w ON w.id = er.winery_id
       LEFT JOIN winery_accounts wa ON wa.id = er.account_id
       LEFT JOIN admin_accounts aa ON aa.id = er.reviewed_by
       LEFT JOIN admin_accounts sa ON sa.id = er.submitted_by_admin
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
 * Body: { admin_notes?: string, ops_override?: Op[] }
 *
 * Approves the request and applies the changes to the database.
 * For admin_batch_edit requests, ops_override (if provided) replaces payload.ops,
 * allowing the reviewing admin to exclude or edit individual ops before applying.
 */
router.post('/requests/:id/approve', async (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const { admin_notes, ops_override } = req.body;
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
                   (winery_id, account_id, admin_id, request_id,
                    table_name, record_id, field_name, old_value, new_value,
                    entity_type, entity_id)
                 VALUES ($1, $2, $3, $4, 'wineries', $5, $6, $7, $8, 'winery', $5)`,
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
                 (winery_id, account_id, admin_id, request_id,
                  table_name, record_id, field_name, old_value, new_value,
                  entity_type, entity_id)
               VALUES ($1, $2, $3, $4, 'vineyard_parcels', $5, 'varietals_list', $6, $7,
                       'vineyard_parcel', $5)`,
              [request.winery_id, request.account_id, adminId, requestId,
               request.target_id, old[0].varietals_list, payload.varietals_list]
            );
          }
        }
        break;
      }

      case 'vineyard_rename': {
        const newName = typeof payload.vineyard_name === 'string'
          ? payload.vineyard_name.trim()
          : '';
        if (newName && request.target_id) {
          // Rename the whole vineyard group: the target parcel plus every
          // sibling parcel sharing its (vineyard_name, winery_id). Keeps the
          // denormalized vineyard_blocks.vineyard_name in sync.
          const { rows: srcRows } = await client.query(
            `SELECT vineyard_name FROM vineyard_parcels WHERE id = $1 AND winery_id = $2`,
            [request.target_id, request.winery_id]
          );
          if (srcRows[0]) {
            const oldName = srcRows[0].vineyard_name;
            const { rows: siblings } = await client.query(
              `SELECT id FROM vineyard_parcels
               WHERE winery_id = $1 AND vineyard_name IS NOT DISTINCT FROM $2`,
              [request.winery_id, oldName]
            );
            for (const sib of siblings) {
              await client.query(
                `UPDATE vineyard_parcels SET vineyard_name = $1 WHERE id = $2`,
                [newName, sib.id]
              );
              await client.query(
                `UPDATE vineyard_blocks SET vineyard_name = $1 WHERE vineyard_parcel_id = $2`,
                [newName, sib.id]
              );
              await client.query(
                `INSERT INTO winery_edit_log
                   (winery_id, account_id, admin_id, request_id,
                    table_name, record_id, field_name, old_value, new_value,
                    entity_type, entity_id)
                 VALUES ($1, $2, $3, $4, 'vineyard_parcels', $5, 'vineyard_name', $6, $7,
                         'vineyard_parcel', $5)`,
                [request.winery_id, request.account_id, adminId, requestId,
                 sib.id, oldName, newName]
              );
            }
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
               (winery_id, account_id, admin_id, request_id,
                table_name, record_id, field_name, old_value, new_value, action,
                entity_type, entity_id)
             VALUES ($1, $2, $3, $4, 'vineyard_parcels', $5, 'winery_id', NULL, $6, 'update',
                     'vineyard_parcel', $5)`,
            [request.winery_id, request.account_id, adminId, requestId,
             request.target_id, String(request.winery_id)]
          );
        }
        break;
      }

      case 'vineyard_blocks': {
        const blockChanges = Array.isArray(payload.block_changes) ? payload.block_changes : [];
        const newBlocks    = Array.isArray(payload.new_blocks)    ? payload.new_blocks    : [];
        const allowedBlockCols = ['block_name', 'variety', 'clone', 'rootstock',
                                  'rows', 'spacing', 'year_planted', 'notes'];

        // Apply field-level changes to existing blocks
        for (const change of blockChanges) {
          if (!change.id || !Array.isArray(change.field_changes)) continue;
          for (const fc of change.field_changes) {
            if (!allowedBlockCols.includes(fc.field)) continue;
            await client.query(
              `UPDATE vineyard_blocks SET ${fc.field} = $1 WHERE id = $2`,
              [fc.new ?? null, change.id]
            );
            await client.query(
              `INSERT INTO winery_edit_log
                 (winery_id, account_id, admin_id, request_id,
                  table_name, record_id, field_name, old_value, new_value,
                  entity_type, entity_id)
               VALUES ($1, $2, $3, $4, 'vineyard_blocks', $5, $6, $7, $8,
                       'vineyard_block', $5)`,
              [request.winery_id, request.account_id, adminId, requestId,
               change.id, fc.field,
               fc.old != null ? String(fc.old) : null,
               fc.new != null ? String(fc.new) : null]
            );
            // Also log against the parent parcel for easy parcel-level history
            if (request.target_id) {
              await client.query(
                `INSERT INTO winery_edit_log
                   (winery_id, account_id, admin_id, request_id,
                    table_name, record_id, field_name, old_value, new_value,
                    entity_type, entity_id)
                 VALUES ($1, $2, $3, $4, 'vineyard_blocks', $5, $6, $7, $8,
                         'vineyard_parcel', $9)`,
                [request.winery_id, request.account_id, adminId, requestId,
                 change.id, `block.${fc.field}`,
                 fc.old != null ? String(fc.old) : null,
                 fc.new != null ? String(fc.new) : null,
                 request.target_id]
              );
            }
          }
        }

        // Insert new blocks
        for (const nb of newBlocks) {
          const cols = allowedBlockCols.filter((c) => nb[c] != null);
          if (cols.length === 0 || !request.target_id) continue;
          const vals = cols.map((c) => nb[c]);
          const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
          const { rows: inserted } = await client.query(
            `INSERT INTO vineyard_blocks (vineyard_parcel_id, vineyard_name, ${cols.join(', ')})
             VALUES ($1, (SELECT vineyard_name FROM vineyard_parcels WHERE id = $1), ${placeholders})
             RETURNING id`,
            [request.target_id, ...vals]
          );
          const newId = inserted[0]?.id;
          if (newId) {
            await client.query(
              `INSERT INTO winery_edit_log
                 (winery_id, account_id, admin_id, request_id,
                  table_name, record_id, action,
                  entity_type, entity_id)
               VALUES ($1, $2, $3, $4, 'vineyard_blocks', $5, 'insert',
                       'vineyard_parcel', $6)`,
              [request.winery_id, request.account_id, adminId, requestId,
               newId, request.target_id]
            );
          }
        }
        break;
      }

      // vineyard_new: no auto-apply, admin creates the parcel manually.
      case 'vineyard_new':
        break;

      // ── vineyard_blocks_bulk ─────────────────────────────────────────
      // Portal-submitted CSV upload. Payload: { rows, column_map }.
      case 'vineyard_blocks_bulk': {
        if (!request.winery_id) break;
        const result = await bulkApplyBlocks({
          client,
          wineryId: request.winery_id,
          rows: Array.isArray(payload.rows) ? payload.rows : [],
          columnMap: payload.column_map || {},
          adminId,
          accountId: request.account_id,
          requestId,
          origin: 'portal',
        });
        // Attach result summary onto the audit chain via admin_notes append later.
        // Re-flag if bulk import produced an acreage flag.
        if (result.flagged_parcels.length > 0) {
          const top = result.flagged_parcels.reduce((a, b) => (b.pct_change > a.pct_change ? b : a));
          await client.query(
            `UPDATE edit_requests SET flag = 'acreage_change', flag_detail = $1 WHERE id = $2`,
            [JSON.stringify(top), requestId]
          );
        }
        break;
      }

      // ── admin_batch_edit ─────────────────────────────────────────────
      // Each op in payload.ops is applied sequentially.
      // ops_override (from request body) replaces payload.ops when provided,
      // allowing the reviewing admin to edit or exclude individual ops.
      // ops: [ { op: 'geometry'|'metadata'|'add'|'delete', parcel_id, geometry?, fields? }, ... ]
      case 'admin_batch_edit': {
        const rawOps = ops_override != null ? ops_override : (Array.isArray(payload.ops) ? payload.ops : []);
        const ops = Array.isArray(rawOps) ? rawOps : [];
        const ALLOWED_META = [
          'vineyard_name', 'vineyard_org', 'owner_name', 'ava_name',
          'nested_ava', 'nested_nested_ava', 'situs_address', 'situs_city',
          'situs_zip', 'acres', 'varietals_list', 'source_dataset', 'winery_id',
        ];

        for (const opItem of ops) {
          const { op, parcel_id } = opItem;
          if (!parcel_id || isNaN(parseInt(parcel_id, 10))) continue;
          const pid = parseInt(parcel_id, 10);

          if (op === 'geometry' && opItem.geometry) {
            const geomType = opItem.geometry.type;
            if (!['Polygon', 'MultiPolygon'].includes(geomType)) continue;

            const { rows: oldRow } = await client.query(
              `SELECT ST_AsGeoJSON(geometry)::json AS geom, acres, winery_id FROM vineyard_parcels WHERE id = $1`,
              [pid]
            );
            if (oldRow.length === 0) continue;
            const logWineryId = oldRow[0].winery_id ?? request.winery_id;

            await client.query(
              `UPDATE vineyard_parcels
               SET geometry = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                   acres = ROUND((ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography) / 4046.856422)::numeric, 3)
               WHERE id = $2`,
              [JSON.stringify(opItem.geometry), pid]
            );
            await client.query(
              `INSERT INTO winery_edit_log
                 (winery_id, admin_id, request_id, table_name, record_id, field_name,
                  old_value, new_value, entity_type, entity_id)
               VALUES ($1, $2, $3, 'vineyard_parcels', $4, 'geometry', $5, $6, 'vineyard_parcel', $4)`,
              [logWineryId, adminId, requestId,
               pid,
               oldRow[0].geom ? JSON.stringify(oldRow[0].geom) : null,
               JSON.stringify(opItem.geometry)]
            );

          } else if (op === 'metadata' && opItem.fields && typeof opItem.fields === 'object') {
            const updates = {};
            for (const col of ALLOWED_META) {
              if (Object.prototype.hasOwnProperty.call(opItem.fields, col)) {
                updates[col] = opItem.fields[col] === '' ? null : opItem.fields[col];
              }
            }
            if (Object.keys(updates).length === 0) continue;

            const { rows: oldMeta } = await client.query(
              `SELECT winery_id, ${Object.keys(updates).join(', ')} FROM vineyard_parcels WHERE id = $1`,
              [pid]
            );
            const logWineryId = oldMeta[0]?.winery_id ?? request.winery_id;

            const setClauses = Object.keys(updates).map((col, i) => `${col} = $${i + 1}`);
            const vals = [...Object.values(updates), pid];
            await client.query(
              `UPDATE vineyard_parcels SET ${setClauses.join(', ')} WHERE id = $${vals.length}`,
              vals
            );

            if (oldMeta.length > 0) {
              for (const col of Object.keys(updates)) {
                await client.query(
                  `INSERT INTO winery_edit_log
                     (winery_id, admin_id, request_id, table_name, record_id, field_name,
                      old_value, new_value, entity_type, entity_id)
                   VALUES ($1, $2, $3, 'vineyard_parcels', $4, $5, $6, $7, 'vineyard_parcel', $4)`,
                  [logWineryId, adminId, requestId, pid, col,
                   oldMeta[0][col] != null ? String(oldMeta[0][col]) : null,
                   updates[col]    != null ? String(updates[col])    : null]
                );
              }
            }
          } else if (op === 'add' && opItem.geometry) {
            const geomType = opItem.geometry.type;
            if (!['Polygon', 'MultiPolygon'].includes(geomType)) continue;
            const wineryId = opItem.winery_id ? parseInt(opItem.winery_id, 10) : request.winery_id;

            const fields = opItem.fields || {};
            const sanitized = {};
            for (const col of ALLOWED_META) {
              sanitized[col] = Object.prototype.hasOwnProperty.call(fields, col)
                ? (fields[col] === '' ? null : fields[col])
                : null;
            }

            const { rows: newParcel } = await client.query(
              `INSERT INTO vineyard_parcels
                 (winery_id, geometry, acres, vineyard_name, vineyard_org, owner_name,
                  ava_name, nested_ava, nested_nested_ava, situs_address, situs_city,
                  situs_zip, varietals_list, source_dataset)
               VALUES ($1,
                 ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
                 ROUND((ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography) / 4046.856422)::numeric, 3),
                 $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
               RETURNING id`,
              [wineryId, JSON.stringify(opItem.geometry),
               sanitized.vineyard_name, sanitized.vineyard_org, sanitized.owner_name,
               sanitized.ava_name, sanitized.nested_ava, sanitized.nested_nested_ava,
               sanitized.situs_address, sanitized.situs_city, sanitized.situs_zip,
               sanitized.varietals_list, sanitized.source_dataset]
            );
            await client.query(
              `INSERT INTO winery_edit_log
                 (winery_id, admin_id, request_id, table_name, record_id, field_name,
                  old_value, new_value, entity_type, entity_id)
               VALUES ($1, $2, $3, 'vineyard_parcels', $4, 'add', NULL,
                 $5, 'vineyard_parcel', $4)`,
              [wineryId, adminId, requestId, newParcel[0].id,
               JSON.stringify({ parcel_name: sanitized.vineyard_name, winery_id: wineryId })]
            );

          } else if (op === 'delete') {
            const { rows: toDelete } = await client.query(
              `SELECT vineyard_name, winery_id FROM vineyard_parcels WHERE id = $1`,
              [pid]
            );
            if (toDelete.length === 0) continue;
            const delWineryId = toDelete[0].winery_id ?? request.winery_id;
            await client.query(`DELETE FROM vineyard_parcels WHERE id = $1`, [pid]);
            await client.query(
              `INSERT INTO winery_edit_log
                 (winery_id, admin_id, request_id, table_name, record_id, field_name,
                  old_value, new_value, entity_type, entity_id)
               VALUES ($1, $2, $3, 'vineyard_parcels', $4, 'delete',
                 $5, NULL, 'vineyard_parcel', $4)`,
              [delWineryId, adminId, requestId, pid,
               JSON.stringify({ parcel_name: toDelete[0].vineyard_name, winery_id: delWineryId })]
            );
          }
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

// ─── Admin batch edit submit ─────────────────────────────────────

/**
 * POST /api/admin/requests/batch
 *
 * Submits a batch of admin-authored parcel edits as a single edit_requests row
 * of type 'admin_batch_edit' so it appears in the approval queue for a second
 * review pass.
 *
 * Body: {
 *   winery_id?: number|null,    — optional for independent parcels
 *   ops: [
 *     { op: 'geometry', parcel_id: number, geometry: GeoJSON,
 *       before_geom?: GeoJSON, before_acres?: number, after_acres?: number },
 *     { op: 'metadata', parcel_id: number, fields: { ...cols }, before: { ...cols } },
 *   ]
 * }
 */
router.post('/requests/batch', async (req, res) => {
  const { adminId } = req.adminAccount;
  const { winery_id, ops } = req.body;

  if (!Array.isArray(ops) || ops.length === 0) {
    return res.status(400).json({ error: 'A non-empty ops array is required' });
  }

  let wineryIdInt = null;
  if (winery_id != null && winery_id !== '') {
    wineryIdInt = parseInt(winery_id, 10);
    if (isNaN(wineryIdInt)) return res.status(400).json({ error: 'Invalid winery_id' });

    // Validate winery exists when provided
    const { rows: wineryRows } = await pool.query(
      `SELECT id FROM wineries WHERE id = $1`, [wineryIdInt]
    );
    if (wineryRows.length === 0) return res.status(404).json({ error: 'Winery not found' });
  }

  // ── Enrich geometry ops with server-computed acres ────────────────────────
  // after_acres: PostGIS ST_Area on the submitted geometry (authoritative)
  // before_acres: fetched from DB to ensure accuracy
  const enrichedOps = await Promise.all(ops.map(async (op) => {
    if (op.op !== 'geometry' || !op.geometry) return op;

    const [afterRes, beforeRes] = await Promise.all([
      pool.query(
        `SELECT ROUND((ST_Area(ST_GeomFromGeoJSON($1)::geography) / 4046.856422)::numeric, 3) AS after_acres`,
        [JSON.stringify(op.geometry)]
      ),
      pool.query(
        `SELECT ROUND(COALESCE(acres, 0)::numeric, 3) AS before_acres FROM vineyard_parcels WHERE id = $1`,
        [op.parcel_id]
      ),
    ]);

    return {
      ...op,
      before_acres: beforeRes.rows[0]?.before_acres ?? op.before_acres,
      after_acres: afterRes.rows[0]?.after_acres ?? null,
    };
  }));

  // ── Compute acreage flag across all geometry ops ─────────────────────────
  let flag = null;
  let flag_detail = null;

  for (const opItem of enrichedOps) {
    if (opItem.op !== 'geometry') continue;
    const before = opItem.before_acres != null ? Number(opItem.before_acres) : null;
    const after  = opItem.after_acres  != null ? Number(opItem.after_acres)  : null;
    if (before != null && before > 0 && after != null) {
      const pct = Math.abs((after - before) / before) * 100;
      if (pct >= 5) {
        // Flag on the most significant change if multiple ops qualify
        if (flag_detail === null || pct > flag_detail.pct_change) {
          flag = 'acreage_change';
          flag_detail = {
            parcel_id: opItem.parcel_id,
            before_acres: before,
            after_acres: after,
            pct_change: Math.round(pct * 10) / 10,
          };
        }
      }
    }
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO edit_requests
         (winery_id, request_type, payload, origin, submitted_by_admin, flag, flag_detail)
       VALUES ($1, 'admin_batch_edit', $2, 'admin', $3, $4, $5)
       RETURNING id, request_type, status, created_at`,
      [wineryIdInt, JSON.stringify({ ops: enrichedOps }), adminId,
       flag, flag_detail ? JSON.stringify(flag_detail) : null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Admin batch submit error:', err);
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
         er.origin, er.flag, er.flag_detail,
         COALESCE(w.title, 'Independent vineyard') AS winery_name,
         wa.contact_email,
         aa.display_name AS reviewed_by_name,
         sa.display_name AS submitted_by_admin_name
       FROM edit_requests er
       LEFT JOIN wineries w ON w.id = er.winery_id
       LEFT JOIN winery_accounts wa ON wa.id = er.account_id
       LEFT JOIN admin_accounts aa ON aa.id = er.reviewed_by
       LEFT JOIN admin_accounts sa ON sa.id = er.submitted_by_admin
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
         (wa.password_hash IS NOT NULL) AS has_password,
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

    await logAuthEvent({
      accountId: rows[0].id,
      wineryId: rows[0].winery_id,
      identifier: rows[0].contact_email,
      actorAdminId: req.adminAccount.adminId,
      eventType: 'admin_account_created',
      success: true,
      details: { source: 'admin_console' },
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
    });

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
 * POST /api/admin/accounts/:id/password
 * Body: { password: string, temporary?: boolean }
 *
 * Superadmin-only endpoint for setting or resetting a winery portal account password.
 */
router.post('/accounts/:id/password', requireSuperadmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { password, temporary } = req.body ?? {};

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Valid account id is required' });
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const hasPasswordFlags = await hasWineryAccountPasswordFlags();
    const hash = await bcrypt.hash(password, 12);

    const updateSql = hasPasswordFlags
      ? `UPDATE winery_accounts
         SET password_hash = $1,
             password_must_change = $3,
             password_last_changed_at = NOW()
         WHERE id = $2
         RETURNING id, winery_id, contact_email`
      : `UPDATE winery_accounts
         SET password_hash = $1
         WHERE id = $2
         RETURNING id, winery_id, contact_email`;

    const updateParams = hasPasswordFlags
      ? [hash, id, Boolean(temporary)]
      : [hash, id];

    const { rows } = await pool.query(
      updateSql,
      updateParams
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    await logAuthEvent({
      accountId: rows[0].id,
      wineryId: rows[0].winery_id,
      identifier: rows[0].contact_email,
      actorAdminId: req.adminAccount.adminId,
      eventType: temporary ? 'admin_password_reset_temporary' : 'admin_password_reset',
      success: true,
      details: { temporary: Boolean(temporary) },
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    res.json({
      success: true,
      account: rows[0],
      temporary: Boolean(temporary),
      message: temporary
        ? 'Temporary password set successfully.'
        : 'Password updated successfully.',
    });
  } catch (err) {
    console.error('Set winery account password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/admin/accounts/:id
 */
router.delete('/accounts/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const { rows: accountRows } = await pool.query(
      `SELECT wa.id, wa.winery_id, wa.contact_email
       FROM winery_accounts wa
       WHERE wa.id = $1`,
      [id]
    );

    const { rowCount } = await pool.query(
      `DELETE FROM winery_accounts WHERE id = $1`,
      [id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    if (accountRows[0]) {
      await logAuthEvent({
        accountId: accountRows[0].id,
        wineryId: accountRows[0].winery_id,
        identifier: accountRows[0].contact_email,
        actorAdminId: req.adminAccount?.adminId || null,
        eventType: 'admin_account_deleted',
        success: true,
        details: { source: 'admin_console' },
        ip: req.ip,
        userAgent: req.get('user-agent') || null,
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/admin/intel
 * Superadmin activity console data.
 */
router.get('/intel', requireSuperadmin, async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const searchPattern = `%${search}%`;

  try {
    const summaryRows = await loadIntelSummary();

    const accounts = await loadIntelAccounts(searchPattern);

    res.json({ summary: summaryRows[0], accounts });
  } catch (err) {
    console.error('Admin intel load error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/admin/intel/accounts/:id/events
 */
router.get('/intel/accounts/:id/events', requireSuperadmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 200);
  const eventType = typeof req.query.type === 'string' && req.query.type.trim() ? req.query.type.trim() : null;

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Valid account id is required' });
  }

  try {
    const tableExists = await hasAuthActivityLog();
    if (!tableExists) {
      return res.json([]);
    }

    const params = [id];
    let typeSql = '';
    if (eventType) {
      params.push(eventType);
      typeSql = ` AND e.event_type = $${params.length}`;
    }
    params.push(limit);

    const { rows } = await pool.query(
      `SELECT
         e.id, e.event_type, e.success, e.identifier, e.details,
         e.ip, e.user_agent, e.created_at,
         e.actor_admin_id,
         aa.display_name AS actor_admin_name,
         aa.email AS actor_admin_email
       FROM auth_activity_log e
       LEFT JOIN admin_accounts aa ON aa.id = e.actor_admin_id
       WHERE e.account_id = $1${typeSql}
       ORDER BY e.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    res.json(rows);
  } catch (err) {
    console.error('Admin intel events error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

async function hasAuthActivityLog() {
  try {
    const { rows } = await pool.query(`
      SELECT to_regclass('public.auth_activity_log') IS NOT NULL AS exists
    `);
    return Boolean(rows[0]?.exists);
  } catch {
    return false;
  }
}

async function loadIntelSummary() {
  const hasActivity = await hasAuthActivityLog();
  const hasPasswordFlags = await hasWineryAccountPasswordFlags();

  if (!hasActivity) {
    return [makeLegacyIntelSummaryRow()];
  }

  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM winery_accounts) AS total_accounts,
        (SELECT COUNT(*) FROM winery_accounts WHERE password_hash IS NOT NULL) AS password_enabled,
        (SELECT COUNT(*) FROM winery_accounts WHERE ${hasPasswordFlags ? 'COALESCE(password_must_change, FALSE) = TRUE' : 'FALSE'}) AS must_change_password,
        (SELECT COUNT(*) FROM winery_accounts WHERE last_login >= NOW() - INTERVAL '30 days') AS active_30d,
        (SELECT COUNT(*) FROM auth_activity_log WHERE event_type IN ('password_login', 'magic_link_verified') AND success = TRUE AND created_at >= NOW() - INTERVAL '7 days') AS successful_logins_7d,
        (SELECT COUNT(*) FROM auth_activity_log WHERE event_type = 'password_login' AND success = FALSE AND created_at >= NOW() - INTERVAL '7 days') AS failed_logins_7d,
        (SELECT COUNT(*) FROM auth_activity_log WHERE created_at >= NOW() - INTERVAL '24 hours') AS events_24h
    `);
    return rows;
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return [makeLegacyIntelSummaryRow()];
    }
    throw err;
  }
}

async function loadIntelAccounts(searchPattern) {
  const hasActivity = await hasAuthActivityLog();
  const hasPasswordFlags = await hasWineryAccountPasswordFlags();

  if (!hasActivity) {
    const { rows } = await pool.query(
      `SELECT
         wa.id, wa.winery_id, w.title AS winery_name,
         wa.contact_email, wa.email_verified, wa.last_login, wa.created_at,
         (wa.password_hash IS NOT NULL) AS has_password,
         ${hasPasswordFlags ? 'COALESCE(wa.password_must_change, FALSE) AS password_must_change,' : 'FALSE AS password_must_change,'}
         ${hasPasswordFlags ? 'wa.password_last_changed_at,' : 'NULL::timestamp AS password_last_changed_at,'}
         0 AS login_count_30d,
         0 AS failed_logins_30d,
         NULL::timestamp AS last_event_at,
         NULL::text AS last_event_type
       FROM winery_accounts wa
       JOIN wineries w ON w.id = wa.winery_id
       WHERE LOWER(w.title) LIKE $1 OR LOWER(wa.contact_email) LIKE $1
       ORDER BY w.title
       LIMIT 200`,
      [searchPattern]
    );
    return rows;
  }

  try {
    const { rows } = await pool.query(
      `WITH recent AS (
         SELECT
           account_id,
           COUNT(*) FILTER (WHERE event_type IN ('password_login', 'magic_link_verified') AND success = TRUE AND created_at >= NOW() - INTERVAL '30 days') AS login_count_30d,
           COUNT(*) FILTER (WHERE event_type = 'password_login' AND success = FALSE AND created_at >= NOW() - INTERVAL '30 days') AS failed_logins_30d,
           MAX(created_at) AS last_event_at,
           (ARRAY_AGG(event_type ORDER BY created_at DESC))[1] AS last_event_type
         FROM auth_activity_log
         WHERE account_id IS NOT NULL
         GROUP BY account_id
       )
       SELECT
         wa.id, wa.winery_id, w.title AS winery_name,
         wa.contact_email, wa.email_verified, wa.last_login, wa.created_at,
         (wa.password_hash IS NOT NULL) AS has_password,
         ${hasPasswordFlags ? 'COALESCE(wa.password_must_change, FALSE) AS password_must_change,' : 'FALSE AS password_must_change,'}
         ${hasPasswordFlags ? 'wa.password_last_changed_at,' : 'NULL::timestamp AS password_last_changed_at,'}
         COALESCE(recent.login_count_30d, 0) AS login_count_30d,
         COALESCE(recent.failed_logins_30d, 0) AS failed_logins_30d,
         recent.last_event_at,
         recent.last_event_type
       FROM winery_accounts wa
       JOIN wineries w ON w.id = wa.winery_id
       LEFT JOIN recent ON recent.account_id = wa.id
       WHERE LOWER(w.title) LIKE $1 OR LOWER(wa.contact_email) LIKE $1
       ORDER BY w.title
       LIMIT 200`,
      [searchPattern]
    );
    return rows;
  } catch (err) {
    throw err;
  }
}

async function hasWineryAccountPasswordFlags() {
  try {
    const { rows } = await pool.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'winery_accounts'
             AND column_name = 'password_must_change'
         ) AS has_password_must_change,
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'winery_accounts'
             AND column_name = 'password_last_changed_at'
         ) AS has_password_last_changed_at`
    );
    return Boolean(rows[0]?.has_password_must_change || rows[0]?.has_password_last_changed_at);
  } catch {
    return false;
  }
}

function makeLegacyIntelSummaryRow() {
  return {
    total_accounts: 0,
    password_enabled: 0,
    must_change_password: 0,
    active_30d: 0,
    successful_logins_7d: 0,
    failed_logins_7d: 0,
    events_24h: 0,
  };
}

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

// ─── Edit history ────────────────────────────────────────────────

/**
 * GET /api/admin/history/:entityType/:entityId
 * Returns the full audit trail for a winery, vineyard_parcel, or vineyard_block.
 * entity_type: 'winery' | 'vineyard_parcel' | 'vineyard_block'
 */
router.get('/history/:entityType/:entityId', async (req, res) => {
  const { entityType, entityId } = req.params;
  const id = parseInt(entityId, 10);
  const validTypes = ['winery', 'vineyard_parcel', 'vineyard_block'];

  if (!validTypes.includes(entityType) || isNaN(id)) {
    return res.status(400).json({ error: 'Invalid entity type or id' });
  }

  try {
    // Applied changes from the audit log
    const { rows: log } = await pool.query(
      `SELECT
         wel.id, wel.request_id, wel.field_name, wel.old_value, wel.new_value,
         wel.action, wel.edited_at,
         wel.entity_type, wel.entity_id,
         er.request_type, er.status AS request_status,
         er.admin_notes,
         wa.contact_email AS submitted_by,
         aa.display_name AS reviewed_by
       FROM winery_edit_log wel
       LEFT JOIN edit_requests er ON er.id = wel.request_id
       LEFT JOIN winery_accounts wa ON wa.id = wel.account_id
       LEFT JOIN admin_accounts aa ON aa.id = wel.admin_id
       WHERE wel.entity_type = $1 AND wel.entity_id = $2
       ORDER BY wel.edited_at DESC`,
      [entityType, id]
    );

    // Pending and rejected requests referencing this entity (not yet in edit log)
    const { rows: pending } = await pool.query(
      `SELECT
         er.id AS request_id, er.request_type, er.status,
         er.payload, er.admin_notes, er.created_at, er.reviewed_at,
         wa.contact_email AS submitted_by,
         aa.display_name AS reviewed_by
       FROM edit_requests er
       LEFT JOIN winery_accounts wa ON wa.id = er.account_id
       LEFT JOIN admin_accounts aa ON aa.id = er.reviewed_by
       WHERE er.target_id = $1 AND er.status != 'approved'
       ORDER BY er.created_at DESC`,
      [id]
    );

    res.json({ log, pending });
  } catch (err) {
    console.error('Admin history error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Admin vineyard block management ────────────────────────────

/**
 * GET /api/admin/vineyards
 * Returns vineyards GROUPED by (vineyard_name, winery_id). Each row is one
 * logical vineyard with aggregated parcel + block counts and a representative
 * parcel_id used as the canonical entry point for the detail page.
 * Query: ?search=text  (filters by vineyard_name or winery title)
 */
router.get('/vineyards', async (req, res) => {
  const search = req.query.search || null;
  try {
    const params = [];
    let whereClause = '';
    if (search) {
      params.push(`%${search}%`);
      whereClause = `WHERE vp.vineyard_name ILIKE $1 OR w.title ILIKE $1`;
    }

    const { rows } = await pool.query(
      `SELECT
         MIN(vp.id)                                  AS parcel_id,
         vp.vineyard_name,
         vp.winery_id,
         COALESCE(w.title, 'Independent')            AS winery_name,
         (ARRAY_AGG(DISTINCT vp.ava_name) FILTER (WHERE vp.ava_name IS NOT NULL))[1] AS ava_name,
         COUNT(DISTINCT vp.id)::int                  AS parcel_count,
         COUNT(vb.id)::int                           AS block_count,
         ROUND(SUM(COALESCE(vp.acres, 0))::numeric, 2) AS total_acres
       FROM vineyard_parcels vp
       LEFT JOIN wineries w ON w.id = vp.winery_id
       LEFT JOIN vineyard_blocks vb ON vb.vineyard_parcel_id = vp.id
       ${whereClause}
       GROUP BY vp.vineyard_name, vp.winery_id, w.title
       ORDER BY vp.vineyard_name
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('Admin vineyards list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/admin/vineyards/:parcelId/siblings
 * Returns all parcels that share the same (vineyard_name, winery_id) as the
 * given parcel \u2014 lightweight payload for the sibling picker + map overview.
 */
router.get('/vineyards/:parcelId/siblings', async (req, res) => {
  const parcelId = parseInt(req.params.parcelId, 10);
  if (isNaN(parcelId)) return res.status(400).json({ error: 'Invalid parcel id' });

  try {
    const { rows } = await pool.query(
      `WITH target AS (
         SELECT vineyard_name, winery_id FROM vineyard_parcels WHERE id = $1
       )
       SELECT
         vp.id, vp.vineyard_name, vp.parcel_label, vp.acres, vp.situs_address, vp.situs_city,
         ST_AsGeoJSON(vp.geometry)::json AS geometry,
         (SELECT COUNT(*)::int FROM vineyard_blocks vb WHERE vb.vineyard_parcel_id = vp.id) AS block_count
       FROM vineyard_parcels vp, target t
       WHERE vp.vineyard_name IS NOT DISTINCT FROM t.vineyard_name
         AND vp.winery_id    IS NOT DISTINCT FROM t.winery_id
       ORDER BY vp.id`,
      [parcelId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Admin siblings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/admin/vineyards/:parcelId/blocks
 * Returns full parcel data (geometry, topo_stats, all fields) plus blocks.
 */
router.get('/vineyards/:parcelId/blocks', async (req, res) => {
  const parcelId = parseInt(req.params.parcelId, 10);
  if (isNaN(parcelId)) return res.status(400).json({ error: 'Invalid parcel id' });

  try {
    const [parcelRes, blocksRes, topoRes] = await Promise.all([
      pool.query(
        `SELECT
           vp.id, vp.vineyard_name, vp.parcel_label, vp.vineyard_org, vp.owner_name,
           vp.ava_name, vp.nested_ava, vp.nested_nested_ava,
           vp.situs_address, vp.situs_city, vp.situs_zip,
           vp.acres, vp.varietals_list, vp.source_dataset, vp.winery_id,
           ST_AsGeoJSON(vp.geometry)::json AS geometry,
           COALESCE(w.title, 'Independent') AS winery_name
         FROM vineyard_parcels vp
         LEFT JOIN wineries w ON w.id = vp.winery_id
         WHERE vp.id = $1`,
        [parcelId]
      ),
      pool.query(
        `SELECT id, vineyard_parcel_id, vineyard_name, block_name, variety, clone,
                rootstock, rows, spacing, vines_per_acre, vines, acres, year_planted, notes
         FROM vineyard_blocks
         WHERE vineyard_parcel_id = $1
         ORDER BY block_name`,
        [parcelId]
      ),
      pool.query(
        `SELECT parcel_id, elevation_min_ft, elevation_max_ft, elevation_mean_ft,
                slope_mean_deg, slope_max_deg, slope_p10_deg, slope_p90_deg,
                aspect_dominant_deg, aspect_mean_deg
         FROM vineyard_parcel_topo_stats
         WHERE parcel_id = $1`,
        [parcelId]
      ),
    ]);

    if (parcelRes.rows.length === 0) {
      return res.status(404).json({ error: 'Parcel not found' });
    }

    res.json({
      parcel: {
        ...parcelRes.rows[0],
        blocks: blocksRes.rows,
        topo_stats: topoRes.rows[0] || null,
      },
    });
  } catch (err) {
    console.error('Admin parcel blocks error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/admin/vineyards/:parcelId/blocks/apply
 * Directly applies block changes without an approval workflow.
 * Body: {
 *   block_changes: [{ id, field_changes: [{ field, old, new }] }],
 *   new_blocks:    [{ block_name, variety, ... }],
 *   deleted_block_ids: [number],
 * }
 */
router.post('/vineyards/:parcelId/blocks/apply', async (req, res) => {
  const parcelId = parseInt(req.params.parcelId, 10);
  if (isNaN(parcelId)) return res.status(400).json({ error: 'Invalid parcel id' });

  const { adminId } = req.adminAccount;
  const { block_changes = [], new_blocks = [], deleted_block_ids = [] } = req.body;

  const ALLOWED_COLS = ['block_name', 'variety', 'clone', 'rootstock',
                        'rows', 'spacing', 'year_planted', 'notes'];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify parcel exists and fetch winery_id for audit log
    const { rows: parcelRows } = await client.query(
      `SELECT id, winery_id, vineyard_name FROM vineyard_parcels WHERE id = $1`,
      [parcelId]
    );
    if (parcelRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Parcel not found' });
    }
    const parcel = parcelRows[0];

    // Apply field-level changes to existing blocks
    for (const change of block_changes) {
      if (!change.id || !Array.isArray(change.field_changes)) continue;
      for (const fc of change.field_changes) {
        if (!ALLOWED_COLS.includes(fc.field)) continue;
        await client.query(
          `UPDATE vineyard_blocks SET ${fc.field} = $1 WHERE id = $2 AND vineyard_parcel_id = $3`,
          [fc.new ?? null, change.id, parcelId]
        );
        await client.query(
          `INSERT INTO winery_edit_log
             (winery_id, admin_id, table_name, record_id, field_name,
              old_value, new_value, entity_type, entity_id)
           VALUES ($1, $2, 'vineyard_blocks', $3, $4, $5, $6, 'vineyard_block', $3)`,
          [parcel.winery_id, adminId, change.id, fc.field,
           fc.old != null ? String(fc.old) : null,
           fc.new != null ? String(fc.new) : null]
        );
      }
    }

    // Delete blocks
    for (const blockId of deleted_block_ids) {
      const id = parseInt(blockId, 10);
      if (isNaN(id)) continue;
      const { rows: oldBlock } = await client.query(
        `SELECT block_name FROM vineyard_blocks WHERE id = $1 AND vineyard_parcel_id = $2`,
        [id, parcelId]
      );
      if (oldBlock.length === 0) continue;
      await client.query(`DELETE FROM vineyard_blocks WHERE id = $1`, [id]);
      await client.query(
        `INSERT INTO winery_edit_log
           (winery_id, admin_id, table_name, record_id, field_name,
            old_value, new_value, action, entity_type, entity_id)
         VALUES ($1, $2, 'vineyard_blocks', $3, 'block_name', $4, NULL, 'delete',
                 'vineyard_parcel', $5)`,
        [parcel.winery_id, adminId, id,
         oldBlock[0].block_name ?? null, parcelId]
      );
    }

    // Insert new blocks
    for (const nb of new_blocks) {
      const cols = ALLOWED_COLS.filter((c) => nb[c] != null && nb[c] !== '');
      if (cols.length === 0) continue;
      const vals = cols.map((c) => nb[c]);
      const placeholders = cols.map((_, i) => `$${i + 3}`).join(', ');
      const { rows: inserted } = await client.query(
        `INSERT INTO vineyard_blocks (vineyard_parcel_id, vineyard_name, ${cols.join(', ')})
         VALUES ($1, $2, ${placeholders})
         RETURNING id`,
        [parcelId, parcel.vineyard_name, ...vals]
      );
      const newId = inserted[0]?.id;
      if (newId) {
        await client.query(
          `INSERT INTO winery_edit_log
             (winery_id, admin_id, table_name, record_id, field_name,
              old_value, new_value, action, entity_type, entity_id)
           VALUES ($1, $2, 'vineyard_blocks', $3, 'block_name', NULL, $4, 'insert',
                   'vineyard_parcel', $5)`,
          [parcel.winery_id, adminId, newId, nb.block_name ?? null, parcelId]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Admin apply blocks error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/admin/vineyards/:parcelId/split
 * Renames a subset of sibling parcels (those sharing the same vineyard_name +
 * winery_id as :parcelId) to new vineyard names — effectively splitting one
 * vineyard into multiple vineyards.
 *
 * Body: { assignments: [{ parcel_id, new_vineyard_name }] }
 *
 * Validates that every parcel_id in assignments is currently a sibling of
 * :parcelId. Updates `vineyard_parcels.vineyard_name` and the denormalized
 * `vineyard_blocks.vineyard_name` for each parcel whose name actually changes.
 * Writes one audit log entry per renamed parcel.
 */
router.post('/vineyards/:parcelId/split', async (req, res) => {
  const parcelId = parseInt(req.params.parcelId, 10);
  if (isNaN(parcelId)) return res.status(400).json({ error: 'Invalid parcel id' });

  const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
  if (assignments.length === 0) {
    return res.status(400).json({ error: 'No assignments provided' });
  }

  const { adminId } = req.adminAccount;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Look up the source parcel to find the (vineyard_name, winery_id) group.
    const { rows: srcRows } = await client.query(
      `SELECT id, vineyard_name, winery_id FROM vineyard_parcels WHERE id = $1`,
      [parcelId]
    );
    if (srcRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Parcel not found' });
    }
    const src = srcRows[0];

    // Fetch all sibling parcels in the same group.
    const { rows: sibs } = await client.query(
      `SELECT id, vineyard_name, winery_id
         FROM vineyard_parcels
        WHERE vineyard_name IS NOT DISTINCT FROM $1
          AND winery_id     IS NOT DISTINCT FROM $2`,
      [src.vineyard_name, src.winery_id]
    );
    const sibIds = new Set(sibs.map((r) => r.id));
    const sibById = new Map(sibs.map((r) => [r.id, r]));

    // Validate every assignment refers to a sibling.
    for (const a of assignments) {
      const pid = parseInt(a?.parcel_id, 10);
      if (isNaN(pid) || !sibIds.has(pid)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Parcel ${a?.parcel_id} is not part of this vineyard group`,
        });
      }
      if (typeof a?.new_vineyard_name !== 'string') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Each assignment needs new_vineyard_name' });
      }
    }

    let renamedCount = 0;
    const distinctNamesAfter = new Set();
    for (const sib of sibs) distinctNamesAfter.add(sib.vineyard_name);

    for (const a of assignments) {
      const pid = parseInt(a.parcel_id, 10);
      const newName = a.new_vineyard_name.trim() || null;
      const old = sibById.get(pid);
      if (!old) continue;
      if ((old.vineyard_name ?? null) === (newName ?? null)) continue;

      await client.query(
        `UPDATE vineyard_parcels SET vineyard_name = $1 WHERE id = $2`,
        [newName, pid]
      );
      // Keep denormalized vineyard_name on blocks in sync.
      await client.query(
        `UPDATE vineyard_blocks SET vineyard_name = $1 WHERE vineyard_parcel_id = $2`,
        [newName, pid]
      );
      await client.query(
        `INSERT INTO winery_edit_log
           (winery_id, admin_id, table_name, record_id, field_name,
            old_value, new_value, entity_type, entity_id)
         VALUES ($1, $2, 'vineyard_parcels', $3, 'vineyard_name', $4, $5,
                 'vineyard_parcel', $3)`,
        [src.winery_id, adminId, pid, old.vineyard_name, newName]
      );

      renamedCount++;
      distinctNamesAfter.delete(old.vineyard_name);
      distinctNamesAfter.add(newName);
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      renamed: renamedCount,
      group_count: distinctNamesAfter.size,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Admin split vineyard error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/admin/vineyards/:parcelId/label
 * Updates the per-parcel display label. Body: { parcel_label: string|null }
 */
router.patch('/vineyards/:parcelId/label', async (req, res) => {
  const parcelId = parseInt(req.params.parcelId, 10);
  if (isNaN(parcelId)) return res.status(400).json({ error: 'Invalid parcel id' });

  const { adminId } = req.adminAccount;
  let label = req.body?.parcel_label;
  if (typeof label === 'string') {
    label = label.trim();
    if (label.length === 0) label = null;
    if (label && label.length > 200) {
      return res.status(400).json({ error: 'Label too long (max 200)' });
    }
  } else if (label !== null && label !== undefined) {
    return res.status(400).json({ error: 'parcel_label must be a string or null' });
  } else {
    label = null;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: oldRows } = await client.query(
      `SELECT parcel_label, winery_id FROM vineyard_parcels WHERE id = $1`,
      [parcelId]
    );
    if (oldRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Parcel not found' });
    }
    const oldLabel = oldRows[0].parcel_label;
    if ((oldLabel ?? null) === (label ?? null)) {
      await client.query('ROLLBACK');
      return res.json({ success: true, parcel_label: label, unchanged: true });
    }
    await client.query(
      `UPDATE vineyard_parcels SET parcel_label = $1 WHERE id = $2`,
      [label, parcelId]
    );
    await client.query(
      `INSERT INTO winery_edit_log
         (winery_id, admin_id, table_name, record_id, field_name,
          old_value, new_value, entity_type, entity_id)
       VALUES ($1, $2, 'vineyard_parcels', $3, 'parcel_label', $4, $5,
               'vineyard_parcel', $3)`,
      [oldRows[0].winery_id, adminId, parcelId, oldLabel, label]
    );
    await client.query('COMMIT');
    res.json({ success: true, parcel_label: label });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Admin parcel label error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/admin/vineyards/:parcelId/split-geometry
 *
 * Splits one parcel polygon into two using a drawn LineString blade.
 * Uses PostGIS ST_Split server-side so the geometry math is exact.
 *
 * Body: {
 *   blade:         GeoJSON LineString   — the drawn split line
 *   parcel_a_label: string|null         — label for the first piece
 *   parcel_b_label: string|null         — label for the second piece
 *   a_block_ids:   number[]             — vineyard_blocks to assign to piece A
 *   b_block_ids:   number[]             — vineyard_blocks to assign to piece B
 * }
 *
 * Returns: { parcel_a_id, parcel_b_id }
 */
router.post('/vineyards/:parcelId/split-geometry', async (req, res) => {
  const parcelId = parseInt(req.params.parcelId, 10);
  if (isNaN(parcelId)) return res.status(400).json({ error: 'Invalid parcel id' });

  const { adminId } = req.adminAccount;
  const { blade, parcel_a_label, parcel_b_label, a_block_ids = [], b_block_ids = [] } = req.body || {};

  if (!blade || blade.type !== 'LineString' || !Array.isArray(blade.coordinates) || blade.coordinates.length < 2) {
    return res.status(400).json({ error: 'blade must be a GeoJSON LineString with ≥2 coordinates' });
  }

  const bladeGeoJSON = JSON.stringify(blade);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch parent parcel — lock it to prevent concurrent edits
    const { rows: parentRows } = await client.query(
      `SELECT id, vineyard_name, parcel_label, winery_id, vineyard_org, owner_name,
              ava_name, nested_ava, nested_nested_ava, situs_address, situs_city, situs_zip,
              varietals_list, source_dataset, ava_id
       FROM vineyard_parcels WHERE id = $1 FOR UPDATE`,
      [parcelId]
    );
    if (parentRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Parcel not found' });
    }
    const parent = parentRows[0];

    // Validate parcel is a single Polygon (not MultiPolygon)
    const { rows: typeRows } = await client.query(
      `SELECT ST_GeometryType(geometry) AS gtype FROM vineyard_parcels WHERE id = $1`,
      [parcelId]
    );
    if (typeRows[0]?.gtype === 'ST_MultiPolygon') {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'This parcel contains multiple polygons (MultiPolygon). Use the Split Vineyard tool to separate them first, then split individual polygons.',
      });
    }

    // Run PostGIS split. ST_Split requires the blade to be snapped to the
    // polygon first to ensure the line touches the boundary precisely.
    const { rows: splitRows } = await client.query(
      `SELECT
         ST_AsGeoJSON(geom)::json AS geometry,
         ST_Area(geom::geography) / 4046.86 AS acres
       FROM (
         SELECT (ST_Dump(
           ST_Split(
             ST_Snap(geometry, ST_GeomFromGeoJSON($2), 0.000001),
             ST_GeomFromGeoJSON($2)
           )
         )).geom
         FROM vineyard_parcels WHERE id = $1
       ) parts`,
      [parcelId, bladeGeoJSON]
    );

    if (splitRows.length !== 2) {
      await client.query('ROLLBACK');
      const n = splitRows.length;
      return res.status(422).json({
        error: n < 2
          ? 'The split line did not cross the parcel boundary at two points. Draw a line that enters and exits the parcel.'
          : `Split produced ${n} pieces instead of 2. Try a simpler line that crosses the parcel once.`,
      });
    }

    const [pieceA, pieceB] = splitRows;
    const labelA = (typeof parcel_a_label === 'string' && parcel_a_label.trim()) || null;
    const labelB = (typeof parcel_b_label === 'string' && parcel_b_label.trim()) || null;

    // Copy parent fields into both new parcels.
    const cols = [
      'winery_id', 'source_dataset', 'vineyard_name', 'vineyard_org', 'owner_name',
      'ava_name', 'nested_ava', 'nested_nested_ava', 'situs_address', 'situs_city',
      'situs_zip', 'varietals_list', 'ava_id',
    ];
    const parentVals = cols.map((c) => parent[c] ?? null);

    // Insert parcel A
    const { rows: rowsA } = await client.query(
      `INSERT INTO vineyard_parcels (${cols.join(', ')}, acres, parcel_label, geometry)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}, $${cols.length + 2}, ST_GeomFromGeoJSON($${cols.length + 3}))
       RETURNING id`,
      [...parentVals, Number(pieceA.acres).toFixed(3), labelA, JSON.stringify(pieceA.geometry)]
    );
    const parcelAId = rowsA[0].id;

    // Insert parcel B
    const { rows: rowsB } = await client.query(
      `INSERT INTO vineyard_parcels (${cols.join(', ')}, acres, parcel_label, geometry)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}, $${cols.length + 2}, ST_GeomFromGeoJSON($${cols.length + 3}))
       RETURNING id`,
      [...parentVals, Number(pieceB.acres).toFixed(3), labelB, JSON.stringify(pieceB.geometry)]
    );
    const parcelBId = rowsB[0].id;

    // Reassign blocks
    const safeAIds = a_block_ids.map(Number).filter((n) => !isNaN(n));
    const safeBIds = b_block_ids.map(Number).filter((n) => !isNaN(n));

    if (safeAIds.length > 0) {
      await client.query(
        `UPDATE vineyard_blocks SET vineyard_parcel_id = $1 WHERE id = ANY($2) AND vineyard_parcel_id = $3`,
        [parcelAId, safeAIds, parcelId]
      );
    }
    if (safeBIds.length > 0) {
      await client.query(
        `UPDATE vineyard_blocks SET vineyard_parcel_id = $1 WHERE id = ANY($2) AND vineyard_parcel_id = $3`,
        [parcelBId, safeBIds, parcelId]
      );
    }

    // Delete original parcel (blocks already reassigned; cascade will clean up any remaining unassigned blocks)
    await client.query(`DELETE FROM vineyard_parcels WHERE id = $1`, [parcelId]);

    // Audit log — one entry per new parcel, referencing the split origin
    for (const [newId, newLabel] of [[parcelAId, labelA], [parcelBId, labelB]]) {
      await client.query(
        `INSERT INTO winery_edit_log
           (winery_id, admin_id, table_name, record_id, field_name,
            old_value, new_value, action, entity_type, entity_id)
         VALUES ($1, $2, 'vineyard_parcels', $3, 'geometry',
                 $4, $5, 'insert', 'vineyard_parcel', $3)`,
        [parent.winery_id, adminId, newId,
         `split_from:${parcelId}`, newLabel ?? parent.vineyard_name]
      );
    }
    // Mark the original parcel as split-deleted
    await client.query(
      `INSERT INTO winery_edit_log
         (winery_id, admin_id, table_name, record_id, field_name,
          old_value, new_value, action, entity_type, entity_id)
       VALUES ($1, $2, 'vineyard_parcels', $3, 'geometry',
               NULL, $4, 'delete', 'vineyard_parcel', $3)`,
      [parent.winery_id, adminId, parcelId,
       `split_into:${parcelAId},${parcelBId}`]
    );

    await client.query('COMMIT');
    res.json({ success: true, parcel_a_id: parcelAId, parcel_b_id: parcelBId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Admin split-geometry error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ─── Bulk block import (admin direct) ────────────────────────────

/**
 * GET /api/admin/wineries/:wineryId/parcels
 * Lightweight parcel list scoped to a winery — used by the bulk-import UI to
 * show "available parcel labels" so the user knows what `hill`/`parcel_label`
 * values will resolve.
 */
router.get('/wineries/:wineryId/parcels', async (req, res) => {
  const wineryId = parseInt(req.params.wineryId, 10);
  if (isNaN(wineryId)) return res.status(400).json({ error: 'Invalid winery id' });
  try {
    const { rows } = await pool.query(
      `SELECT vp.id, vp.vineyard_name, vp.parcel_label, vp.acres,
              (SELECT COUNT(*)::int FROM vineyard_blocks WHERE vineyard_parcel_id = vp.id) AS block_count,
              w.title AS winery_name
       FROM vineyard_parcels vp
       LEFT JOIN wineries w ON w.id = vp.winery_id
       WHERE vp.winery_id = $1
       ORDER BY vp.parcel_label NULLS LAST, vp.vineyard_name`,
      [wineryId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Admin winery parcels error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/admin/wineries/:wineryId/blocks/bulk-apply
 * Body: { rows: [...], column_map?: {}, dry_run?: boolean }
 * Returns the result summary from blockBulkApply.
 *
 * dry_run=true runs the import inside a transaction and rolls it back —
 * powers the preview / diff UI on the frontend.
 */
router.post('/wineries/:wineryId/blocks/bulk-apply', async (req, res) => {
  const wineryId = parseInt(req.params.wineryId, 10);
  if (isNaN(wineryId)) return res.status(400).json({ error: 'Invalid winery id' });

  const { rows = [], column_map = {}, dry_run = false } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows must be a non-empty array' });
  }
  if (rows.length > 5000) {
    return res.status(413).json({ error: 'Too many rows (max 5000)' });
  }

  const { adminId } = req.adminAccount;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: wRows } = await client.query(`SELECT id FROM wineries WHERE id = $1`, [wineryId]);
    if (wRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Winery not found' });
    }

    const result = await bulkApplyBlocks({
      client, wineryId, rows, columnMap: column_map, adminId, origin: 'admin',
    });

    if (dry_run) {
      await client.query('ROLLBACK');
      res.json({ dry_run: true, ...result });
    } else {
      await client.query('COMMIT');
      res.json({ dry_run: false, ...result });
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Admin bulk-apply blocks error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  } finally {
    client.release();
  }
});

// ─── Winery alias management ─────────────────────────────────────

/**
 * GET /api/admin/wineries/:wineryId/aliases
 */
router.get('/wineries/:wineryId/aliases', async (req, res) => {
  const wineryId = parseInt(req.params.wineryId, 10);
  if (isNaN(wineryId)) return res.status(400).json({ error: 'Invalid winery id' });
  try {
    const { rows } = await pool.query(
      `SELECT id, title, COALESCE(aliases, '{}') AS aliases FROM wineries WHERE id = $1`,
      [wineryId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Winery not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Get aliases error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/admin/wineries/:wineryId/aliases
 * Body: { alias: string }   — adds a single alias (idempotent).
 */
router.post('/wineries/:wineryId/aliases', async (req, res) => {
  const wineryId = parseInt(req.params.wineryId, 10);
  const { alias } = req.body || {};
  if (isNaN(wineryId)) return res.status(400).json({ error: 'Invalid winery id' });
  if (!alias || typeof alias !== 'string' || !alias.trim()) {
    return res.status(400).json({ error: 'alias is required' });
  }
  const trimmed = alias.trim();
  try {
    const { rows } = await pool.query(
      `UPDATE wineries
       SET aliases = (
         SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(aliases, '{}') || ARRAY[$1::text]))
       )
       WHERE id = $2
       RETURNING aliases`,
      [trimmed, wineryId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Winery not found' });

    // Backfill any orphan vineyard_block_buyers rows whose name now matches
    await pool.query(
      `UPDATE vineyard_block_buyers
       SET buyer_winery_id = $1
       WHERE buyer_winery_id IS NULL
         AND LOWER(TRIM(buyer_name_raw)) = LOWER(TRIM($2))`,
      [wineryId, trimmed]
    );

    res.json({ aliases: rows[0].aliases });
  } catch (err) {
    console.error('Add alias error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/admin/wineries/:wineryId/aliases
 * Body: { alias: string }
 */
router.delete('/wineries/:wineryId/aliases', async (req, res) => {
  const wineryId = parseInt(req.params.wineryId, 10);
  const { alias } = req.body || {};
  if (isNaN(wineryId)) return res.status(400).json({ error: 'Invalid winery id' });
  if (!alias || typeof alias !== 'string') {
    return res.status(400).json({ error: 'alias is required' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE wineries SET aliases = array_remove(COALESCE(aliases, '{}'), $1)
       WHERE id = $2 RETURNING aliases`,
      [alias, wineryId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Winery not found' });

    // Drop reverse links that depended on this alias resolution
    await pool.query(
      `UPDATE vineyard_block_buyers
       SET buyer_winery_id = NULL
       WHERE buyer_winery_id = $1
         AND LOWER(TRIM(buyer_name_raw)) = LOWER(TRIM($2))`,
      [wineryId, alias]
    );

    res.json({ aliases: rows[0].aliases });
  } catch (err) {
    console.error('Remove alias error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/admin/buyer-name-suggestions?name=…&limit=10
 * Returns existing wineries whose title or aliases roughly match the query,
 * for the inline "Create alias" picker in the import preview.
 */
router.get('/buyer-name-suggestions', async (req, res) => {
  const q = (req.query.name || '').toString().trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
  if (!q) return res.json([]);
  try {
    const like = `%${q}%`;
    const { rows } = await pool.query(
      `SELECT id, title FROM wineries
       WHERE title ILIKE $1
          OR EXISTS (SELECT 1 FROM unnest(COALESCE(aliases, '{}')) a WHERE a ILIKE $1)
       ORDER BY title
       LIMIT $2`,
      [like, limit]
    );
    res.json(rows);
  } catch (err) {
    console.error('Buyer suggestions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
