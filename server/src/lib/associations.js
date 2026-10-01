/**
 * Association (tenant) scoping for public endpoints — migration 025.
 *
 * Consumer apps (WVWA explorer, OWB statewide explorer, …) ask for their own
 * association's members with ?association=<slug>. Until every deployed client
 * sends the param, a missing value means 'wvwa', the only consumer before the
 * multi-app split.
 */
import { pool } from '../db/pool.js';

export const DEFAULT_ASSOCIATION = 'wvwa';

const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const CACHE_MS = 5 * 60 * 1000;
let cache = { slugs: null, at: 0 };

async function knownSlugs() {
  if (!cache.slugs || Date.now() - cache.at > CACHE_MS) {
    const { rows } = await pool.query('SELECT slug FROM associations');
    cache = { slugs: new Set(rows.map((r) => r.slug)), at: Date.now() };
  }
  return cache.slugs;
}

/**
 * Resolve ?association= to a known slug. Returns null for a malformed or
 * unknown slug so the route can 400 instead of silently returning no members.
 */
export async function resolveAssociation(req) {
  const raw = req.query.association;
  const slug = raw == null || raw === '' ? DEFAULT_ASSOCIATION : String(raw).toLowerCase();
  if (!SLUG_RE.test(slug)) return null;
  return (await knownSlugs()).has(slug) ? slug : null;
}

/**
 * SQL subquery of organization ids (wineries.id) belonging to the association
 * whose slug is bound at `param` (e.g. '$4'). Use as `w.id IN ${membersOf('$4')}`.
 */
export function membersOf(param) {
  return `(SELECT oa.organization_id
           FROM organization_associations oa
           JOIN associations a ON a.id = oa.association_id
           WHERE a.slug = ${param})`;
}

export function badAssociation(res) {
  return res.status(400).json({ error: 'Unknown association' });
}
