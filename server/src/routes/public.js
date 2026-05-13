/**
 * Public read-only endpoints for displaying buyer/source relationships on the
 * map app. No API-key gate — these are the same kind of data already exposed
 * via the static GeoJSON tiles.
 */
import express from 'express';
import { pool } from '../db/pool.js';

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
         vp.id            AS parcel_id,
         vp.vineyard_name,
         vp.parcel_label,
         w.id             AS source_winery_id,
         w.recid          AS source_winery_recid,
         COALESCE(w.title, 'Independent vineyard') AS source_winery_name
       FROM vineyard_block_buyers bb
       JOIN vineyard_blocks vb   ON vb.id = bb.block_id
       JOIN vineyard_parcels vp  ON vp.id = vb.vineyard_parcel_id
       LEFT JOIN wineries w      ON w.id  = vp.winery_id
       WHERE bb.buyer_winery_id = (SELECT id FROM self)
       ORDER BY source_winery_name, vp.parcel_label, vb.block_name`,
      [recid]
    );
    res.json(rows);
  } catch (err) {
    console.error('public sourced-from error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
