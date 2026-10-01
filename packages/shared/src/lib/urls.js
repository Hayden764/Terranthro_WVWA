/**
 * Cross-app URLs. Each frontend is its own deployment, so links between them
 * are absolute. Override per deployment with VITE_PORTAL_URL.
 */
export const PORTAL_URL = (
  import.meta.env.VITE_PORTAL_URL
  || (import.meta.env.DEV ? 'http://localhost:3003' : 'https://portal.terranthro.com')
).replace(/\/$/, '');
