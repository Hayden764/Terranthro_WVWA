/**
 * Client portal routes — the shared login a client (OWB) uses to follow its
 * contract, accept delivered milestones and approve invoices.
 *
 * POST /api/client/login          — { username, password } → sets client_token cookie
 * POST /api/client/logout
 * GET  /api/client/me             — current client + whether the password must change
 * POST /api/client/set-password   — { currentPassword, password }
 * GET  /api/client/contracts      — the client's contracts
 * GET  /api/client/contracts/:id  — full timeline (milestones, invoices, files, updates)
 * GET  /api/client/files/:id      — download a file attached to one of the client's contracts
 *
 * POST /api/client/milestones/:id/accept           — { name }
 * POST /api/client/milestones/:id/request-changes  — { name, reason }
 * POST /api/client/invoices/:id/approve            — { name }
 *
 * GET  /api/client/contracts/:id/releases   — published data releases
 * GET  /api/client/releases/:rid/stats      — report figures for a release
 * GET  /api/client/releases/:rid/csv/:table — by-ava | by-county | by-size-class | change | blocks
 * GET  /api/client/ava-context[?format=csv] — statewide AVA climate, terrain, soils
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool.js';
import {
  CLIENT_COOKIE, clientCookieOptions, requireClientAuth, signClientToken,
} from '../middleware/clientAuth.js';
import { loadContractTimeline, todayIso } from '../services/contractTimeline.js';
import { logAuthEvent } from '../services/authActivity.js';
import { sendClientActionEmail } from '../services/email.js';
import {
  avaContext, avaContextCsv, listReleases, releaseBlocksCsv, releaseStats, statsTableCsv,
} from '../services/contractReleases.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Compared against when the username is unknown, so timing doesn't reveal it.
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8G6Y4s46HoPazTA/gkGEXLMaLLq5yK';

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const identifier = username.trim().toLowerCase();

  try {
    const { rows: [account] } = await pool.query(
      `SELECT id, password_hash, password_must_change FROM client_accounts WHERE username = $1`,
      [identifier]
    );
    const valid = await bcrypt.compare(password, account?.password_hash || DUMMY_HASH);

    await logAuthEvent({
      identifier,
      eventType: 'client_login',
      success: Boolean(account?.password_hash && valid),
      details: { client_id: account?.id ?? null },
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    if (!account?.password_hash || !valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    await pool.query(`UPDATE client_accounts SET last_login = NOW() WHERE id = $1`, [account.id]);
    res.cookie(CLIENT_COOKIE, signClientToken(account.id), clientCookieOptions());
    res.json({ success: true, mustChangePassword: account.password_must_change });
  } catch (err) {
    console.error('Client login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (_req, res) => {
  const { maxAge, ...opts } = clientCookieOptions();
  res.clearCookie(CLIENT_COOKIE, opts);
  res.json({ success: true });
});

// ─── Everything below requires the client session ────────────────

router.use(requireClientAuth);

router.get('/me', async (req, res) => {
  try {
    const { rows: [me] } = await pool.query(
      `SELECT id, slug, name, username, password_must_change, last_login
       FROM client_accounts WHERE id = $1`,
      [req.clientAccount.clientId]
    );
    if (!me) return res.status(401).json({ error: 'Account not found' });
    res.json(me);
  } catch (err) {
    console.error('Client /me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/set-password', async (req, res) => {
  const { currentPassword, password } = req.body;
  if (typeof password !== 'string' || password.length < 10) {
    return res.status(400).json({ error: 'New password must be at least 10 characters' });
  }
  try {
    const { rows: [account] } = await pool.query(
      `SELECT password_hash FROM client_accounts WHERE id = $1`,
      [req.clientAccount.clientId]
    );
    if (!account) return res.status(401).json({ error: 'Account not found' });
    const ok = account.password_hash
      && typeof currentPassword === 'string'
      && await bcrypt.compare(currentPassword, account.password_hash);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `UPDATE client_accounts SET password_hash = $1, password_must_change = FALSE WHERE id = $2`,
      [hash, req.clientAccount.clientId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Client set-password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/contracts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, slug, title FROM contracts WHERE client_account_id = $1 ORDER BY id`,
      [req.clientAccount.clientId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Client contracts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/contracts/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid contract id' });
  try {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM contracts WHERE id = $1 AND client_account_id = $2`,
      [id, req.clientAccount.clientId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Contract not found' });
    res.json(await loadContractTimeline(pool, id));
  } catch (err) {
    console.error('Client contract timeline error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Data tab ────────────────────────────────────────────────────

/** Send CSV text as a download; the BOM makes Excel read it as UTF-8. */
export function sendCsv(res, filename, csv) {
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename.replace(/["\\\r\n]/g, '_')}"`,
    'Cache-Control': 'private, no-store',
  });
  res.send(`﻿${csv}`);
}

/** A published release on one of this client's contracts, or null. */
async function clientRelease(req) {
  const rid = parseInt(req.params.rid, 10);
  if (!Number.isInteger(rid)) return null;
  const { rows: [r] } = await pool.query(
    `SELECT r.id, r.label FROM contract_releases r JOIN contracts c ON c.id = r.contract_id
     WHERE r.id = $1 AND c.client_account_id = $2 AND r.published_at IS NOT NULL`,
    [rid, req.clientAccount.clientId]
  );
  return r || null;
}

router.get('/contracts/:id/releases', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM contracts WHERE id = $1 AND client_account_id = $2`,
      [Number.isInteger(id) ? id : 0, req.clientAccount.clientId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Contract not found' });
    res.json(await listReleases(pool, id, { publishedOnly: true }));
  } catch (err) {
    console.error('Client releases error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/releases/:rid/stats', async (req, res) => {
  try {
    const release = await clientRelease(req);
    if (!release) return res.status(404).json({ error: 'Release not found' });
    res.json(await releaseStats(pool, release.id));
  } catch (err) {
    console.error('Client release stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/releases/:rid/csv/:table', async (req, res) => {
  try {
    const release = await clientRelease(req);
    if (!release) return res.status(404).json({ error: 'Release not found' });
    const { table } = req.params;
    const csv = table === 'blocks'
      ? await releaseBlocksCsv(pool, release.id)
      : statsTableCsv(await releaseStats(pool, release.id), table);
    if (csv == null) return res.status(404).json({ error: 'Unknown table' });
    sendCsv(res, `owb-release-${release.id}-${table}.csv`, csv);
  } catch (err) {
    console.error('Client release CSV error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/ava-context', async (req, res) => {
  try {
    const rows = await avaContext(pool);
    if (req.query.format === 'csv') return sendCsv(res, 'oregon-ava-context.csv', avaContextCsv(rows));
    res.json(rows);
  } catch (err) {
    console.error('Client AVA context error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Client actions ──────────────────────────────────────────────
// The login is shared, so every action carries the name of whoever took it.

function actorName(req, res) {
  const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 120) : '';
  if (!name) {
    res.status(400).json({ error: 'Please enter your name' });
    return null;
  }
  return name;
}

/**
 * Lock one of this client's milestones for an action. Returns the row, or
 * sends a 404 and returns null.
 */
async function lockMilestone(db, req, res) {
  const id = parseInt(req.params.id, 10);
  const { rows: [m] } = await db.query(
    `SELECT m.id, m.contract_id, m.number, m.title, m.status, m.base_amount + m.additional_amount AS amount,
            c.contractor_email
     FROM contract_milestones m JOIN contracts c ON c.id = m.contract_id
     WHERE m.id = $1 AND c.client_account_id = $2
     FOR UPDATE OF m`,
    [Number.isInteger(id) ? id : 0, req.clientAccount.clientId]
  );
  if (!m) res.status(404).json({ error: 'Milestone not found' });
  return m || null;
}

const milestoneLabel = (m) => (m.number == null ? m.title : `Milestone ${m.number}`);

/** Email Terranthro about a client action; a failed email never undoes the action. */
async function notifyContractor(to, email) {
  if (!to) return;
  try {
    await sendClientActionEmail({ to, ...email });
  } catch (err) {
    console.error('Client action email failed:', err);
  }
}

/** Run `fn` in a transaction; `fn` returns an email to send after commit, or null. */
async function inTransaction(res, label, fn) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const after = await fn(db);
    if (res.headersSent) {
      await db.query('ROLLBACK');
      return;
    }
    await db.query('COMMIT');
    res.json({ success: true });
    if (after) await notifyContractor(after.to, after.email);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error(`Client ${label} error:`, err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  } finally {
    db.release();
  }
}

/** POST /api/client/milestones/:id/accept — { name } */
router.post('/milestones/:id/accept', (req, res) => {
  const name = actorName(req, res);
  if (!name) return;
  inTransaction(res, 'accept', async (db) => {
    const m = await lockMilestone(db, req, res);
    if (!m) return null;
    if (m.status !== 'delivered') {
      res.status(409).json({ error: 'Only a delivered milestone can be accepted' });
      return null;
    }
    const today = todayIso();
    await db.query(
      `UPDATE contract_milestones
       SET status = 'accepted', accepted_at = $2, acceptance = 'explicit', accepted_by = $3, updated_at = NOW()
       WHERE id = $1`,
      [m.id, today, name]
    );
    await db.query(
      `INSERT INTO contract_updates (contract_id, milestone_id, body, posted_on) VALUES ($1, $2, $3, $4)`,
      [m.contract_id, m.id, `${milestoneLabel(m)} accepted by ${name} (OWB): ${m.title}`, today]
    );
    return {
      to: m.contractor_email,
      email: {
        subject: `OWB accepted ${milestoneLabel(m)}: ${m.title}`,
        summary: `${name} accepted ${milestoneLabel(m)} (${m.title}) in the OWB Portal. It is ready to invoice ($${Number(m.amount).toLocaleString()}).`,
      },
    };
  });
});

/** POST /api/client/milestones/:id/request-changes — { name, reason } */
router.post('/milestones/:id/request-changes', (req, res) => {
  const name = actorName(req, res);
  if (!name) return;
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 10) {
    return res.status(400).json({ error: 'Please describe what needs to change' });
  }
  inTransaction(res, 'request-changes', async (db) => {
    const m = await lockMilestone(db, req, res);
    if (!m) return null;
    if (m.status !== 'delivered') {
      res.status(409).json({ error: 'Changes can only be requested on a delivered milestone' });
      return null;
    }
    const today = todayIso();
    await db.query(
      `UPDATE contract_milestones
       SET status = 'revising', rejected_at = $2, rejected_by = $3, rejection_note = $4, updated_at = NOW()
       WHERE id = $1`,
      [m.id, today, name, reason]
    );
    await db.query(
      `INSERT INTO contract_updates (contract_id, milestone_id, body, posted_on) VALUES ($1, $2, $3, $4)`,
      [m.contract_id, m.id, `${name} (OWB) requested changes to ${milestoneLabel(m)}:\n${reason}`, today]
    );
    return {
      to: m.contractor_email,
      email: {
        subject: `OWB requested changes to ${milestoneLabel(m)}: ${m.title}`,
        summary: `${name} requested changes to ${milestoneLabel(m)} (${m.title}) in the OWB Portal. Under the contract, revisions are due within 15 business days.`,
        note: reason,
      },
    };
  });
});

/** POST /api/client/invoices/:id/approve — { name } */
router.post('/invoices/:id/approve', (req, res) => {
  const name = actorName(req, res);
  if (!name) return;
  inTransaction(res, 'invoice approve', async (db) => {
    const id = parseInt(req.params.id, 10);
    const { rows: [inv] } = await db.query(
      `SELECT i.id, i.contract_id, i.milestone_id, i.invoice_number, i.amount, i.approved_on, i.paid_on,
              c.contractor_email
       FROM contract_invoices i JOIN contracts c ON c.id = i.contract_id
       WHERE i.id = $1 AND c.client_account_id = $2
       FOR UPDATE OF i`,
      [Number.isInteger(id) ? id : 0, req.clientAccount.clientId]
    );
    if (!inv) {
      res.status(404).json({ error: 'Invoice not found' });
      return null;
    }
    if (inv.approved_on || inv.paid_on) {
      res.status(409).json({ error: 'This invoice is already approved' });
      return null;
    }
    const today = todayIso();
    await db.query(
      `UPDATE contract_invoices SET approved_on = $2, approved_by = $3 WHERE id = $1`,
      [inv.id, today, name]
    );
    await db.query(
      `INSERT INTO contract_updates (contract_id, milestone_id, body, posted_on) VALUES ($1, $2, $3, $4)`,
      [inv.contract_id, inv.milestone_id, `Invoice ${inv.invoice_number} approved for payment by ${name} (OWB)`, today]
    );
    return {
      to: inv.contractor_email,
      email: {
        subject: `OWB approved invoice ${inv.invoice_number} for payment`,
        summary: `${name} approved invoice ${inv.invoice_number} ($${Number(inv.amount).toLocaleString()}) for payment in the OWB Portal.`,
      },
    };
  });
});

router.get('/files/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid file id' });
  try {
    const { rows: [file] } = await pool.query(
      `SELECT f.filename, f.content_type, f.data
       FROM contract_files f JOIN contracts c ON c.id = f.contract_id
       WHERE f.id = $1 AND c.client_account_id = $2`,
      [id, req.clientAccount.clientId]
    );
    if (!file) return res.status(404).json({ error: 'File not found' });
    sendFile(res, file, req.query.download === '1');
  } catch (err) {
    console.error('Client file download error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/** Stream a contract_files row; inline by default so PDFs open in the browser. */
export function sendFile(res, file, asAttachment = false) {
  const safeName = file.filename.replace(/["\\\r\n]/g, '_');
  res.set({
    'Content-Type': file.content_type,
    'Content-Length': file.data.length,
    'Content-Disposition': `${asAttachment ? 'attachment' : 'inline'}; filename="${safeName}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(file.data);
}

export default router;
