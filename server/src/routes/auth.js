/**
 * Auth routes — magic-link flow for winery portal login.
 *
 * POST /api/auth/magic-link   — request a login link
 * GET  /api/auth/verify        — exchange token for session
 * POST /api/auth/logout        — clear session cookie
 * GET  /api/auth/me            — check if currently authenticated
 */
import express from 'express';
import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { sendMagicLinkEmail } from '../services/email.js';
import { signPortalToken, requirePortalAuth } from '../middleware/portalAuth.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Strict rate limit on magic-link requests: 5 per hour per IP
const magicLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/auth/magic-link
 * Body: { email: string }
 *
 * Always returns 200 to prevent email enumeration.
 */
router.post('/magic-link', magicLinkLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // Look up account
    const { rows } = await pool.query(
      `SELECT wa.id AS account_id, wa.winery_id, w.title AS winery_name
       FROM winery_accounts wa
       JOIN wineries w ON w.id = wa.winery_id
       WHERE LOWER(wa.contact_email) = $1`,
      [normalizedEmail]
    );

    if (rows.length === 0) {
      // Don't reveal whether the email exists
      return res.json({ message: 'If that email is registered, a login link has been sent.' });
    }

    const account = rows[0];

    // Invalidate any unused tokens for this account
    await pool.query(
      `UPDATE auth_tokens SET used = TRUE WHERE account_id = $1 AND used = FALSE`,
      [account.account_id]
    );

    // Generate a new token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await pool.query(
      `INSERT INTO auth_tokens (account_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [account.account_id, tokenHash, expiresAt]
    );

    // Send the email
    await sendMagicLinkEmail(normalizedEmail, rawToken, account.winery_name);

    res.json({ message: 'If that email is registered, a login link has been sent.' });
  } catch (err) {
    console.error('Magic link error:', err);
    // Still return success to avoid leaking info
    res.json({ message: 'If that email is registered, a login link has been sent.' });
  }
});

/**
 * GET /api/auth/verify?token=<hex>
 *
 * Validates the magic-link token and sets a session cookie.
 */
router.get('/verify', async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Token is required' });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const { rows } = await pool.query(
      `SELECT at.id AS token_id, at.account_id, at.expires_at, at.used,
              wa.winery_id
       FROM auth_tokens at
       JOIN winery_accounts wa ON wa.id = at.account_id
       WHERE at.token_hash = $1`,
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired link' });
    }

    const row = rows[0];

    if (row.used) {
      return res.status(401).json({ error: 'This link has already been used' });
    }

    if (new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'This link has expired' });
    }

    // Mark token as used
    await pool.query(`UPDATE auth_tokens SET used = TRUE WHERE id = $1`, [row.token_id]);

    // Mark email as verified + update last_login
    await pool.query(
      `UPDATE winery_accounts SET email_verified = TRUE, last_login = NOW() WHERE id = $1`,
      [row.account_id]
    );

    // Issue session JWT as httpOnly cookie
    const jwt = signPortalToken(row.account_id, row.winery_id);
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('portal_token', jwt, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    res.json({ success: true, wineryId: row.winery_id });
  } catch (err) {
    console.error('Token verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (_req, res) => {
  res.clearCookie('portal_token', { path: '/' });
  res.json({ success: true });
});

/**
 * GET /api/auth/me
 * Returns the current session info or 401.
 */
router.get('/me', requirePortalAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT wa.id, wa.contact_email, wa.email_verified, wa.last_login,
              w.id AS winery_id, w.title AS winery_name, w.image_url
       FROM winery_accounts wa
       JOIN wineries w ON w.id = wa.winery_id
       WHERE wa.id = $1`,
      [req.portalAccount.accountId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Auth /me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
