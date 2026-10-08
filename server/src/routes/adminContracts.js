/**
 * Admin routes for client contracts — where Terranthro records progress the
 * client (OWB) then sees in its portal. Mounted at /api/admin/contracts.
 *
 * GET    /                                    — contracts with their client
 * GET    /:id                                 — timeline + the client's login
 * PATCH  /milestones/:mid                     — { status?, invoice_sent_on?, invoice_paid_on? }
 *
 * GET    /:id/releases                        — releases (drafts too) + the live OWB dataset by AVA
 * POST   /:id/releases                        — { milestone_id?, label, scope_avas, scope_outside_avas, notes? }
 * POST   /releases/:rid/publish | /unpublish
 * DELETE /releases/:rid                       — drafts only
 * GET    /releases/:rid/stats
 * GET    /releases/:rid/csv/:table            — by-ava | by-county | by-size-class | change | blocks
 * GET    /releases/:rid/query/schema | /releases/:rid/query?q=<spec>  — the query builder
 */
import express from 'express';
import { pool } from '../db/pool.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { loadContractTimeline } from '../services/contractTimeline.js';
import { sendCsv } from './client.js';
import {
  buildRelease, forgetRelease, listReleases, releaseBlocksCsv, releaseStats, statsTableCsv,
} from '../services/contractReleases.js';
import { forgetQuerySchema, handleQuery, querySchema } from '../services/contractQuery.js';

const router = express.Router();
router.use(requireAdminAuth);

const STATUSES = ['not_started', 'in_progress', 'complete'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const intParam = (v) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
};

async function milestoneInContract(milestoneId, contractId) {
  if (milestoneId == null) return true;
  const { rowCount } = await pool.query(
    `SELECT 1 FROM contract_milestones WHERE id = $1 AND contract_id = $2`,
    [milestoneId, contractId]
  );
  return rowCount > 0;
}

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`Admin contracts ${req.method} ${req.originalUrl}:`, err);
      if (err.code === '23505') return res.status(409).json({ error: 'That already exists' });
      res.status(500).json({ error: 'Server error' });
    }
  };
}

// ─── Contracts ───────────────────────────────────────────────────

router.get('/', handle(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.slug, c.title, c.nte_amount, ca.id AS client_id, ca.name AS client_name
     FROM contracts c JOIN client_accounts ca ON ca.id = c.client_account_id
     ORDER BY c.id`
  );
  res.json(rows.map((r) => ({ ...r, nte_amount: Number(r.nte_amount) })));
}));

router.get('/:id(\\d+)', handle(async (req, res) => {
  const timeline = await loadContractTimeline(pool, intParam(req.params.id));
  if (!timeline) return res.status(404).json({ error: 'Contract not found' });
  const { rows: [client] } = await pool.query(
    `SELECT id, name, username, last_login FROM client_accounts WHERE id = $1`,
    [timeline.contract.client_id]
  );
  res.json({ ...timeline, client });
}));

// ─── Milestones ──────────────────────────────────────────────────

router.patch('/milestones/:mid', handle(async (req, res) => {
  const sets = [];
  const values = [];
  if ('status' in req.body) {
    if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Unknown status' });
    values.push(req.body.status);
    sets.push(`status = $${values.length}`);
  }
  for (const col of ['invoice_sent_on', 'invoice_paid_on']) {
    if (!(col in req.body)) continue;
    const v = req.body[col] || null;
    if (v && !ISO_DATE.test(v)) return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
    values.push(v);
    sets.push(`${col} = $${values.length}`);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  values.push(intParam(req.params.mid));
  const { rowCount } = await pool.query(
    `UPDATE contract_milestones SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
    values
  );
  if (!rowCount) return res.status(404).json({ error: 'Milestone not found' });
  res.json({ success: true });
}));

// ─── Data releases ───────────────────────────────────────────────

router.get('/:id(\\d+)/releases', handle(async (req, res) => {
  const contractId = intParam(req.params.id);
  const [releases, live, avas, total] = await Promise.all([
    listReleases(pool, contractId, { publishedOnly: false }),
    // What a new release would copy: live OWB blocks per AVA.
    pool.query(
      `SELECT COALESCE(a.slug, '') AS slug, COALESCE(a.name, 'Outside any AVA') AS name,
              count(*)::int AS blocks, round(sum(b.acres)::numeric, 1)::float AS acres
       FROM vineyard_blocks b
       CROSS JOIN LATERAL (SELECT ST_PointOnSurface(b.geometry) AS pt) p
       LEFT JOIN ava_subdivided s ON ST_Intersects(s.geometry, p.pt)
       LEFT JOIN avas a ON a.id = s.ava_id
       WHERE b.owb_dataset AND b.geometry IS NOT NULL
       GROUP BY 1, 2 ORDER BY 2`
    ),
    pool.query(`SELECT slug, name FROM avas WHERE removed IS NULL ORDER BY name`),
    pool.query(
      `SELECT count(*)::int AS blocks, COALESCE(round(sum(acres)::numeric, 1), 0)::float AS acres
       FROM vineyard_blocks WHERE owb_dataset AND geometry IS NOT NULL`
    ),
  ]);
  // A block counts once in the total but in every AVA it falls in below it.
  res.json({ releases, live_total: total.rows[0], live_by_ava: live.rows, avas: avas.rows });
}));

router.post('/:id(\\d+)/releases', handle(async (req, res) => {
  const contractId = intParam(req.params.id);
  const label = String(req.body.label || '').trim().slice(0, 200);
  const scopeAvas = Array.isArray(req.body.scope_avas)
    ? [...new Set(req.body.scope_avas.map(String).filter((s) => /^[a-z0-9-]+$/.test(s)))]
    : [];
  const scopeOutsideAvas = Boolean(req.body.scope_outside_avas);
  const milestoneId = req.body.milestone_id ? intParam(req.body.milestone_id) : null;

  if (!label) return res.status(400).json({ error: 'A label is required' });
  if (!scopeAvas.length && !scopeOutsideAvas) {
    return res.status(400).json({ error: 'Choose at least one AVA, or blocks outside any AVA' });
  }
  if (!(await milestoneInContract(milestoneId, contractId))) {
    return res.status(400).json({ error: 'Milestone is not on this contract' });
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const release = await buildRelease(db, {
      contractId, milestoneId, label, scopeAvas, scopeOutsideAvas,
      notes: String(req.body.notes || '').trim() || null,
    });
    await db.query('COMMIT');
    res.status(201).json(release);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}));

router.post('/releases/:rid/:action(publish|unpublish)', handle(async (req, res) => {
  const rid = intParam(req.params.rid);
  const { rows: [r] } = await pool.query(
    `UPDATE contract_releases SET published_at = ${req.params.action === 'publish' ? 'COALESCE(published_at, NOW())' : 'NULL'}
     WHERE id = $1 RETURNING id, label, published_at`,
    [rid]
  );
  if (!r) return res.status(404).json({ error: 'Release not found' });
  res.json(r);
}));

router.delete('/releases/:rid', handle(async (req, res) => {
  const rid = intParam(req.params.rid);
  const { rowCount } = await pool.query(
    `DELETE FROM contract_releases WHERE id = $1 AND published_at IS NULL`,
    [rid]
  );
  if (!rowCount) return res.status(409).json({ error: 'Only an unpublished release can be deleted' });
  forgetRelease(rid);
  forgetQuerySchema(rid);
  res.json({ success: true });
}));

router.get('/releases/:rid/stats', handle(async (req, res) => {
  res.json(await releaseStats(pool, intParam(req.params.rid)));
}));

router.get('/releases/:rid/query/schema', handle(async (req, res) => {
  res.json(await querySchema(pool, intParam(req.params.rid)));
}));

router.get('/releases/:rid/query', handle(async (req, res) => {
  await handleQuery(pool, intParam(req.params.rid), req, res, sendCsv);
}));

router.get('/releases/:rid/csv/:table', handle(async (req, res) => {
  const rid = intParam(req.params.rid);
  const { table } = req.params;
  const csv = table === 'blocks'
    ? await releaseBlocksCsv(pool, rid)
    : statsTableCsv(await releaseStats(pool, rid), table);
  if (csv == null) return res.status(404).json({ error: 'Unknown table' });
  sendCsv(res, `owb-release-${rid}-${table}.csv`, csv);
}));

export default router;
