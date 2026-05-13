/**
 * Bulk block import service.
 *
 * Shared between:
 *   • POST /api/admin/wineries/:wineryId/blocks/bulk-apply (admin direct)
 *   • Portal-submitted vineyard_blocks_bulk requests (admin approval)
 *
 * Behaviour: upsert-only.
 *   Rows are matched to existing blocks by block_name (winery-wide,
 *   case-insensitive). For inserts (new blocks) a parcel_label is required
 *   so we know where to place them. Updates re-use the block's existing
 *   parcel — the CSV does not need to specify it.
 *   fruit_sold_to is split on '|' and reconciled against
 *   vineyard_block_buyers (buyer_winery_id resolved via wineries.title or
 *   wineries.aliases). Buyers absent from this row are deleted for that block.
 *
 * Acreage flagging: per parcel touched, if Σ block.acres delta ≥ 5 % of the
 * parcel's prior block-acre total, the parcel id is reported in
 * `flagged_parcels` so callers can attach an `acreage_change` flag.
 *
 * Input row keys (after column_map normalization):
 *   block_name (required), parcel_label (required for inserts),
 *   variety, clone, rootstock, rows, spacing, year_planted, acres, vines,
 *   vines_per_acre, fruit_sold_to
 *
 * Returns:
 *   {
 *     summary: { updated, inserted, skipped, buyer_links_added, buyer_links_removed },
 *     errors: [{ row, message }],
 *     unlinked_buyers: [{ name, count }],
 *     flagged_parcels: [{ parcel_id, before_acres, after_acres, pct_change }],
 *     per_parcel: [{ parcel_id, parcel_label, updated, inserted }]
 *   }
 */

const ROW_FIELDS = [
  'block_name', 'variety', 'clone', 'rootstock', 'rows', 'spacing',
  'year_planted', 'acres', 'vines', 'vines_per_acre', 'fruit_sold_to',
];

const NUMERIC_FIELDS = new Set(['rows', 'year_planted', 'acres', 'vines', 'vines_per_acre']);
const INT_FIELDS     = new Set(['rows', 'year_planted', 'vines']);

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Hill normalization: strip non-alphanumerics so "EastHill", "East Hill",
// "east-hill" all collapse to "easthill".
function normHill(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function applyColumnMap(row, columnMap) {
  if (!columnMap || typeof columnMap !== 'object') return { ...row };
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const dest = columnMap[k] || k;
    if (out[dest] == null || out[dest] === '') out[dest] = v;
  }
  return out;
}

function coerce(field, value) {
  if (value == null) return null;
  const str = String(value).trim();
  if (str === '') return null;
  if (NUMERIC_FIELDS.has(field)) {
    const n = Number(str.replace(/[^0-9.\-]/g, ''));
    if (!Number.isFinite(n)) return null;
    return INT_FIELDS.has(field) ? Math.trunc(n) : n;
  }
  return str;
}

function splitBuyers(raw) {
  if (!raw) return [];
  return String(raw).split('|').map(s => s.trim()).filter(Boolean);
}

/**
 * Run the bulk import inside the provided pg client transaction.
 * Caller is responsible for BEGIN / COMMIT / ROLLBACK.
 *
 * @param {object} ctx
 * @param {import('pg').PoolClient} ctx.client       — already in a transaction
 * @param {number} ctx.wineryId                      — winery scope
 * @param {Array<object>} ctx.rows                   — raw parsed rows
 * @param {object} [ctx.columnMap]                   — header → canonical-field
 * @param {number} [ctx.adminId]                     — admin acting (for audit)
 * @param {number} [ctx.accountId]                   — winery account (portal path)
 * @param {number} [ctx.requestId]                   — edit_request id (portal path)
 * @param {string} [ctx.origin]                      — 'admin' | 'portal'
 */
export async function bulkApplyBlocks(ctx) {
  const { client, wineryId, rows = [], columnMap = {}, adminId = null,
          accountId = null, requestId = null, origin = 'admin' } = ctx;

  // ── Load parcels for this winery ──────────────────────────────────
  const { rows: parcels } = await client.query(
    `SELECT id, vineyard_name, parcel_label,
            COALESCE((SELECT SUM(acres) FROM vineyard_blocks WHERE vineyard_parcel_id = vp.id), 0) AS prior_block_acres
     FROM vineyard_parcels vp
     WHERE vp.winery_id = $1`,
    [wineryId]
  );

  const parcelByLabel = new Map();
  // Hill-aware index: parcels grouped by normalized hill (extracted from
  // vineyard_name suffix). Two indexes per hill: by parcel_label, and a
  // sorted list for prefix matching of new sub-blocks.
  const parcelsByHill = new Map(); // normHill → { byLabel: Map, list: [] }
  function extractHill(vineyardName) {
    if (!vineyardName) return '';
    // "Shea Vineyard - East Hill" → "East Hill"
    const m = String(vineyardName).match(/[-–—]\s*([^-–—]+)$/);
    const tail = m ? m[1] : vineyardName;
    return normHill(tail);
  }
  for (const p of parcels) {
    if (p.parcel_label) parcelByLabel.set(norm(p.parcel_label), p);
    const h = extractHill(p.vineyard_name);
    if (!parcelsByHill.has(h)) parcelsByHill.set(h, { byLabel: new Map(), list: [] });
    const bucket = parcelsByHill.get(h);
    if (p.parcel_label) bucket.byLabel.set(norm(p.parcel_label), p);
    bucket.list.push(p);
  }

  // ── Load all existing blocks for the winery ───────────────────────
  const { rows: allBlocks } = await client.query(
    `SELECT vb.id, vb.block_name, vb.acres, vb.vineyard_parcel_id,
            vp.parcel_label, vp.vineyard_name
     FROM vineyard_blocks vb
     JOIN vineyard_parcels vp ON vp.id = vb.vineyard_parcel_id
     WHERE vp.winery_id = $1`,
    [wineryId]
  );
  // Hill-aware block index: norm(hill) + '|' + norm(block_name) → block row
  const blockByHillName = new Map();
  // Fallback (no hill) index: norm(block_name) → block row, with duplicates set
  const blockByName = new Map();
  const blockNameDuplicates = new Set();
  for (const b of allBlocks) {
    const h = extractHill(b.vineyard_name);
    blockByHillName.set(`${h}|${norm(b.block_name)}`, b);
    const key = norm(b.block_name);
    if (blockByName.has(key)) blockNameDuplicates.add(key);
    else blockByName.set(key, b);
  }

  // ── Load existing buyer-resolution dictionary ─────────────────────
  const { rows: wineryRows } = await client.query(
    `SELECT id, title, COALESCE(aliases, '{}') AS aliases FROM wineries`
  );
  const buyerDict = new Map(); // normalized name → winery_id
  for (const w of wineryRows) {
    buyerDict.set(norm(w.title), w.id);
    for (const a of w.aliases) buyerDict.set(norm(a), w.id);
  }

  const errors = [];
  const unlinkedCounts = new Map();
  const perParcel = new Map(); // parcel_id → { updated, inserted, parcel_label }
  const touchedParcels = new Set();
  let buyerLinksAdded = 0;
  let buyerLinksRemoved = 0;
  let updated = 0;
  let inserted = 0;
  let skipped = 0;

  // ── Per-row processing ────────────────────────────────────────────
  for (let i = 0; i < rows.length; i++) {
    const raw = applyColumnMap(rows[i] || {}, columnMap);
    const rowNum = i + 1; // 1-based for human messages

    // Allow client to mark a row to be silently skipped (used by the
    // manual row-level parcel linker UI).
    if (raw.__skip__ === true || raw.__skip__ === 'true') {
      skipped++;
      continue;
    }

    const blockName   = (raw.block_name || '').trim();
    const parcelLabel = (raw.parcel_label || '').trim();
    const hillRaw     = (raw.hill || '').trim();
    const hillKey     = normHill(hillRaw);
    if (!blockName) {
      errors.push({ row: rowNum, message: 'Missing block_name' });
      skipped++;
      continue;
    }

    // Try to match an existing block.
    //   1. (hill, block_name) — most specific
    //   2. (parcel_label, block_name) — manual-link disambiguator
    //   3. (block_name) alone — but error if ambiguous
    let existing = null;
    if (hillKey) {
      existing = blockByHillName.get(`${hillKey}|${norm(blockName)}`) || null;
    }
    if (!existing && parcelLabel) {
      // Find a block whose parcel_label matches and block_name matches
      const targetParcel = parcelByLabel.get(norm(parcelLabel));
      if (targetParcel) {
        const match = allBlocks.find(b =>
          b.vineyard_parcel_id === targetParcel.id && norm(b.block_name) === norm(blockName)
        );
        if (match) existing = match;
      }
    }
    if (!existing) {
      const blockKey = norm(blockName);
      if (blockNameDuplicates.has(blockKey) && !hillKey && !parcelLabel) {
        errors.push({ row: rowNum, message: `Block name "${blockName}" exists in multiple parcels — add a "hill" column or pick a parcel manually` });
        skipped++;
        continue;
      }
      if (!blockNameDuplicates.has(blockKey)) {
        existing = blockByName.get(blockKey) || null;
      }
    }

    // Resolve parcel for INSERTs (updates re-use the block's existing parcel).
    let parcel;
    if (existing) {
      parcel = {
        id: existing.vineyard_parcel_id,
        parcel_label: existing.parcel_label,
        vineyard_name: existing.vineyard_name,
      };
    } else {
      // INSERT path. Need to figure out which parcel this new block belongs to.
      // Priority:
      //   a) explicit parcel_label match
      //   b) within the hill, parcel whose label is a prefix of block_name
      //      (e.g. "Block 19 East" → parcel "Block 19")
      //   c) within the hill, exact block_name == parcel_label
      if (parcelLabel) {
        parcel = parcelByLabel.get(norm(parcelLabel));
      }
      if (!parcel && hillKey && parcelsByHill.has(hillKey)) {
        const bucket = parcelsByHill.get(hillKey);
        const blockNameNorm = norm(blockName);
        // exact match within hill
        if (bucket.byLabel.has(blockNameNorm)) {
          parcel = bucket.byLabel.get(blockNameNorm);
        } else {
          // prefix match: longest parcel_label that is a prefix of block_name
          let best = null;
          for (const p of bucket.list) {
            if (!p.parcel_label) continue;
            const lbl = norm(p.parcel_label);
            if (blockNameNorm === lbl || blockNameNorm.startsWith(lbl + ' ')) {
              if (!best || lbl.length > norm(best.parcel_label).length) best = p;
            }
          }
          parcel = best || null;
        }
      }
      if (!parcel) {
        const hillHint = hillRaw ? ` on hill "${hillRaw}"` : '';
        errors.push({ row: rowNum, message: `No parcel found for new block "${blockName}"${hillHint} — specify parcel_label or ensure a parent parcel exists on this hill` });
        skipped++;
        continue;
      }
    }

    // Build column → coerced value
    const values = {};
    for (const f of ROW_FIELDS) {
      values[f] = coerce(f, raw[f]);
    }
    values.block_name = blockName;
    values.fruit_sold_to = raw.fruit_sold_to ? String(raw.fruit_sold_to).trim() : null;

    let blockId;
    if (existing) {
      // UPDATE
      const sets = [];
      const vals = [];
      for (const f of ROW_FIELDS) {
        sets.push(`${f} = $${vals.length + 1}`);
        vals.push(values[f]);
      }
      vals.push(existing.id);
      await client.query(
        `UPDATE vineyard_blocks SET ${sets.join(', ')}
         WHERE id = $${vals.length}`,
        vals
      );
      blockId = existing.id;
      updated++;
    } else {
      // INSERT
      const cols = ['vineyard_parcel_id', 'vineyard_name', ...ROW_FIELDS];
      const placeholders = cols.map((_, i2) => `$${i2 + 1}`).join(', ');
      const vals = [parcel.id, parcel.vineyard_name, ...ROW_FIELDS.map(f => values[f])];
      const { rows: ins } = await client.query(
        `INSERT INTO vineyard_blocks (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
        vals
      );
      blockId = ins[0].id;
      // Track new block in both indexes so a later duplicate row errors out
      const newRow = {
        id: blockId, block_name: blockName, acres: values.acres,
        vineyard_parcel_id: parcel.id, parcel_label: parcel.parcel_label,
        vineyard_name: parcel.vineyard_name,
      };
      const insertedHillKey = normHill((parcel.vineyard_name || '').match(/[-–—]\s*([^-–—]+)$/)?.[1] || parcel.vineyard_name || '');
      blockByHillName.set(`${insertedHillKey}|${norm(blockName)}`, newRow);
      const nameKey = norm(blockName);
      if (blockByName.has(nameKey)) blockNameDuplicates.add(nameKey);
      else blockByName.set(nameKey, newRow);
      inserted++;
    }

    // Per-parcel tally
    if (!perParcel.has(parcel.id)) {
      perParcel.set(parcel.id, {
        parcel_id: parcel.id,
        parcel_label: parcel.parcel_label,
        updated: 0,
        inserted: 0,
      });
    }
    const tally = perParcel.get(parcel.id);
    if (existing) tally.updated++; else tally.inserted++;
    touchedParcels.add(parcel.id);

    // ── Reconcile buyers for this block ─────────────────────────────
    const buyerNames = splitBuyers(values.fruit_sold_to);
    const desired = new Map(); // normalized → { name, winery_id|null }
    for (const name of buyerNames) {
      const key = norm(name);
      if (desired.has(key)) continue;
      const wid = buyerDict.get(key) || null;
      desired.set(key, { name, winery_id: wid });
      if (wid == null) {
        unlinkedCounts.set(name, (unlinkedCounts.get(name) || 0) + 1);
      }
    }

    const { rows: existingBuyers } = await client.query(
      `SELECT id, buyer_name_raw, buyer_winery_id FROM vineyard_block_buyers WHERE block_id = $1`,
      [blockId]
    );
    const existingByKey = new Map(existingBuyers.map(b => [norm(b.buyer_name_raw), b]));

    // Insert new
    for (const [key, info] of desired) {
      if (existingByKey.has(key)) {
        // Possibly update winery link if alias was just added
        const cur = existingByKey.get(key);
        if (cur.buyer_winery_id !== info.winery_id) {
          await client.query(
            `UPDATE vineyard_block_buyers SET buyer_winery_id = $1 WHERE id = $2`,
            [info.winery_id, cur.id]
          );
        }
        continue;
      }
      await client.query(
        `INSERT INTO vineyard_block_buyers (block_id, buyer_winery_id, buyer_name_raw)
         VALUES ($1, $2, $3)
         ON CONFLICT (block_id, buyer_name_raw) DO NOTHING`,
        [blockId, info.winery_id, info.name]
      );
      buyerLinksAdded++;
    }
    // Delete removed
    for (const [key, b] of existingByKey) {
      if (!desired.has(key)) {
        await client.query(`DELETE FROM vineyard_block_buyers WHERE id = $1`, [b.id]);
        buyerLinksRemoved++;
      }
    }

    // ── Audit log ───────────────────────────────────────────────────
    await client.query(
      `INSERT INTO winery_edit_log
         (winery_id, account_id, admin_id, request_id,
          table_name, record_id, field_name, old_value, new_value, action,
          entity_type, entity_id)
       VALUES ($1, $2, $3, $4, 'vineyard_blocks', $5, 'bulk_import',
               NULL, $6, $7, 'vineyard_block', $5)`,
      [
        wineryId, accountId, adminId, requestId,
        blockId,
        JSON.stringify({
          source: origin,
          parcel_label: parcelLabel,
          block_name: blockName,
          buyers: Array.from(desired.values()).map(d => d.name),
        }),
        existing ? 'update' : 'insert',
      ]
    );
  }

  // ── Acreage-change flag check ─────────────────────────────────────
  const flaggedParcels = [];
  for (const parcelId of touchedParcels) {
    const parcel = parcels.find(p => p.id === parcelId);
    if (!parcel) continue;
    const before = Number(parcel.prior_block_acres) || 0;
    const { rows: aRows } = await client.query(
      `SELECT COALESCE(SUM(acres), 0) AS total FROM vineyard_blocks WHERE vineyard_parcel_id = $1`,
      [parcelId]
    );
    const after = Number(aRows[0].total) || 0;
    if (before > 0) {
      const pct = Math.abs((after - before) / before) * 100;
      if (pct >= 5) {
        flaggedParcels.push({
          parcel_id: parcelId,
          before_acres: before,
          after_acres: after,
          pct_change: Math.round(pct * 10) / 10,
        });
      }
    } else if (after > 0) {
      flaggedParcels.push({
        parcel_id: parcelId,
        before_acres: 0,
        after_acres: after,
        pct_change: 100,
      });
    }
  }

  return {
    summary: {
      updated, inserted, skipped,
      buyer_links_added:   buyerLinksAdded,
      buyer_links_removed: buyerLinksRemoved,
      parcels_touched:     touchedParcels.size,
    },
    errors,
    unlinked_buyers: Array.from(unlinkedCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    flagged_parcels: flaggedParcels,
    per_parcel: Array.from(perParcel.values()),
  };
}
