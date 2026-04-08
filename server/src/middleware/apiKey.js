/**
 * requireApiKey middleware
 *
 * Lightweight shared-secret auth for vineyard/winery API endpoints.
 * Set INTERNAL_API_KEY in server/.env to enable protection.
 * If the env var is not set, the middleware passes through (dev convenience).
 *
 * Clients send the key via:
 *   Header: x-api-key: <key>
 *   Query:  ?api_key=<key>
 */
export function requireApiKey(req, res, next) {
  const expectedKey = process.env.INTERNAL_API_KEY;

  // If no key is configured, allow all requests (dev mode)
  if (!expectedKey) {
    return next();
  }

  const provided = req.headers['x-api-key'] || req.query.api_key;
  if (!provided || provided !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
