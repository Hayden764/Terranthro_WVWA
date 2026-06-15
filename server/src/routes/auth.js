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
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { sendMagicLinkEmail, sendEmailChangeConfirmation } from '../services/email.js';
import { signPortalToken, requirePortalAuth } from '../middleware/portalAuth.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

function portalCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    // Frontend (wvwa.terranthro.com) and API (api.terranthro.com) share the
    // terranthro.com registrable domain, so requests are same-site — Lax works.
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  };
}

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

    res.cookie('portal_token', jwt, portalCookieOptions());

    res.json({ success: true, wineryId: row.winery_id });
  } catch (err) {
    console.error('Token verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Rate limit password login: 10 attempts per 15 min per IP
const passwordLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/auth/login
 * Body: { email: string, password: string }
 *
 * Password-based login for winery portal accounts that have a password set.
 */
router.post('/login', passwordLoginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { rows } = await pool.query(
      `SELECT wa.id AS account_id, wa.winery_id, wa.password_hash
       FROM winery_accounts wa
       WHERE LOWER(wa.contact_email) = $1`,
      [normalizedEmail]
    );

    // Use a dummy compare to prevent timing attacks even when account not found
    const dummyHash = '$2a$12$invalidhashpaddingtomakethissafefromtiming00000000000000';
    const storedHash = rows[0]?.password_hash ?? dummyHash;

    if (!rows[0]?.password_hash) {
      await bcrypt.compare(password, dummyHash);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, storedHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const account = rows[0];

    await pool.query(
      `UPDATE winery_accounts SET last_login = NOW() WHERE id = $1`,
      [account.account_id]
    );

    const jwt = signPortalToken(account.account_id, account.winery_id);

    res.cookie('portal_token', jwt, portalCookieOptions());

    res.json({ success: true, wineryId: account.winery_id });
  } catch (err) {
    console.error('Password login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/auth/set-password
 * Requires portal session. Body: { password: string, currentPassword?: string }
 *
 * Sets or changes the portal account password.
 * If a password is already set, currentPassword must be provided and valid.
 */
router.post('/set-password', requirePortalAuth, async (req, res) => {
  const { password, currentPassword } = req.body;

  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT password_hash FROM winery_accounts WHERE id = $1`,
      [req.portalAccount.accountId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // If a password is already set, require the current one
    if (rows[0].password_hash) {
      if (!currentPassword || typeof currentPassword !== 'string') {
        return res.status(400).json({ error: 'Current password is required to set a new one' });
      }
      const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `UPDATE winery_accounts SET password_hash = $1 WHERE id = $2`,
      [hash, req.portalAccount.accountId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Set-password error:', err);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

/**
 * POST /api/auth/change-email
 * Requires portal session. Body: { newEmail: string }
 *
 * Initiates an email change by sending a verification link to the new email.
 */
router.post('/change-email', requirePortalAuth, async (req, res) => {
  const { newEmail } = req.body;

  if (!newEmail || typeof newEmail !== 'string') {
    return res.status(400).json({ error: 'New email is required' });
  }

  const normalizedEmail = newEmail.trim().toLowerCase();

  try {
    // Get current account info
    const { rows: accountRows } = await pool.query(
      `SELECT wa.id, wa.contact_email, w.title AS winery_name
       FROM winery_accounts wa
       JOIN wineries w ON w.id = wa.winery_id
       WHERE wa.id = $1`,
      [req.portalAccount.accountId]
    );

    if (!accountRows[0]) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const account = accountRows[0];

    // Prevent changing to the same email
    if (normalizedEmail === account.contact_email.toLowerCase()) {
      return res.status(400).json({ error: 'New email is the same as current email' });
    }

    // Check if new email is already in use
    const { rows: existingRows } = await pool.query(
      `SELECT id FROM winery_accounts WHERE LOWER(contact_email) = $1`,
      [normalizedEmail]
    );

    if (existingRows.length > 0) {
      return res.status(409).json({ error: 'This email is already in use' });
    }

    // Invalidate any previous unused change-email tokens
    await pool.query(
      `UPDATE email_change_tokens SET used = TRUE WHERE account_id = $1 AND used = FALSE`,
      [req.portalAccount.accountId]
    );

    // Generate a new email change token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `INSERT INTO email_change_tokens (account_id, new_email, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [req.portalAccount.accountId, normalizedEmail, tokenHash, expiresAt]
    );

    // Send verification email to the new email address
    await sendEmailChangeConfirmation(normalizedEmail, rawToken, account.winery_name);

    res.json({ message: 'Verification email sent to the new address. Please check your email to confirm the change.' });
  } catch (err) {
    console.error('Change email error:', err);
    res.status(500).json({ error: 'Failed to process email change request' });
  }
});

/**
 * POST /api/auth/confirm-email-change?token=<hex>
 *
 * Confirms and applies the email change using the token from the verification email.
 */
router.post('/confirm-email-change', async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Token is required' });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const { rows } = await pool.query(
      `SELECT id, account_id, new_email, expires_at, used
       FROM email_change_tokens
       WHERE token_hash = $1`,
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired verification link' });
    }

    const changeToken = rows[0];

    if (changeToken.used) {
      return res.status(401).json({ error: 'This link has already been used' });
    }

    if (new Date(changeToken.expires_at) < new Date()) {
      return res.status(401).json({ error: 'This link has expired' });
    }

    // Mark token as used
    await pool.query(`UPDATE email_change_tokens SET used = TRUE WHERE id = $1`, [changeToken.id]);

    // Update the account email
    await pool.query(
      `UPDATE winery_accounts SET contact_email = $1 WHERE id = $2`,
      [changeToken.new_email, changeToken.account_id]
    );

    res.json({ success: true, message: 'Email successfully changed. You can now log in with your new email address.' });
  } catch (err) {
    console.error('Confirm email change error:', err);
    res.status(500).json({ error: 'Email change confirmation failed' });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (_req, res) => {
  res.clearCookie('portal_token', {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
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
