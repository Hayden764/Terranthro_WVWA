#!/usr/bin/env node
/**
 * seed-avas.js
 *
 * Seeds the Terranthro PostgreSQL database from static GeoJSON source files.
 *
 * What it does:
 *   1. Seeds all US states from client/src/data/states.json
 *   2. Reads every *.geojson in client/src/data/avas/ (skips macOS ._* files)
 *   3. Inserts AVA metadata + geometry into the `avas` table
 *   4. Populates ava_states, counties, ava_counties junction tables
 *   5. Second pass: resolves pipe-delimited `within` → ava_hierarchy rows
 *
 * Run:
 *   DATABASE_URL=postgresql://... node data-pipeline/scripts/seed-avas.js
 *
 * The script is idempotent — re-running it will skip already-inserted rows.
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://terranthro_user:terranthro_pass@localhost:5432/terranthro';

const REPO_ROOT = path.resolve(__dirname, '../../');
const STATES_JSON = path.join(REPO_ROOT, 'client/src/data/states.json');
const AVAS_DIR = path.join(REPO_ROOT, 'client/src/data/avas');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Split a pipe-delimited string into a trimmed, non-empty array. */
function parsePipe(value) {
  if (!value) return [];
  return value
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Ensure geometry is MultiPolygon.
 * PostGIS column is typed GEOMETRY(MultiPolygon, 4326) so Polygons must be
 * wrapped in an extra array level.
 */
function toMultiPolygon(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'MultiPolygon') return geometry;
  if (geometry.type === 'Polygon') {
    return { type: 'MultiPolygon', coordinates: [geometry.coordinates] };
  }
  throw new Error(`Unsupported geometry type: ${geometry.type}`);
}

/** Derive slug from filename (strip .geojson). */
function slugFromFile(filename) {
  return path.basename(filename, '.geojson');
}

/** Null-safe date parser — returns null for empty/invalid strings. */
function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : val;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { Pool } = pg;
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();

  try {
    // ── 1. Seed states ──────────────────────────────────────────────────────
    console.log('Seeding states…');
    const statesData = JSON.parse(fs.readFileSync(STATES_JSON, 'utf8'));
    const allStates = statesData.states ?? statesData; // handle both shapes

    // Build a lookup: abbreviation → db id (populated after insert)
    const stateIdByAbbrev = {};

    for (const state of allStates) {
      const { rows } = await client.query(
        `INSERT INTO states (name, abbreviation)
         VALUES ($1, $2)
         ON CONFLICT (abbreviation) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [state.name, state.abbreviation]
      );
      stateIdByAbbrev[state.abbreviation] = rows[0].id;
    }
    console.log(`  → ${Object.keys(stateIdByAbbrev).length} states ready`);

    // ── 2. Read all AVA GeoJSON files ───────────────────────────────────────
    const allFiles = fs.readdirSync(AVAS_DIR).filter(
      (f) => f.endsWith('.geojson') && !f.startsWith('._')
    );
    console.log(`\nFound ${allFiles.length} AVA files to process`);

    // We'll collect (slug → {id, name, withinRaw}) for the hierarchy pass
    const avaMetaBySlug = {};
    // And name → id for resolving `within` by name
    const avaIdByName = {};

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    await client.query('BEGIN');

    for (const filename of allFiles) {
      const slug = slugFromFile(filename);
      const filePath = path.join(AVAS_DIR, filename);

      let geojson;
      try {
        geojson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        console.error(`  ✗ Parse error ${filename}: ${e.message}`);
        errors++;
        continue;
      }

      // Each file is a FeatureCollection with exactly one feature
      const feature = geojson.features?.[0];
      if (!feature) {
        console.warn(`  ⚠ No features in ${filename}`);
        skipped++;
        continue;
      }

      const p = feature.properties ?? {};
      const geom = feature.geometry;

      if (!geom) {
        console.warn(`  ⚠ No geometry in ${filename}`);
        skipped++;
        continue;
      }

      let multiPolygonGeom;
      try {
        multiPolygonGeom = toMultiPolygon(geom);
      } catch (e) {
        console.warn(`  ⚠ ${filename}: ${e.message}`);
        skipped++;
        continue;
      }

      // ── Insert AVA ────────────────────────────────────────────────────────
      let avaId;
      try {
        const { rows } = await client.query(
          `INSERT INTO avas (
             slug, ava_id, name, aka, created, removed,
             petitioner, cfr_author, cfr_index, cfr_revision_history,
             approved_maps, boundary_description, used_maps,
             valid_start, valid_end, lcsh, sameas,
             geometry, centroid
           ) VALUES (
             $1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10,
             $11, $12, $13,
             $14, $15, $16, $17,
             ST_GeomFromGeoJSON($18),
             ST_Centroid(ST_GeomFromGeoJSON($18))
           )
           ON CONFLICT (slug) DO NOTHING
           RETURNING id`,
          [
            slug,
            p.ava_id ?? null,
            p.name ?? slug,
            p.aka ?? null,
            parseDate(p.created),
            parseDate(p.removed),
            p.petitioner ?? null,
            p.cfr_author ?? null,
            p.cfr_index ?? null,
            p.cfr_revision_history ?? null,
            p.approved_maps ?? null,
            p.boundary_description ?? null,
            p.used_maps ?? null,
            parseDate(p.valid_start),
            parseDate(p.valid_end),
            p.lcsh ?? null,
            p.sameas ?? null,
            JSON.stringify(multiPolygonGeom),
          ]
        );

        if (rows.length === 0) {
          // ON CONFLICT: already exists — fetch the existing id
          const existing = await client.query(
            'SELECT id, name FROM avas WHERE slug = $1',
            [slug]
          );
          avaId = existing.rows[0].id;
          skipped++;
        } else {
          avaId = rows[0].id;
          inserted++;
        }
      } catch (e) {
        console.error(`  ✗ Insert failed for ${slug}: ${e.message}`);
        errors++;
        continue;
      }

      // Store for hierarchy pass
      avaMetaBySlug[slug] = {
        id: avaId,
        name: p.name ?? slug,
        withinRaw: p.within ?? null,
      };
      // Map name → id (last write wins for name collisions, which are rare)
      if (p.name) avaIdByName[p.name] = avaId;

      // ── ava_states ────────────────────────────────────────────────────────
      const stateCodes = parsePipe(p.state);
      for (const code of stateCodes) {
        // Skip malformed state codes (abbreviations must be exactly 2 letters)
        if (!code || !/^[A-Za-z]{2}$/.test(code)) {
          console.warn(`  ⚠ Skipping invalid state code "${code}" in ${slug}`);
          continue;
        }
        const upperCode = code.toUpperCase();
        const stId = stateIdByAbbrev[upperCode];
        if (!stId) {
          // State not in states.json — insert a minimal record on the fly
          const { rows } = await client.query(
            `INSERT INTO states (name, abbreviation) VALUES ($1, $2)
             ON CONFLICT (abbreviation) DO NOTHING
             RETURNING id`,
            [upperCode, upperCode]
          );
          if (rows.length > 0) {
            stateIdByAbbrev[upperCode] = rows[0].id;
          } else {
            const ex = await client.query(
              'SELECT id FROM states WHERE abbreviation = $1',
              [upperCode]
            );
            stateIdByAbbrev[upperCode] = ex.rows[0]?.id;
          }
        }
        const resolvedStId = stateIdByAbbrev[upperCode];
        if (resolvedStId) {
          await client.query(
            `INSERT INTO ava_states (ava_id, state_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [avaId, resolvedStId]
          );
        }
      }

      // ── counties ──────────────────────────────────────────────────────────
      const countyNames = parsePipe(p.county);
      for (const countyName of countyNames) {
        // Associate county with the first state listed for this AVA
        // (counties themselves don't span states in TTB data)
        const primaryStateCode = stateCodes[0] ?? null;
        const primaryStateId = primaryStateCode
          ? stateIdByAbbrev[primaryStateCode] ?? null
          : null;

        const { rows: countyRows } = await client.query(
          `INSERT INTO counties (name, state_id)
           VALUES ($1, $2)
           ON CONFLICT (name, state_id) DO NOTHING
           RETURNING id`,
          [countyName, primaryStateId]
        );

        let countyId;
        if (countyRows.length > 0) {
          countyId = countyRows[0].id;
        } else {
          const ex = await client.query(
            'SELECT id FROM counties WHERE name = $1 AND state_id IS NOT DISTINCT FROM $2',
            [countyName, primaryStateId]
          );
          countyId = ex.rows[0]?.id;
        }

        if (countyId) {
          await client.query(
            `INSERT INTO ava_counties (ava_id, county_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [avaId, countyId]
          );
        }
      }

      if ((inserted + skipped) % 50 === 0 && (inserted + skipped) > 0) {
        process.stdout.write(
          `  processed ${inserted + skipped}/${allFiles.length}...\r`
        );
      }
    }

    await client.query('COMMIT');
    console.log(
      `\n  → inserted: ${inserted}, skipped (already existed): ${skipped}, errors: ${errors}`
    );

    // ── 3. Hierarchy pass — resolve `within` by name ──────────────────────
    console.log('\nBuilding AVA hierarchy…');
    let hierarchyInserted = 0;
    let hierarchyUnresolved = 0;

    await client.query('BEGIN');

    for (const [slug, meta] of Object.entries(avaMetaBySlug)) {
      const parentNames = parsePipe(meta.withinRaw);
      for (const parentName of parentNames) {
        const parentId = avaIdByName[parentName];
        if (!parentId) {
          // Parent AVA not found by name — log and skip
          // (this can happen if a parent spans a state not yet loaded)
          console.warn(`  ⚠ Could not resolve parent "${parentName}" for ${slug}`);
          hierarchyUnresolved++;
          continue;
        }
        await client.query(
          `INSERT INTO ava_hierarchy (parent_id, child_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [parentId, meta.id]
        );
        hierarchyInserted++;
      }
    }

    await client.query('COMMIT');
    console.log(
      `  → hierarchy rows inserted: ${hierarchyInserted}, unresolved parents: ${hierarchyUnresolved}`
    );

    // ── 4. Summary ────────────────────────────────────────────────────────
    const { rows: counts } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM avas)           AS avas,
        (SELECT COUNT(*) FROM states)         AS states,
        (SELECT COUNT(*) FROM counties)       AS counties,
        (SELECT COUNT(*) FROM ava_states)     AS ava_states,
        (SELECT COUNT(*) FROM ava_counties)   AS ava_counties,
        (SELECT COUNT(*) FROM ava_hierarchy)  AS ava_hierarchy
    `);
    console.log('\n=== Database row counts ===');
    for (const [key, val] of Object.entries(counts[0])) {
      console.log(`  ${key.padEnd(15)} ${val}`);
    }
    console.log('\nSeed complete.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFatal error — rolled back:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
