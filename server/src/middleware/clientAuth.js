/**
 * Client auth middleware — the shared login a client (OWB) uses for its portal.
 * Verifies the JWT in the httpOnly `client_token` cookie and attaches
 * req.clientAccount = { clientId } on success.
 *
 * Signed with PORTAL_JWT_SECRET; the 'client' scope keeps these tokens from
 * being accepted as winery portal sessions and vice versa.
 */
import jwt from 'jsonwebtoken';

const JWT_SECRET = () => {
  const secret = process.env.PORTAL_JWT_SECRET;
  if (!secret) throw new Error('PORTAL_JWT_SECRET env var is required');
  return secret;
};

export const CLIENT_COOKIE = 'client_token';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function signClientToken(clientId) {
  return jwt.sign({ sub: clientId, scope: 'client' }, JWT_SECRET(), { expiresIn: '7d' });
}

export function clientCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // portal.terranthro.com and api.terranthro.com are same-site, so Lax works.
    sameSite: 'lax',
    maxAge: MAX_AGE_MS,
    path: '/',
  };
}

export function requireClientAuth(req, res, next) {
  const token = req.cookies?.[CLIENT_COOKIE];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET());
    if (payload.scope !== 'client') {
      return res.status(403).json({ error: 'Invalid token scope' });
    }
    req.clientAccount = { clientId: payload.sub };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
