import express from 'express';
import { pool } from '../db/pool.js';

const router = express.Router();

/**
 * GET /api/search?q=<term>
 *
 * Unified search across wineries (all categories) and vineyard parcel names.
 * AVAs are resolved client-side from the static config and merged into results.
 *
 * Returns an array of result objects:
 *   { type: 'winery'|'vineyard', id, label, sublabel, category, lng, lat }
 *
 * Query params:
 *   ?q=<string>   — search term (required, min 1 char)
 *   ?limit=<n>    — max results per entity type (default 10, max 25)
 */
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    return res.json([]);
  }

  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, 25)
    : 10;

  const term = `%${q}%`;

  try {
    const [wineryRows, vineyardRows] = await Promise.all([
      // Wineries / tasting rooms / hotels / restaurants
      pool.query(
        `
        SELECT
          w.recid       AS id,
          w.title       AS label,
          w.category    AS category,
          ST_X(w.location::geometry) AS lng,
          ST_Y(w.location::geometry) AS lat
        FROM wineries w
        WHERE w.title ILIKE $1
        ORDER BY
          CASE WHEN LOWER(w.title) = LOWER($2) THEN 0
               WHEN LOWER(w.title) LIKE LOWER($3) THEN 1
               ELSE 2
          END,
          w.title
        LIMIT $4
        `,
        [term, q, `${q.toLowerCase()}%`, limit]
      ),

      // Vineyard parcel names (distinct — one result per unique name)
      pool.query(
        `
        SELECT DISTINCT ON (LOWER(vp.vineyard_name))
          vp.vineyard_name              AS label,
          vp.nested_ava                 AS sublabel,
          ST_X(ST_Centroid(vp.geometry)) AS lng,
          ST_Y(ST_Centroid(vp.geometry)) AS lat,
          vp.source_dataset             AS dataset
        FROM vineyard_parcels vp
        WHERE vp.vineyard_name IS NOT NULL
          AND vp.vineyard_name != ''
          AND vp.vineyard_name ILIKE $1
        ORDER BY LOWER(vp.vineyard_name), vp.vineyard_name
        LIMIT $2
        `,
        [term, limit]
      ),
    ]);

    const wineries = wineryRows.rows.map((r) => ({
      type:     'winery',
      id:       r.id,
      label:    r.label,
      sublabel: r.category === 'winery' ? 'Winery' : r.category,
      category: r.category,
      lng:      r.lng,
      lat:      r.lat,
    }));

    const vineyards = vineyardRows.rows.map((r) => ({
      type:     'vineyard',
      id:       null,
      label:    r.label,
      sublabel: r.sublabel || 'Vineyard',
      category: 'vineyard',
      lng:      r.lng,
      lat:      r.lat,
    }));

    res.json([...wineries, ...vineyards]);
  } catch (err) {
    console.error('GET /api/search error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
