/**
 * Client portal routes — the shared login a client (OWB) uses to follow its
 * contract. Read-only apart from the client's own password.
 *
 * POST /api/client/login          — { username, password } → sets client_token cookie
 * POST /api/client/logout
 * GET  /api/client/me             — current client + whether the password must change
 * POST /api/client/set-password   — { currentPassword, password }
 * GET  /api/client/contracts      — the client's contracts
 * GET  /api/client/contracts/:id  — full timeline (milestones, invoices, files, updates)
 * GET  /api/client/files/:id      — download a file attached to one of the client's contracts
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool.js';
import {
  CLIENT_COOKIE, clientCookieOptions, requireClientAuth, signClientToken,
} from '../middleware/clientAuth.js';
import { loadContractTimeline } from '../services/contractTimeline.js';
import { logAuthEvent } from '../services/authActivity.js';

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
