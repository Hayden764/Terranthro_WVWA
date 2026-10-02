/**
 * export-owb-avas.mjs
 * ===================
 * Exports every Oregon AVA from the database (avas / ava_hierarchy, migration
 * 026) into the OWB explorer as static assets, so the map loads small, cached
 * files instead of full-resolution TTB polygons from the API. The explorer
 * covers Oregon only, so AVAs that cross a state line (Columbia Valley, Walla
 * Walla Valley, Columbia Gorge, Snake River Valley) are exported as their
 * Oregon portion (ava_states.geometry, migration 028):
 *
 *   apps/owb/public/data/avas/<slug>.geojson    simplified Oregon portion (~40 m tolerance)
 *   apps/owb/public/data/oregon_boundary.geojson  Oregon's shoreline-clipped outline
 *       (states.outline) — the statewide frame the map darkens around (WVWA uses
 *       the Willamette Valley boundary for this).
 *   apps/owb/src/config/oregonAvas.generated.js  the AVA list the explorer reads:
 *       slug, name, file, parentAva / subAvas (direct links), region (top-level
 *       ancestor), established, acres (Oregon portion), states, bounds; plus
 *       totalAcres (whole AVA) for the AVAs that cross a state line.
 *
 * Re-run after load-avas.mjs / load-state-boundaries.py, then commit the output.
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
// The state outline only drives a dimming mask and a frame line.
const MASK_TOLERANCE = 0.002;
const ACRE_M2 = 4046.8564224;

const round = (n, d) => Number(Number(n).toFixed(d));

async function main() {
  const { rows } = await pool.query(
    `SELECT a.slug, a.name, a.created, a.cfr_section,
            ST_AsGeoJSON(ST_SimplifyPreserveTopology(o.geometry,
              CASE WHEN o.acres > $4::float8 THEN $3::float8 ELSE $1::float8 END), 5)::json AS geometry,
            ST_XMin(o.geometry) AS w, ST_YMin(o.geometry) AS s,
            ST_XMax(o.geometry) AS e, ST_YMax(o.geometry) AS n,
            o.acres::float AS acres,
            ST_Area(a.geometry::geography) / $2 AS total_acres,
            (SELECT p.slug FROM ava_hierarchy h JOIN avas p ON p.id = h.parent_id
              WHERE h.child_id = a.id ORDER BY p.slug LIMIT 1) AS parent,
            (SELECT array_agg(c.slug ORDER BY c.name) FROM ava_hierarchy h JOIN avas c ON c.id = h.child_id
              WHERE h.parent_id = a.id) AS children,
            (SELECT array_agg(st.abbreviation ORDER BY st.abbreviation) FROM ava_states av
              JOIN states st ON st.id = av.state_id WHERE av.ava_id = a.id) AS states
     FROM avas a
     JOIN ava_states o ON o.ava_id = a.id
     JOIN states ost ON ost.id = o.state_id AND ost.abbreviation = 'OR'
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
    if ((r.states || []).length > 1) entry.totalAcres = Math.round(r.total_acres);
    if (r.parent && bySlug.has(r.parent)) entry.parentAva = r.parent;
    if (r.children?.length) entry.subAvas = r.children.filter((c) => bySlug.has(c));
    return entry;
  });

  // Oregon's outline for the outside-mask and frame line.
  const { rows: [state] } = await pool.query(
    `SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(outline, $1::float8), 5)::json AS geometry,
            ST_XMin(outline) AS w, ST_YMin(outline) AS s, ST_XMax(outline) AS e, ST_YMax(outline) AS n
     FROM states WHERE abbreviation = 'OR' AND outline IS NOT NULL`,
    [MASK_TOLERANCE]
  );
  if (!state) throw new Error('states.outline is empty for OR — run data-pipeline/scripts/load-state-boundaries.py');
  const boundaryJson = JSON.stringify({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { name: 'Oregon' }, geometry: state.geometry }],
  });
  fs.writeFileSync(path.join(OWB, 'public/data/oregon_boundary.geojson'), boundaryJson);
  fs.rmSync(path.join(OWB, 'public/data/oregon_wine_regions.geojson'), { force: true });
  bytes += boundaryJson.length;

  // Statewide view = the whole state.
  const bounds = [state.w, state.s, state.e, state.n].map((v) => round(v, 4));

  const src = `// Generated by server/scripts/export-owb-avas.mjs from the avas tables — do not edit by hand.
// Re-run that script after the AVA boundaries are reloaded.

/**
 * Every AVA touching Oregon, as its Oregon portion: \`acres\`, \`bounds\` and the
 * boundary file cover Oregon only; \`totalAcres\` (multi-state AVAs) is the whole
 * AVA. parentAva / subAvas are DIRECT links only.
 */
export const OREGON_AVAS = ${JSON.stringify(avas, null, 2)};

/** Frame for the statewide view (Oregon): [west, south, east, north]. */
export const OREGON_BOUNDS = ${JSON.stringify(bounds)};
`;
  fs.writeFileSync(CONFIG, src);
  console.log(`Exported ${avas.length} AVAs (${Math.round(bytes / 1024)} KB of boundaries) → ${path.relative(process.cwd(), OWB)}`);
  console.log(`Regions: ${[...new Set(avas.map((a) => a.region))].join(', ')}`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
