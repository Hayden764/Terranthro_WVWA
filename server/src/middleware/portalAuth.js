/**
 * Portal auth middleware — verifies JWT from httpOnly cookie.
 * Attaches req.portalAccount = { accountId, wineryId } on success.
 */
import jwt from 'jsonwebtoken';

const JWT_SECRET = () => {
  const secret = process.env.PORTAL_JWT_SECRET;
  if (!secret) throw new Error('PORTAL_JWT_SECRET env var is required');
  return secret;
};

/**
 * Sign a portal session JWT.
 */
export function signPortalToken(accountId, wineryId) {
  return jwt.sign(
    { sub: accountId, winery_id: wineryId, scope: 'portal' },
    JWT_SECRET(),
    { expiresIn: '7d' }
  );
}

/**
 * Middleware: require a valid portal JWT cookie.
 */
export function requirePortalAuth(req, res, next) {
  const token = req.cookies?.portal_token;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET());
    if (payload.scope !== 'portal') {
      return res.status(403).json({ error: 'Invalid token scope' });
    }
    req.portalAccount = {
      accountId: payload.sub,
      wineryId: payload.winery_id,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
