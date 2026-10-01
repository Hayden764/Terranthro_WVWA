/**
 * export-owb-avas.mjs
 * ===================
 * Exports every Oregon AVA from the database (avas / ava_hierarchy, migration
 * 026) into the OWB explorer as static assets, so the map loads small, cached
 * files instead of full-resolution TTB polygons from the API:
 *
 *   apps/owb/public/data/avas/<slug>.geojson    simplified boundary (~40 m tolerance)
 *   apps/owb/public/data/oregon_wine_regions.geojson  the top-level AVAs merged into
 *       one outline — the statewide frame the map darkens around (WVWA uses the
 *       Willamette Valley boundary for this).
 *   apps/owb/src/config/oregonAvas.generated.js  the AVA list the explorer reads:
 *       slug, name, file, parentAva / subAvas (direct links), region (top-level
 *       ancestor), established, acres (from the polygon), states, bounds.
 *
 * Re-run after load-avas.mjs whenever TTB boundaries change, then commit the output.
 *
 * Requires DATABASE_URL (loaded from server/.env via db/pool.js).
 *
 * Usage:
 *   node scripts/export-owb-avas.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OWB = path.resolve(__dirname, '../../apps/owb');
const GEO_DIR = path.join(OWB, 'public/data/avas');
const CONFIG = path.join(OWB, 'src/config/oregonAvas.generated.js');

// Degrees; ~40–55 m at Oregon latitudes — invisible at AVA zoom levels.
// AVAs over a million acres (Columbia Valley, Snake River, Southern Oregon)
// are only ever seen zoomed out, so they get a coarser ~200 m tolerance.
const SIMPLIFY_TOLERANCE = 0.0005;
const LARGE_AVA_TOLERANCE = 0.002;
const LARGE_AVA_ACRES = 1_000_000;
// The merged statewide outline only drives a dimming mask and a thin frame line.
const MASK_TOLERANCE = 0.005;
const ACRE_M2 = 4046.8564224;

const round = (n, d) => Number(Number(n).toFixed(d));

async function main() {
  const { rows } = await pool.query(
    `SELECT a.slug, a.name, a.created, a.cfr_section,
            ST_AsGeoJSON(ST_SimplifyPreserveTopology(a.geometry,
              CASE WHEN ST_Area(a.geometry::geography) / $2::float8 > $4::float8 THEN $3::float8 ELSE $1::float8 END), 5)::json AS geometry,
            ST_XMin(a.geometry) AS w, ST_YMin(a.geometry) AS s,
            ST_XMax(a.geometry) AS e, ST_YMax(a.geometry) AS n,
            ST_Area(a.geometry::geography) / $2 AS acres,
            (SELECT p.slug FROM ava_hierarchy h JOIN avas p ON p.id = h.parent_id
              WHERE h.child_id = a.id ORDER BY p.slug LIMIT 1) AS parent,
            (SELECT array_agg(c.slug ORDER BY c.name) FROM ava_hierarchy h JOIN avas c ON c.id = h.child_id
              WHERE h.parent_id = a.id) AS children,
            (SELECT array_agg(st.abbreviation ORDER BY st.abbreviation) FROM ava_states av
              JOIN states st ON st.id = av.state_id WHERE av.ava_id = a.id) AS states
     FROM avas a
     WHERE a.id IN (SELECT av.ava_id FROM ava_states av JOIN states st ON st.id = av.state_id
                    WHERE st.abbreviation = 'OR')
     ORDER BY a.name`,
    [SIMPLIFY_TOLERANCE, ACRE_M2, LARGE_AVA_TOLERANCE, LARGE_AVA_ACRES]
  );

  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const rootOf = (r) => { let cur = r; while (cur.parent && bySlug.has(cur.parent)) cur = bySlug.get(cur.parent); return cur.slug; };

  fs.rmSync(GEO_DIR, { recursive: true, force: true });
  fs.mkdirSync(GEO_DIR, { recursive: true });
  let bytes = 0;
  const avas = rows.map((r) => {
    const file = `/data/avas/${r.slug}.geojson`;
    const fc = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { slug: r.slug, name: r.name }, geometry: r.geometry }],
    };
    const json = JSON.stringify(fc);
    bytes += json.length;
    fs.writeFileSync(path.join(GEO_DIR, `${r.slug}.geojson`), json);
    const entry = {
      slug: r.slug,
      name: r.name,
      file,
      region: rootOf(r),
      established: r.created ? new Date(r.created).getUTCFullYear() : null,
      acres: Math.round(r.acres),
      states: r.states || [],
      bounds: [round(r.w, 4), round(r.s, 4), round(r.e, 4), round(r.n, 4)],
    };
    if (r.parent && bySlug.has(r.parent)) entry.parentAva = r.parent;
    if (r.children?.length) entry.subAvas = r.children.filter((c) => bySlug.has(c));
    return entry;
  });

  // Merged outline of the top-level AVAs (no parent) for the outside-mask.
  const { rows: [union] } = await pool.query(
    `SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Union(a.geometry), $2::float8), 5)::json AS geometry
     FROM avas a WHERE a.slug = ANY($1)`,
    [avas.filter((a) => !a.parentAva).map((a) => a.slug), MASK_TOLERANCE]
  );
  const regionsJson = JSON.stringify({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { name: 'Oregon wine regions' }, geometry: union.geometry }],
  });
  fs.writeFileSync(path.join(OWB, 'public/data/oregon_wine_regions.geojson'), regionsJson);
  bytes += regionsJson.length;

  // Statewide view = the Oregon parts of every AVA. Multi-state AVAs (Columbia
  // Valley, Snake River) would drag the frame into WA/ID, so frame on
  // Oregon-only AVAs and clamp to Oregon's extent.
  const OREGON = [-124.7, 41.9, -116.4, 46.3];
  const inOr = avas.filter((a) => a.states.length === 1 && a.states[0] === 'OR');
  const bounds = [
    Math.max(OREGON[0], Math.min(...inOr.map((a) => a.bounds[0]))),
    Math.max(OREGON[1], Math.min(...inOr.map((a) => a.bounds[1]))),
    Math.min(OREGON[2], Math.max(...inOr.map((a) => a.bounds[2]))),
    Math.min(OREGON[3], Math.max(...inOr.map((a) => a.bounds[3]))),
  ].map((v) => round(v, 4));

  const src = `// Generated by server/scripts/export-owb-avas.mjs from the avas tables — do not edit by hand.
// Re-run that script after the AVA boundaries are reloaded.

/** Every AVA touching Oregon. parentAva / subAvas are DIRECT links only. */
export const OREGON_AVAS = ${JSON.stringify(avas, null, 2)};

/** Frame for the statewide view: [west, south, east, north]. */
export const OREGON_BOUNDS = ${JSON.stringify(bounds)};
`;
  fs.writeFileSync(CONFIG, src);
  console.log(`Exported ${avas.length} AVAs (${Math.round(bytes / 1024)} KB of boundaries) → ${path.relative(process.cwd(), OWB)}`);
  console.log(`Regions: ${[...new Set(avas.map((a) => a.region))].join(', ')}`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
