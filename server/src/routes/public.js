/**
 * Public read-only endpoints for displaying buyer/source relationships on the
 * map app. No API-key gate — these are the same kind of data already exposed
 * via the static GeoJSON tiles.
 */
import express from 'express';
import { pool } from '../db/pool.js';
import { readPortalAccount } from '../middleware/portalAuth.js';
import { loadWinerySite, SLUG_RE } from '../services/wineSite.js';

const router = express.Router();

/**
 * GET /api/public/wineries/:recid/sourced-from
 * Blocks (at other vineyards) that this winery buys fruit from, grouped flat
 * for the WineryDetailView "Sourced From" section.
 */
router.get('/wineries/:recid/sourced-from', async (req, res) => {
  const recid = parseInt(req.params.recid, 10);
  if (isNaN(recid)) return res.status(400).json({ error: 'Invalid recid' });
  try {
    const { rows } = await pool.query(
      `WITH self AS (SELECT id FROM wineries WHERE recid = $1)
       SELECT
         vb.id            AS block_id,
         vb.block_name,
         vb.variety,
         vb.clone,
         vb.acres         AS block_acres,
         vb.year_planted,
         v.id             AS vineyard_id,
         v.vineyard_name,
         w.id             AS source_winery_id,
         w.recid          AS source_winery_recid,
         COALESCE(w.title, 'Independent vineyard') AS source_winery_name
       FROM vineyard_block_buyers bb
       JOIN vineyard_blocks vb   ON vb.id = bb.block_id
       JOIN vineyards v          ON v.id = vb.vineyard_id
       LEFT JOIN wineries w      ON w.id  = v.winery_id
       WHERE bb.buyer_winery_id = (SELECT id FROM self)
       ORDER BY source_winery_name, v.vineyard_name, vb.block_name`,
      [recid]
    );
    res.json(rows);
  } catch (err) {
    console.error('public sourced-from error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/public/sites/:slug
 * A winery's public vineyard page payload. 404 unless published — except for
 * the signed-in owner, who gets an unpublished preview (preview: true).
 */
router.get('/sites/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!SLUG_RE.test(slug)) return res.status(404).json({ error: 'Not found' });
  try {
    const viewer = readPortalAccount(req);
    const site = await loadWinerySite({ slug, viewerWineryId: viewer?.wineryId ?? null });
    if (!site) return res.status(404).json({ error: 'Not found' });
    // Published pages are shared across viewers and change rarely; a short TTL
    // keeps portal edits visible within a minute. Previews must never be cached.
    res.set('Cache-Control', site.preview ? 'private, no-store' : 'public, max-age=60');
    res.json(site);
  } catch (err) {
    console.error('public site error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
