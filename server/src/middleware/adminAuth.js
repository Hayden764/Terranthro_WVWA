/**
 * Admin auth middleware — verifies JWT from httpOnly cookie.
 * Attaches req.adminAccount = { adminId, email, role } on success.
 */
import jwt from 'jsonwebtoken';

const JWT_SECRET = () => {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) throw new Error('ADMIN_JWT_SECRET env var is required');
  return secret;
};

/**
 * Sign an admin session JWT.
 */
export function signAdminToken(adminId, email, role) {
  return jwt.sign(
    { sub: adminId, email, role, scope: 'admin' },
    JWT_SECRET(),
    { expiresIn: '24h' }
  );
}

/**
 * Middleware: require a valid admin JWT cookie.
 */
export function requireAdminAuth(req, res, next) {
  const token = req.cookies?.admin_token;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET());
    if (payload.scope !== 'admin') {
      return res.status(403).json({ error: 'Invalid token scope' });
    }
    req.adminAccount = {
      adminId: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Middleware: require superadmin role.
 */
export function requireSuperadmin(req, res, next) {
  if (req.adminAccount?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin required' });
  }
  next();
}
