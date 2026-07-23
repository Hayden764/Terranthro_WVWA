/**
 * applyDataRequest — applies a "data" edit request (no geometry) to the database
 * and writes the winery_edit_log audit trail. Shared by two callers:
 *
 *   • Portal  (server/src/routes/portal.js) — winery submits an edit; for these
 *     types the change is applied IMMEDIATELY (status 'auto_applied'), with
 *     adminId = null (no admin reviewed it). It still lands in the admin
 *     notification feed and is revertable.
 *   • Admin   (server/src/routes/admin.js) — the same apply runs when an admin
 *     approves a pending request of one of these types (adminId set).
 *
 * Keeping the SQL in one place prevents the two paths from drifting (which is how
 * whitelist mismatches like the old `trellis`/`vines` bugs crept in).
 *
 * Must be called inside an open transaction — pass the pooled `client`.
 *
 *   request: { id, request_type, target_id, winery_id, account_id, payload }
 *   opts:    { adminId }   // null for portal auto-apply
 */

// Request types that are applied immediately (data only — no geometry, no
// ownership transfer). Everything else stays admin-approval based.
export const IMMEDIATE_APPLY_TYPES = ['profile', 'vineyard_rename', 'vineyard_varietals', 'vineyard_blocks'];

// Block columns a winery/admin may edit. Single source of truth for both the
// field-change path and the new-block insert path.
export const ALLOWED_BLOCK_COLS = ['block_name', 'variety', 'clone', 'rootstock', 'trellis',
                                   'rows', 'spacing', 'vines', 'year_planted', 'notes'];

export async function applyDataRequest(client, request, { adminId = null } = {}) {
  const requestId = request.id;
  const payload = request.payload;

  switch (request.request_type) {
    case 'profile': {
      const allowedCols = ['description', 'phone', 'url', 'image_url'];
      const sets = [];
      const vals = [];
      for (const col of allowedCols) {
        if (col in payload) { vals.push(payload[col]); sets.push(`${col} = $${vals.length}`); }
      }
      if (sets.length > 0) {
        vals.push(request.winery_id);
        const { rows: old } = await client.query(
          `SELECT description, phone, url, image_url FROM wineries WHERE id = $1`,
          [request.winery_id]
        );
        await client.query(`UPDATE wineries SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
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
          `SELECT varietals_list FROM vineyards WHERE id = $1`, [request.target_id]
        );
        await client.query(
          `UPDATE vineyards SET varietals_list = $1 WHERE id = $2 AND winery_id = $3`,
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
      const newName = typeof payload.vineyard_name === 'string' ? payload.vineyard_name.trim() : '';
      if (newName && request.target_id) {
        const { rows: srcRows } = await client.query(
          `SELECT vineyard_name FROM vineyards WHERE id = $1 AND winery_id = $2`,
          [request.target_id, request.winery_id]
        );
        if (srcRows[0]) {
          const oldName = srcRows[0].vineyard_name;
          await client.query(`UPDATE vineyards SET vineyard_name = $1 WHERE id = $2`, [newName, request.target_id]);
          await client.query(`UPDATE vineyard_blocks SET vineyard_name = $1 WHERE vineyard_id = $2`, [newName, request.target_id]);
          await client.query(
            `INSERT INTO winery_edit_log
               (winery_id, account_id, admin_id, request_id,
                table_name, record_id, field_name, old_value, new_value,
                entity_type, entity_id)
             VALUES ($1, $2, $3, $4, 'vineyard_parcels', $5, 'vineyard_name', $6, $7,
                     'vineyard_parcel', $5)`,
            [request.winery_id, request.account_id, adminId, requestId,
             request.target_id, oldName, newName]
          );
        }
      }
      break;
    }

    case 'vineyard_blocks': {
      const blockChanges = Array.isArray(payload.block_changes) ? payload.block_changes : [];
      const newBlocks    = Array.isArray(payload.new_blocks)    ? payload.new_blocks    : [];

      // Apply field-level changes to existing blocks
      for (const change of blockChanges) {
        if (!change.id || !Array.isArray(change.field_changes)) continue;
        for (const fc of change.field_changes) {
          if (!ALLOWED_BLOCK_COLS.includes(fc.field)) continue;
          await client.query(
            `UPDATE vineyard_blocks SET ${fc.field} = $1 WHERE id = $2`,
            [fc.new ?? null, change.id]
          );
          await client.query(
            `INSERT INTO winery_edit_log
               (winery_id, account_id, admin_id, request_id,
                table_name, record_id, field_name, old_value, new_value,
                entity_type, entity_id)
             VALUES ($1, $2, $3, $4, 'vineyard_blocks', $5, $6, $7, $8, 'vineyard_block', $5)`,
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
               VALUES ($1, $2, $3, $4, 'vineyard_blocks', $5, $6, $7, $8, 'vineyard_parcel', $9)`,
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
        const cols = ALLOWED_BLOCK_COLS.filter((c) => nb[c] != null);
        if (cols.length === 0 || !request.target_id) continue;
        const vals = cols.map((c) => nb[c]);
        const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
        const { rows: inserted } = await client.query(
          `INSERT INTO vineyard_blocks (vineyard_id, vineyard_name, ${cols.join(', ')})
           VALUES ($1, (SELECT vineyard_name FROM vineyards WHERE id = $1), ${placeholders})
           RETURNING id`,
          [request.target_id, ...vals]
        );
        const newId = inserted[0]?.id;
        if (newId) {
          await client.query(
            `INSERT INTO winery_edit_log
               (winery_id, account_id, admin_id, request_id,
                table_name, record_id, action, entity_type, entity_id)
             VALUES ($1, $2, $3, $4, 'vineyard_blocks', $5, 'insert', 'vineyard_parcel', $6)`,
            [request.winery_id, request.account_id, adminId, requestId, newId, request.target_id]
          );
        }
      }
      break;
    }

    default:
      throw new Error(`applyDataRequest: unsupported request_type '${request.request_type}'`);
  }
}
