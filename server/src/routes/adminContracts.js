/**
 * Admin routes for client contracts — where Terranthro records progress the
 * client (OWB) then sees in its portal. Mounted at /api/admin/contracts.
 *
 * GET    /                                    — contracts with their client
 * GET    /:id                                 — full timeline + client notify list
 * PATCH  /:id                                 — { effective_date, contractor_email }
 * PATCH  /milestones/:mid                     — status, dates, delivery note, delay
 * POST   /milestones/:mid/send-delivery-notice — email the client that it was delivered
 * POST   /milestones/:mid/tasks               — { label }
 * PATCH  /tasks/:tid                          — { label?, done? }
 * DELETE /tasks/:tid
 * POST   /:id/files?title=&filename=&kind=&milestone_id=   — raw file body
 * GET    /files/:fid
 * DELETE /files/:fid
 * POST   /:id/invoices                        — { milestone_id, invoice_number, amount, issued_on, due_on?, file_id?, notes? }
 * PATCH  /invoices/:iid                       — { paid_on?, file_id?, notes?, … }
 * DELETE /invoices/:iid
 * POST   /:id/updates                         — { body, milestone_id?, posted_on? }
 * DELETE /updates/:uid
 * PATCH  /clients/:cid                        — { notify_emails }
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
import {
  addBusinessDays, addDays, loadContractTimeline, todayIso,
} from '../services/contractTimeline.js';
import { sendMilestoneDeliveredEmail } from '../services/email.js';
import { sendCsv, sendFile } from './client.js';
import {
  buildRelease, forgetRelease, listReleases, releaseBlocksCsv, releaseStats, statsTableCsv,
} from '../services/contractReleases.js';
import { forgetQuerySchema, handleQuery, querySchema } from '../services/contractQuery.js';

const router = express.Router();
router.use(requireAdminAuth);

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const STATUSES = ['not_started', 'in_progress', 'delivered', 'revising', 'accepted'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const intParam = (v) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
};
const emptyToNull = (v) => (v == null || v === '' ? null : v);
const milestoneLabel = (m) => (m.number == null ? m.title : `Milestone ${m.number}`);

function badDate(...values) {
  return values.some((v) => v != null && v !== '' && !ISO_DATE.test(v));
}

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
      if (err.code === '23503') return res.status(409).json({ error: 'Still referenced by another record' });
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
  const [{ rows: [client] }, { rows: [{ contractor_email }] }] = await Promise.all([
    pool.query(
      `SELECT id, name, username, notify_emails, last_login FROM client_accounts WHERE id = $1`,
      [timeline.contract.client_id]
    ),
    pool.query(`SELECT contractor_email FROM contracts WHERE id = $1`, [timeline.contract.id]),
  ]);
  res.json({ ...timeline, contract: { ...timeline.contract, contractor_email }, client });
}));

router.patch('/:id(\\d+)', handle(async (req, res) => {
  const { effective_date } = req.body;
  const contractorEmail = emptyToNull(String(req.body.contractor_email ?? '').trim().toLowerCase());
  if (badDate(effective_date)) return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
  if (contractorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contractorEmail)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  const { rowCount } = await pool.query(
    `UPDATE contracts SET effective_date = $1, contractor_email = $2 WHERE id = $3`,
    [emptyToNull(effective_date), contractorEmail, intParam(req.params.id)]
  );
  if (!rowCount) return res.status(404).json({ error: 'Contract not found' });
  res.json({ success: true });
}));

// ─── Milestones ──────────────────────────────────────────────────

const MILESTONE_FIELDS = [
  'status', 'started_at', 'delivered_at', 'accepted_at', 'acceptance', 'delivery_note',
  'target_date', 'revised_target_date', 'delay_reason', 'due_label',
];
const DATE_FIELDS = new Set(['started_at', 'delivered_at', 'accepted_at', 'target_date', 'revised_target_date']);

router.patch('/milestones/:mid', handle(async (req, res) => {
  const mid = intParam(req.params.mid);
  const { rows: [cur] } = await pool.query(
    `SELECT id, contract_id, kind, number, title, status, started_at::text,
            delivered_at::text, accepted_at::text, acceptance
     FROM contract_milestones WHERE id = $1`,
    [mid]
  );
  if (!cur) return res.status(404).json({ error: 'Milestone not found' });

  const patch = {};
  for (const f of MILESTONE_FIELDS) {
    if (f in req.body) patch[f] = DATE_FIELDS.has(f) || f === 'acceptance' ? emptyToNull(req.body[f]) : req.body[f];
  }
  if (patch.status != null && !STATUSES.includes(patch.status)) {
    return res.status(400).json({ error: 'Unknown status' });
  }
  if (badDate(...[...DATE_FIELDS].map((f) => patch[f]))) {
    return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
  }

  // Moving to a status stamps the date it happened, unless one was given.
  const today = todayIso();
  const status = patch.status ?? cur.status;
  if (patch.status && patch.status !== cur.status) {
    if (status === 'in_progress' && !cur.started_at && !('started_at' in patch)) patch.started_at = today;
    if (status === 'delivered' && !('delivered_at' in patch)) patch.delivered_at = today;
    if (status === 'accepted') {
      if (!('accepted_at' in patch)) patch.accepted_at = today;
      if (!('acceptance' in patch)) patch.acceptance = cur.kind === 'hosting' ? 'on_execution' : 'explicit';
    }
    if (status !== 'accepted') {
      patch.accepted_at = null;
      patch.acceptance = null;
      patch.accepted_by = null;
    }
  }
  if (patch.acceptance != null && !['explicit', 'deemed', 'on_execution'].includes(patch.acceptance)) {
    return res.status(400).json({ error: 'Unknown acceptance type' });
  }

  const keys = Object.keys(patch);
  if (!keys.length) return res.status(400).json({ error: 'Nothing to update' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE contract_milestones
       SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW()
       WHERE id = $1`,
      [mid, ...keys.map((k) => patch[k])]
    );

    // Status changes the client cares about go on its activity feed.
    if (patch.status && patch.status !== cur.status) {
      const label = milestoneLabel(cur);
      const body = {
        delivered: `${label} delivered for review: ${cur.title}`,
        accepted: patch.acceptance === 'deemed'
          ? `${label} accepted (review period ended): ${cur.title}`
          : `${label} accepted: ${cur.title}`,
        revising: `${label} returned for revisions: ${cur.title}`,
      }[patch.status];
      const postedOn = { delivered: patch.delivered_at, accepted: patch.accepted_at }[patch.status] || today;
      if (body && cur.kind === 'milestone') {
        await client.query(
          `INSERT INTO contract_updates (contract_id, milestone_id, body, posted_on) VALUES ($1, $2, $3, $4)`,
          [cur.contract_id, mid, body, postedOn]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  res.json({ success: true });
}));

router.post('/milestones/:mid/send-delivery-notice', handle(async (req, res) => {
  const mid = intParam(req.params.mid);
  const { rows: [m] } = await pool.query(
    `SELECT m.id, m.contract_id, m.number, m.title, m.status, m.delivered_at::text, m.delivery_note,
            c.title AS contract_title, c.review_business_days,
            ca.name AS client_name, ca.notify_emails
     FROM contract_milestones m
     JOIN contracts c ON c.id = m.contract_id
     JOIN client_accounts ca ON ca.id = c.client_account_id
     WHERE m.id = $1`,
    [mid]
  );
  if (!m) return res.status(404).json({ error: 'Milestone not found' });
  if (m.status !== 'delivered' || !m.delivered_at) {
    return res.status(400).json({ error: 'Mark the milestone delivered first' });
  }
  if (!m.notify_emails.length) {
    return res.status(400).json({ error: 'The client has no notification addresses' });
  }

  const { rows: files } = await pool.query(
    `SELECT title FROM contract_files WHERE milestone_id = $1 AND kind <> 'invoice' ORDER BY uploaded_at`,
    [mid]
  );

  try {
    await sendMilestoneDeliveredEmail({
      to: m.notify_emails,
      replyTo: req.adminAccount.email,
      clientName: m.client_name,
      contractTitle: m.contract_title,
      milestoneLabel: milestoneLabel(m),
      title: m.title,
      note: m.delivery_note,
      deliveredOn: m.delivered_at,
      reviewBy: addBusinessDays(m.delivered_at, m.review_business_days),
      fileTitles: files.map((f) => f.title),
    });
  } catch (err) {
    console.error('Delivery notice email failed:', err);
    return res.status(502).json({ error: 'The delivery email could not be sent. The milestone is still marked delivered.' });
  }
  await pool.query(`UPDATE contract_milestones SET delivery_emailed_at = NOW() WHERE id = $1`, [mid]);
  res.json({ success: true, sent_to: m.notify_emails });
}));

// ─── Tasks ───────────────────────────────────────────────────────

router.post('/milestones/:mid/tasks', handle(async (req, res) => {
  const label = String(req.body.label || '').trim();
  if (!label) return res.status(400).json({ error: 'Label is required' });
  const { rows: [task] } = await pool.query(
    `INSERT INTO contract_tasks (milestone_id, label, sort_order)
     SELECT $1, $2, COALESCE(MAX(sort_order) + 1, 0) FROM contract_tasks WHERE milestone_id = $1
     RETURNING id`,
    [intParam(req.params.mid), label]
  );
  res.status(201).json(task);
}));

router.patch('/tasks/:tid', handle(async (req, res) => {
  const tid = intParam(req.params.tid);
  const sets = [];
  const vals = [tid];
  if ('label' in req.body) {
    const label = String(req.body.label || '').trim();
    if (!label) return res.status(400).json({ error: 'Label is required' });
    vals.push(label);
    sets.push(`label = $${vals.length}`);
  }
  if ('done' in req.body) {
    vals.push(Boolean(req.body.done));
    sets.push(`done = $${vals.length}`, `done_at = CASE WHEN $${vals.length} THEN CURRENT_DATE END`);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  const { rowCount } = await pool.query(`UPDATE contract_tasks SET ${sets.join(', ')} WHERE id = $1`, vals);
  if (!rowCount) return res.status(404).json({ error: 'Task not found' });
  res.json({ success: true });
}));

router.delete('/tasks/:tid', handle(async (req, res) => {
  await pool.query(`DELETE FROM contract_tasks WHERE id = $1`, [intParam(req.params.tid)]);
  res.json({ success: true });
}));

// ─── Files ───────────────────────────────────────────────────────

router.post(
  '/:id(\\d+)/files',
  express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
  handle(async (req, res) => {
    const contractId = intParam(req.params.id);
    const contentType = (req.get('content-type') || '').split(';')[0].trim();
    const { title, filename } = req.query;
    const kind = req.query.kind || 'deliverable';
    const milestoneId = req.query.milestone_id ? intParam(req.query.milestone_id) : null;

    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Empty file' });
    if (!ALLOWED_TYPES.has(contentType)) return res.status(415).json({ error: `File type ${contentType || 'unknown'} not allowed` });
    if (!filename || !title) return res.status(400).json({ error: 'title and filename are required' });
    if (!['invoice', 'deliverable', 'notice', 'other'].includes(kind)) return res.status(400).json({ error: 'Unknown kind' });
    if (!(await milestoneInContract(milestoneId, contractId))) return res.status(400).json({ error: 'Milestone is not on this contract' });

    const { rows: [file] } = await pool.query(
      `INSERT INTO contract_files (contract_id, milestone_id, kind, title, filename, content_type, size_bytes, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [contractId, milestoneId, kind, String(title).slice(0, 200), String(filename).slice(0, 255),
       contentType, req.body.length, req.body]
    );
    res.status(201).json(file);
  })
);

router.get('/files/:fid', handle(async (req, res) => {
  const { rows: [file] } = await pool.query(
    `SELECT filename, content_type, data FROM contract_files WHERE id = $1`,
    [intParam(req.params.fid)]
  );
  if (!file) return res.status(404).json({ error: 'File not found' });
  sendFile(res, file, req.query.download === '1');
}));

router.delete('/files/:fid', handle(async (req, res) => {
  await pool.query(`DELETE FROM contract_files WHERE id = $1`, [intParam(req.params.fid)]);
  res.json({ success: true });
}));

// ─── Invoices ────────────────────────────────────────────────────

router.post('/:id(\\d+)/invoices', handle(async (req, res) => {
  const contractId = intParam(req.params.id);
  const { invoice_number, amount, issued_on, due_on, notes } = req.body;
  const milestoneId = intParam(req.body.milestone_id);
  const fileId = req.body.file_id ? intParam(req.body.file_id) : null;

  if (!milestoneId || !invoice_number || !issued_on || !(Number(amount) > 0)) {
    return res.status(400).json({ error: 'milestone_id, invoice_number, amount and issued_on are required' });
  }
  if (badDate(issued_on, due_on)) return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
  if (!(await milestoneInContract(milestoneId, contractId))) return res.status(400).json({ error: 'Milestone is not on this contract' });

  const { rows: [{ payment_terms_days: terms }] } = await pool.query(
    `SELECT payment_terms_days FROM contracts WHERE id = $1`, [contractId]
  );
  const { rows: [inv] } = await pool.query(
    `INSERT INTO contract_invoices (contract_id, milestone_id, invoice_number, amount, issued_on, due_on, file_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [contractId, milestoneId, String(invoice_number).trim(), Number(amount), issued_on,
     emptyToNull(due_on) || addDays(issued_on, terms), fileId, notes || null]
  );
  res.status(201).json(inv);
}));

router.patch('/invoices/:iid', handle(async (req, res) => {
  const allowed = ['invoice_number', 'amount', 'issued_on', 'due_on', 'paid_on', 'file_id', 'notes'];
  const patch = {};
  for (const f of allowed) if (f in req.body) patch[f] = req.body[f] === '' ? null : req.body[f];
  if (badDate(patch.issued_on, patch.due_on, patch.paid_on)) return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
  const keys = Object.keys(patch);
  if (!keys.length) return res.status(400).json({ error: 'Nothing to update' });
  const { rowCount } = await pool.query(
    `UPDATE contract_invoices SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
    [intParam(req.params.iid), ...keys.map((k) => patch[k])]
  );
  if (!rowCount) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ success: true });
}));

router.delete('/invoices/:iid', handle(async (req, res) => {
  await pool.query(`DELETE FROM contract_invoices WHERE id = $1`, [intParam(req.params.iid)]);
  res.json({ success: true });
}));

// ─── Activity feed ───────────────────────────────────────────────

router.post('/:id(\\d+)/updates', handle(async (req, res) => {
  const contractId = intParam(req.params.id);
  const body = String(req.body.body || '').trim();
  const milestoneId = req.body.milestone_id ? intParam(req.body.milestone_id) : null;
  if (!body) return res.status(400).json({ error: 'Update text is required' });
  if (badDate(req.body.posted_on)) return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
  if (!(await milestoneInContract(milestoneId, contractId))) return res.status(400).json({ error: 'Milestone is not on this contract' });
  const { rows: [u] } = await pool.query(
    `INSERT INTO contract_updates (contract_id, milestone_id, body, posted_on)
     VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE)) RETURNING id`,
    [contractId, milestoneId, body, emptyToNull(req.body.posted_on)]
  );
  res.status(201).json(u);
}));

router.delete('/updates/:uid', handle(async (req, res) => {
  await pool.query(`DELETE FROM contract_updates WHERE id = $1`, [intParam(req.params.uid)]);
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
     WHERE id = $1 RETURNING id, contract_id, milestone_id, label, published_at`,
    [rid]
  );
  if (!r) return res.status(404).json({ error: 'Release not found' });
  if (req.params.action === 'publish') {
    await pool.query(
      `INSERT INTO contract_updates (contract_id, milestone_id, body)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (SELECT 1 FROM contract_updates WHERE contract_id = $1 AND body = $3)`,
      [r.contract_id, r.milestone_id, `Data release published: ${r.label}`]
    );
  }
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

// ─── Client account ──────────────────────────────────────────────

router.patch('/clients/:cid', handle(async (req, res) => {
  const emails = Array.isArray(req.body.notify_emails) ? req.body.notify_emails : null;
  if (!emails) return res.status(400).json({ error: 'notify_emails must be a list' });
  const clean = [...new Set(emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  if (clean.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  const { rowCount } = await pool.query(
    `UPDATE client_accounts SET notify_emails = $1 WHERE id = $2`,
    [clean, intParam(req.params.cid)]
  );
  if (!rowCount) return res.status(404).json({ error: 'Client not found' });
  res.json({ success: true, notify_emails: clean });
}));

export default router;
