/**
 * Winery vineyard site — builds the public payload for /w/:slug.
 *
 * Reads the live vineyards / vineyard_blocks rows the portal edits, so any
 * portal change (data edits apply immediately) shows up on the winery's page
 * with no publish/sync step. Only the fields listed here are ever exposed
 * publicly — keep this whitelist explicit rather than SELECT *.
 */
import { pool } from '../db/pool.js';

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

// Curated accent palette keys (hex values live client-side in siteTheme.js).
export const SITE_ACCENTS = ['burgundy', 'forest', 'ochre', 'slate', 'plum', 'terracotta'];

/**
 * @param {object} opts
 * @param {string} opts.slug
 * @param {number|null} opts.viewerWineryId  Signed-in portal owner, if any —
 *                                           lets the owner preview an unpublished site.
 * @returns {Promise<object|null>} null when not found / not visible to this viewer.
 */
export async function loadWinerySite({ slug, viewerWineryId = null }) {
  const { rows: wRows } = await pool.query(
    `SELECT id, title, description, url, image_url, site_slug, site_published, site_accent
     FROM wineries WHERE site_slug = $1`,
    [slug]
  );
  const w = wRows[0];
  if (!w) return null;
  const isOwner = viewerWineryId != null && Number(viewerWineryId) === w.id;
  if (!w.site_published && !isOwner) return null;

  const { rows: vineyards } = await pool.query(
    `SELECT v.id, v.site_key, v.vineyard_name, v.ava_name, v.nested_ava, v.acres,
            ST_AsGeoJSON(v.geometry, 6)::json AS geometry
     FROM vineyards v
     WHERE v.winery_id = $1 AND NOT v.site_hidden
     ORDER BY v.vineyard_name NULLS LAST, v.id`,
    [w.id]
  );

  const ids = vineyards.map((v) => v.id);
  const { rows: blocks } = ids.length === 0 ? { rows: [] } : await pool.query(
    `SELECT vb.id, vb.vineyard_id, vb.block_name, vb.variety, vb.clone, vb.rootstock,
            vb.trellis, vb.year_planted, vb.acres, vb.notes,
            ST_AsGeoJSON(vb.geometry, 6)::json AS geometry,
            bt.elevation_min_ft, bt.elevation_max_ft, bt.elevation_mean_ft,
            bt.slope_mean_deg, bt.aspect_bucket
     FROM vineyard_blocks vb
     LEFT JOIN vineyard_block_topo_stats bt ON bt.block_id = vb.id
     WHERE vb.vineyard_id = ANY($1)
     ORDER BY vb.id`,
    [ids]
  );

  const byVineyard = new Map(ids.map((id) => [id, []]));
  for (const b of blocks) byVineyard.get(b.vineyard_id).push(b);

  return {
    preview: !w.site_published,
    winery: {
      name: w.title,
      description: w.description,
      url: w.url,
      image_url: w.image_url,
      slug: w.site_slug,
      accent: w.site_accent,
    },
    vineyards: vineyards.map((v) => {
      const vb = byVineyard.get(v.id);
      return {
        key: v.site_key,
        name: v.vineyard_name,
        ava: v.nested_ava || v.ava_name,
        parent_ava: v.nested_ava && v.nested_ava !== v.ava_name ? v.ava_name : null,
        acres: v.acres != null ? Number(v.acres) : null,
        geometry: v.geometry,
        summary: summarize(vb),
        blocks: vb.map((b, i) => ({
          id: b.id,
          name: b.block_name || `Block ${i + 1}`,
          variety: b.variety,
          clone: b.clone,
          rootstock: b.rootstock,
          trellis: b.trellis,
          year_planted: b.year_planted,
          acres: b.acres != null ? Number(b.acres) : null,
          notes: b.notes,
          elevation_ft: b.elevation_mean_ft != null ? Math.round(b.elevation_mean_ft) : null,
          slope_deg: b.slope_mean_deg != null ? Number(Number(b.slope_mean_deg).toFixed(1)) : null,
          aspect: b.aspect_bucket,
          geometry: b.geometry,
        })),
      };
    }),
  };
}

// Vineyard-level stats derived from its blocks (acre-weighted where it matters).
function summarize(blocks) {
  let elevMin = null, elevMax = null, slopeW = 0, slopeSum = 0;
  const aspectAcres = {}, varietyAcres = {};
  let earliest = null;
  for (const b of blocks) {
    const a = Number(b.acres) || 0;
    if (b.elevation_min_ft != null) elevMin = elevMin == null ? b.elevation_min_ft : Math.min(elevMin, b.elevation_min_ft);
    if (b.elevation_max_ft != null) elevMax = elevMax == null ? b.elevation_max_ft : Math.max(elevMax, b.elevation_max_ft);
    if (b.slope_mean_deg != null && a > 0) { slopeSum += Number(b.slope_mean_deg) * a; slopeW += a; }
    if (b.aspect_bucket) aspectAcres[b.aspect_bucket] = (aspectAcres[b.aspect_bucket] || 0) + (a || 1);
    if (b.variety) varietyAcres[b.variety] = (varietyAcres[b.variety] || 0) + a;
    if (b.year_planted && (earliest == null || b.year_planted < earliest)) earliest = b.year_planted;
  }
  const top = (obj) => Object.entries(obj).sort((x, y) => y[1] - x[1]);
  return {
    elevation_min_ft: elevMin != null ? Math.round(elevMin) : null,
    elevation_max_ft: elevMax != null ? Math.round(elevMax) : null,
    slope_mean_deg: slopeW > 0 ? Number((slopeSum / slopeW).toFixed(1)) : null,
    aspect: top(aspectAcres)[0]?.[0] || null,
    varieties: top(varietyAcres).map(([name, acres]) => ({ name, acres: Number(acres.toFixed(2)) })),
    first_planted: earliest,
    block_count: blocks.length,
  };
}
