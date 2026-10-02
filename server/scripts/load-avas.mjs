/**
 * load-avas.mjs
 * =============
 * Loads (or refreshes) every Oregon AVA into the avas / states / counties /
 * ava_states / ava_counties / ava_hierarchy tables (migration 026).
 *
 * Sources:
 *   data-pipeline/data/ava/oregon_avas.geojson   TTB AVA Map Explorer polygons for
 *       every established AVA touching Oregon (written by
 *       data-pipeline/scripts/fetch-ttb-avas.py — run that first to refresh).
 *   apps/wvwa/public/data/<slug>.geojson   the Willamette Valley files, which also carry the
 *       UC Davis AVA-project metadata (petitioner, CFR history, boundary text,
 *       accurate county list). Used where present; TTB fields fill the rest.
 *
 * Willamette Valley slugs keep the file names the frontend already uses
 * (mount_pisgah_polk_county → 'mount-pisgah-polk-county'); other AVAs get a
 * slug from their name. Slugs are upsert keys — never change one once issued.
 *
 * Hierarchy: TTB's `within` lists every ancestor; only DIRECT parents are stored
 * (a parent that is itself an ancestor of another listed parent is dropped).
 *
 * Re-runnable: upserts AVAs by slug and rebuilds that AVA's state/county/parent
 * links inside one transaction.
 *
 * Requires DATABASE_URL (loaded from server/.env via db/pool.js).
 *
 * Usage:
 *   node scripts/load-avas.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool } from '../src/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const STATEWIDE = path.join(REPO, 'data-pipeline/data/ava/oregon_avas.geojson');
const WV_DIR = path.join(REPO, 'apps/wvwa/public/data');
const DRY_RUN = process.argv.includes('--dry-run');

const STATE_NAMES = { OR: 'Oregon', WA: 'Washington', ID: 'Idaho' };

// public/data file stem → TTB name (mirrors WV_FILES in fetch-ttb-avas.py).
const WV_FILES = {
  willamette_valley: 'Willamette Valley',
  chehalem_mountains: 'Chehalem Mountains',
  dundee_hills: 'Dundee Hills',
  eola_amity_hills: 'Eola-Amity Hills',
  laurelwood_district: 'Laurelwood District',
  lower_long_tom: 'Lower Long Tom',
  mcminnville: 'McMinnville',
  mount_pisgah_polk_county: 'Mt. Pisgah Polk County Oregon',
  ribbon_ridge: 'Ribbon Ridge',
  tualatin_hills: 'Tualatin Hills',
  van_duzer_corridor: 'Van Duzer Corridor',
  yamhill_carlton: 'Yamhill-Carlton',
};

// Known typos in TTB's county field.
const COUNTY_FIXES = { Gilliman: 'Gilliam' };

// Name matching across sources ignores punctuation/case:
// "Red Hill Douglas County, Oregon" == "Red Hill Douglas County Oregon".
const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const blank = (v) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));
const val = (v) => (blank(v) ? null : v);

/**
 * TTB county strings are either "A, B" (single state) or
 * "OR:  A, B;  WA: C" (multi-state). Returns [{ state, name }].
 */
function parseCounties(str, states) {
  if (blank(str)) return [];
  const out = [];
  const add = (state, name) => {
    const n = name.trim();
    if (n) out.push({ state, name: COUNTY_FIXES[n] || n });
  };
  if (/[A-Z]{2}\s*:/.test(str)) {
    for (const part of str.split(';')) {
      const m = part.match(/^\s*([A-Z]{2})\s*:(.*)$/);
      if (m) m[2].split(',').forEach((n) => add(m[1], n));
    }
  } else {
    if (states.length !== 1) throw new Error(`Ambiguous counties "${str}" for states ${states}`);
    str.split(',').forEach((n) => add(states[0], n));
  }
  return out;
}

function readWvMetadata() {
  const byTtbKey = new Map();
  for (const [stem, ttbName] of Object.entries(WV_FILES)) {
    const file = path.join(WV_DIR, `${stem}.geojson`);
    const props = JSON.parse(fs.readFileSync(file, 'utf8')).features?.[0]?.properties || {};
    byTtbKey.set(key(ttbName), { slug: stem.replace(/_/g, '-'), props });
  }
  return byTtbKey;
}

export function buildRecords() {
  // Files written before fetch-ttb-avas.py nulled pandas NaN contain bare NaN
  // tokens (invalid JSON); map them to null.
  const ttb = JSON.parse(fs.readFileSync(STATEWIDE, 'utf8').replace(/:NaN([,}])/g, ':null$1')).features;
  const wv = readWvMetadata();
  const records = ttb.map((f) => {
    const p = f.properties;
    const meta = wv.get(key(p.name));
    const u = meta?.props || {};
    const states = String(p.states).split(',').map((s) => s.trim()).filter(Boolean);
    // UC Davis 'county' (pipe-delimited, single-state WV AVAs) is more accurate
    // than TTB's field where both exist (e.g. Lower Long Tom).
    const counties = !blank(u.county)
      ? u.county.split('|').map((n) => ({ state: states[0], name: n.trim() })).filter((c) => c.name)
      : parseCounties(p.counties, states);
    const slug = meta?.slug || slugify(p.name);
    return {
      slug,
      ava_id: val(u.ava_id) || slug.replace(/-/g, '_'),
      name: val(u.name) || p.name,
      ttbName: p.name,
      aka: val(u.aka),
      created: val(u.created) || val(p.established),
      petitioner: val(u.petitioner),
      cfr_author: val(u.cfr_author),
      cfr_index: val(u.cfr_index) || (p.cfr_section ? String(p.cfr_section).replace(/^27 CFR\s*/, '') : null),
      cfr_revision_history: val(u.cfr_revision_history),
      approved_maps: val(u.approved_maps),
      boundary_description: val(u.boundary_description),
      used_maps: val(u.used_maps),
      status: String(p.status || 'Established').toLowerCase() === 'established' ? 'established' : 'pending',
      cfr_section: val(p.cfr_section),
      boundary_source: val(p.boundary_source),
      boundary_retrieved: val(p.boundary_retrieved),
      states,
      counties,
      within: blank(p.within) ? [] : String(p.within).split(',').map((s) => s.trim()).filter(Boolean),
      geometry: f.geometry,
    };
  });

  // Direct parents only: drop any listed ancestor that is also an ancestor of
  // another listed ancestor. Parents outside the loaded set are ignored.
  const byKey = new Map(records.map((r) => [key(r.ttbName), r]));
  for (const r of records) {
    const anc = r.within.map((n) => byKey.get(key(n))).filter(Boolean);
    r.parents = anc.filter((a) => !anc.some((b) => b !== a && b.within.some((n) => key(n) === key(a.ttbName))));
  }
  return records;
}

async function main() {
  const records = buildRecords();
  for (const r of records) {
    console.log(`${r.slug.padEnd(40)} ${r.states.join('/').padEnd(6)} parents: ${r.parents.map((p) => p.slug).join(', ') || '—'}`
      + `  counties: ${r.counties.map((c) => `${c.name} (${c.state})`).join(', ')}`);
  }
  if (DRY_RUN) {
    console.log(`\n--dry-run: ${records.length} AVAs parsed, nothing written.`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await loadAvas(client, records);
    await client.query('COMMIT');
    await client.query('ANALYZE avas');
    console.log(`\nLoaded ${records.length} AVAs.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Upsert AVAs and rebuild their links. Runs on the caller's open transaction. */
export async function loadAvas(client, records) {
  const stateIds = {};
  for (const abbr of new Set(records.flatMap((r) => r.states))) {
    const { rows } = await client.query(
      `INSERT INTO states (name, abbreviation) VALUES ($1, $2)
       ON CONFLICT (abbreviation) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [STATE_NAMES[abbr] || abbr, abbr]
    );
    stateIds[abbr] = rows[0].id;
  }

  const avaIds = {};
  for (const r of records) {
    const { rows } = await client.query(
      `INSERT INTO avas (slug, ava_id, name, aka, created, petitioner, cfr_author, cfr_index,
                         cfr_revision_history, approved_maps, boundary_description, used_maps,
                         status, cfr_section, boundary_source, boundary_retrieved,
                         geometry, centroid, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($17), 4326)),
               ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON($17), 4326)),
               NOW())
       ON CONFLICT (slug) DO UPDATE SET
         ava_id = EXCLUDED.ava_id, name = EXCLUDED.name, aka = EXCLUDED.aka,
         created = EXCLUDED.created, petitioner = EXCLUDED.petitioner,
         cfr_author = EXCLUDED.cfr_author, cfr_index = EXCLUDED.cfr_index,
         cfr_revision_history = EXCLUDED.cfr_revision_history,
         approved_maps = EXCLUDED.approved_maps,
         boundary_description = EXCLUDED.boundary_description,
         used_maps = EXCLUDED.used_maps, status = EXCLUDED.status,
         cfr_section = EXCLUDED.cfr_section, boundary_source = EXCLUDED.boundary_source,
         boundary_retrieved = EXCLUDED.boundary_retrieved,
         geometry = EXCLUDED.geometry, centroid = EXCLUDED.centroid, updated_at = NOW()
       RETURNING id`,
      [r.slug, r.ava_id, r.name, r.aka, r.created, r.petitioner, r.cfr_author, r.cfr_index,
       r.cfr_revision_history, r.approved_maps, r.boundary_description, r.used_maps,
       r.status, r.cfr_section, r.boundary_source, r.boundary_retrieved,
       JSON.stringify(r.geometry)]
    );
    avaIds[r.slug] = rows[0].id;
  }

  const ids = Object.values(avaIds);
  await client.query('DELETE FROM ava_states WHERE ava_id = ANY($1)', [ids]);
  await client.query('DELETE FROM ava_counties WHERE ava_id = ANY($1)', [ids]);
  await client.query('DELETE FROM ava_hierarchy WHERE child_id = ANY($1)', [ids]);

  for (const r of records) {
    const id = avaIds[r.slug];
    for (const s of r.states) {
      await client.query('INSERT INTO ava_states (ava_id, state_id) VALUES ($1, $2)', [id, stateIds[s]]);
    }
    for (const c of r.counties) {
      const stateId = stateIds[c.state];
      if (!stateId) throw new Error(`${r.slug}: county ${c.name} in unknown state ${c.state}`);
      const { rows } = await client.query(
        `INSERT INTO counties (name, state_id) VALUES ($1, $2)
         ON CONFLICT (name, state_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [c.name, stateId]
      );
      await client.query(
        'INSERT INTO ava_counties (ava_id, county_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, rows[0].id]
      );
    }
    for (const p of r.parents) {
      await client.query('INSERT INTO ava_hierarchy (parent_id, child_id) VALUES ($1, $2)', [avaIds[p.slug], id]);
    }
  }

  // Per-state portions (migration 028) — recompute from the new boundaries.
  const { rows: [fn] } = await client.query(
    `SELECT to_regprocedure('refresh_ava_state_portions()') IS NOT NULL AS exists`
  );
  if (fn.exists) await client.query('SELECT refresh_ava_state_portions()');

  // Subdivided lookup boundaries for OWB releases (migration 032).
  const { rows: [lookup] } = await client.query(
    `SELECT to_regprocedure('refresh_lookup_geometry()') IS NOT NULL AS exists`
  );
  if (lookup.exists) await client.query('SELECT refresh_lookup_geometry()');
  return avaIds;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());
}
