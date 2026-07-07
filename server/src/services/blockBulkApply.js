/**
 * Bulk block import service.
 *
 * Shared between:
 *   • POST /api/admin/wineries/:wineryId/blocks/bulk-apply (admin direct)
 *   • Portal-submitted vineyard_blocks_bulk requests (admin approval)
 *
 * Behaviour: upsert-only.
 *   Rows are matched to existing blocks by block_name (winery-wide,
 *   case-insensitive). For inserts (new blocks) a vineyard name is required
 *   so we know where to place them (the legacy CSV column "parcel_label" is
 *   accepted as an alias for vineyard). Updates re-use the block's existing
 *   vineyard — the CSV does not need to specify it.
 *   fruit_sold_to is split on '|' and reconciled against
 *   vineyard_block_buyers (buyer_winery_id resolved via wineries.title or
 *   wineries.aliases). Buyers absent from this row are deleted for that block.
 *
 * Acreage flagging: per vineyard touched, if Σ block.acres delta ≥ 5 % of the
 * vineyard's prior block-acre total, the vineyard id is reported in
 * `flagged_parcels` so callers can attach an `acreage_change` flag.
 *
 * Input row keys (after column_map normalization):
 *   block_name (required), vineyard or parcel_label (required for inserts),
 *   variety, clone, rootstock, rows, spacing, year_planted, acres, vines,
 *   vines_per_acre, fruit_sold_to
 *
 * Returns:
 *   {
 *     summary: { updated, inserted, skipped, buyer_links_added, buyer_links_removed },
 *     errors: [{ row, message }],
 *     unlinked_buyers: [{ name, count }],
 *     flagged_parcels: [{ parcel_id, before_acres, after_acres, pct_change }],
 *     per_parcel: [{ parcel_id, vineyard_name, updated, inserted }]
 *   }
 *   (keys keep the legacy "parcel" naming; ids are vineyard ids post-018)
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

  // ── Load vineyards for this winery ────────────────────────────────
  const { rows: vineyards } = await client.query(
    `SELECT id, vineyard_name,
            COALESCE((SELECT SUM(acres) FROM vineyard_blocks WHERE vineyard_id = v.id), 0) AS prior_block_acres
     FROM vineyards v
     WHERE v.winery_id = $1`,
    [wineryId]
  );

  const vineyardByName = new Map();
  // Hill-aware index: vineyards grouped by normalized hill (extracted from
  // vineyard_name suffix), e.g. "Shea Vineyard - East Hill" → "easthill".
  const vineyardsByHill = new Map(); // normHill → { byName: Map, list: [] }
  function extractHill(vineyardName) {
    if (!vineyardName) return '';
    // "Shea Vineyard - East Hill" → "East Hill"
    const m = String(vineyardName).match(/[-–—]\s*([^-–—]+)$/);
    const tail = m ? m[1] : vineyardName;
    return normHill(tail);
  }
  for (const p of vineyards) {
    if (p.vineyard_name) vineyardByName.set(norm(p.vineyard_name), p);
    const h = extractHill(p.vineyard_name);
    if (!vineyardsByHill.has(h)) vineyardsByHill.set(h, { byName: new Map(), list: [] });
    const bucket = vineyardsByHill.get(h);
    if (p.vineyard_name) bucket.byName.set(norm(p.vineyard_name), p);
    bucket.list.push(p);
  }

  // ── Load all existing blocks for the winery ───────────────────────
  const { rows: allBlocks } = await client.query(
    `SELECT vb.id, vb.block_name, vb.acres, vb.vineyard_id,
            v.vineyard_name
     FROM vineyard_blocks vb
     JOIN vineyards v ON v.id = vb.vineyard_id
     WHERE v.winery_id = $1`,
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
  const perVineyard = new Map(); // vineyard_id → { updated, inserted, vineyard_name }
  const touchedVineyards = new Set();
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
    // manual row-level vineyard linker UI).
    if (raw.__skip__ === true || raw.__skip__ === 'true') {
      skipped++;
      continue;
    }

    const blockName    = (raw.block_name || '').trim();
    // "parcel_label" kept as a legacy CSV alias for the vineyard name
    const vineyardName = (raw.vineyard || raw.vineyard_name || raw.parcel_label || '').trim();
    const hillRaw      = (raw.hill || '').trim();
    const hillKey      = normHill(hillRaw);
    if (!blockName) {
      errors.push({ row: rowNum, message: 'Missing block_name' });
      skipped++;
      continue;
    }

    // Try to match an existing block.
    //   1. (hill, block_name) — most specific
    //   2. (vineyard, block_name) — manual-link disambiguator
    //   3. (block_name) alone — but error if ambiguous
    let existing = null;
    if (hillKey) {
      existing = blockByHillName.get(`${hillKey}|${norm(blockName)}`) || null;
    }
    if (!existing && vineyardName) {
      // Find a block in the named vineyard whose block_name matches
      const targetVineyard = vineyardByName.get(norm(vineyardName));
      if (targetVineyard) {
        const match = allBlocks.find(b =>
          b.vineyard_id === targetVineyard.id && norm(b.block_name) === norm(blockName)
        );
        if (match) existing = match;
      }
    }
    if (!existing) {
      const blockKey = norm(blockName);
      if (blockNameDuplicates.has(blockKey) && !hillKey && !vineyardName) {
        errors.push({ row: rowNum, message: `Block name "${blockName}" exists in multiple vineyards — add a "hill" or "vineyard" column or pick a vineyard manually` });
        skipped++;
        continue;
      }
      if (!blockNameDuplicates.has(blockKey)) {
        existing = blockByName.get(blockKey) || null;
      }
    }

    // Resolve vineyard for INSERTs (updates re-use the block's existing vineyard).
    let vineyard;
    if (existing) {
      vineyard = {
        id: existing.vineyard_id,
        vineyard_name: existing.vineyard_name,
      };
    } else {
      // INSERT path. Need to figure out which vineyard this new block belongs to.
      // Priority:
      //   a) explicit vineyard-name match
      //   b) within the hill, vineyard whose name is a prefix of block_name
      //      (e.g. "Block 19 East" → vineyard "Block 19")
      //   c) within the hill, exact block_name == vineyard_name
      if (vineyardName) {
        vineyard = vineyardByName.get(norm(vineyardName));
      }
      if (!vineyard && hillKey && vineyardsByHill.has(hillKey)) {
        const bucket = vineyardsByHill.get(hillKey);
        const blockNameNorm = norm(blockName);
        // exact match within hill
        if (bucket.byName.has(blockNameNorm)) {
          vineyard = bucket.byName.get(blockNameNorm);
        } else {
          // prefix match: longest vineyard_name that is a prefix of block_name
          let best = null;
          for (const p of bucket.list) {
            if (!p.vineyard_name) continue;
            const lbl = norm(p.vineyard_name);
            if (blockNameNorm === lbl || blockNameNorm.startsWith(lbl + ' ')) {
              if (!best || lbl.length > norm(best.vineyard_name).length) best = p;
            }
          }
          vineyard = best || null;
        }
      }
      if (!vineyard) {
        const hillHint = hillRaw ? ` on hill "${hillRaw}"` : '';
        errors.push({ row: rowNum, message: `No vineyard found for new block "${blockName}"${hillHint} — specify a vineyard column or ensure a parent vineyard exists on this hill` });
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
      const cols = ['vineyard_id', 'vineyard_name', ...ROW_FIELDS];
      const placeholders = cols.map((_, i2) => `$${i2 + 1}`).join(', ');
      const vals = [vineyard.id, vineyard.vineyard_name, ...ROW_FIELDS.map(f => values[f])];
      const { rows: ins } = await client.query(
        `INSERT INTO vineyard_blocks (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
        vals
      );
      blockId = ins[0].id;
      // Track new block in both indexes so a later duplicate row errors out
      const newRow = {
        id: blockId, block_name: blockName, acres: values.acres,
        vineyard_id: vineyard.id,
        vineyard_name: vineyard.vineyard_name,
      };
      const insertedHillKey = normHill((vineyard.vineyard_name || '').match(/[-–—]\s*([^-–—]+)$/)?.[1] || vineyard.vineyard_name || '');
      blockByHillName.set(`${insertedHillKey}|${norm(blockName)}`, newRow);
      const nameKey = norm(blockName);
      if (blockByName.has(nameKey)) blockNameDuplicates.add(nameKey);
      else blockByName.set(nameKey, newRow);
      inserted++;
    }

    // Per-vineyard tally
    if (!perVineyard.has(vineyard.id)) {
      perVineyard.set(vineyard.id, {
        parcel_id: vineyard.id,
        vineyard_name: vineyard.vineyard_name,
        updated: 0,
        inserted: 0,
      });
    }
    const tally = perVineyard.get(vineyard.id);
    if (existing) tally.updated++; else tally.inserted++;
    touchedVineyards.add(vineyard.id);

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
          vineyard: vineyardName,
          block_name: blockName,
          buyers: Array.from(desired.values()).map(d => d.name),
        }),
        existing ? 'update' : 'insert',
      ]
    );
  }

  // ── Acreage-change flag check ─────────────────────────────────────
  const flaggedParcels = [];
  for (const vineyardId of touchedVineyards) {
    const vineyard = vineyards.find(p => p.id === vineyardId);
    if (!vineyard) continue;
    const before = Number(vineyard.prior_block_acres) || 0;
    const { rows: aRows } = await client.query(
      `SELECT COALESCE(SUM(acres), 0) AS total FROM vineyard_blocks WHERE vineyard_id = $1`,
      [vineyardId]
    );
    const after = Number(aRows[0].total) || 0;
    if (before > 0) {
      const pct = Math.abs((after - before) / before) * 100;
      if (pct >= 5) {
        flaggedParcels.push({
          parcel_id: vineyardId,
          before_acres: before,
          after_acres: after,
          pct_change: Math.round(pct * 10) / 10,
        });
      }
    } else if (after > 0) {
      flaggedParcels.push({
        parcel_id: vineyardId,
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
      parcels_touched:     touchedVineyards.size,
    },
    errors,
    unlinked_buyers: Array.from(unlinkedCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    flagged_parcels: flaggedParcels,
    per_parcel: Array.from(perVineyard.values()),
  };
}
