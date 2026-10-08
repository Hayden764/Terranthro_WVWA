/**
 * Contract releases — frozen, cumulative snapshots of the OWB dataset
 * (migration 032), and everything the OWB Portal's Data tab derives from them.
 *
 * Building a release copies every live OWB block in its scope (AVAs and/or
 * "outside any AVA") with its full contract attribute record, and carries the
 * rest forward unchanged from the previous release. A release never changes
 * after it is built, so its stats are cached in memory.
 *
 * Planting fields (variety, clone, …) are filled when Terranthro compiled
 * them (the default), or — for grower-supplied blocks (migration 034) — when
 * the organization currently shares with OWB (migration 033). A final pass
 * over the whole release refreshes them, so a grower who accepts the terms
 * is included in the next release and one who withdraws drops out of it.
 *
 * Acreage conventions (Exhibit A):
 *   headline acres  standing blocks, excluding isolated blocks under 2 ac
 *   AVA totals      a block counts toward every AVA it falls in, so nested
 *                   AVAs overlap their parents and do not sum to the total
 */
import { buildVintages } from '../routes/climate.js';

// Columns copied into contract_release_blocks (all but release_id).
const SNAPSHOT_COLUMNS = [
  'block_id', 'vineyard_id', 'vineyard_name', 'block_name', 'acres', 'planted_acres',
  'county_name', 'county_fips', 'ava_slugs', 'ava_names', 'block_status', 'imagery_year',
  'size_class', 'under_2_acres', 'in_headline', 'name_source', 'verification', 'observations',
  'elevation_min_ft', 'elevation_mean_ft', 'elevation_max_ft', 'slope_mean_deg', 'aspect_dominant_deg',
  'soil_series', 'soil_class', 'soil_drainage', 'available_water_cm', 'soil_units',
  'geology_formation', 'rock_type', 'geometry',
];

// Grower-entered fields, consent-gated (migration 033): [release column, live column].
const GROWER_FIELDS = [
  ['variety', 'variety'], ['clone', 'clone'], ['rootstock', 'rootstock'],
  ['year_planted', 'year_planted'], ['rows', 'rows'], ['spacing', 'spacing'],
  ['vines_per_acre', 'vines_per_acre'], ['vines', 'vines'], ['trellis', 'trellis'],
  ['fruit_sold_to', 'fruit_sold_to'], ['grower_notes', 'notes'],
];
const CARRIED_COLUMNS = [...SNAPSHOT_COLUMNS, 'organization_id', 'grower_supplied', 'grower_data', ...GROWER_FIELDS.map(([c]) => c)];

// Size classes in display order (keep in step with owb_size_class()).
const SIZE_ORDER = ['Under 2 ac', '2–5 ac', '5–10 ac', '10–25 ac', '25–50 ac', '50+ ac'];

/**
 * Build a draft release. Returns the new release row.
 * @param db  a pool client inside a transaction
 */
export async function buildRelease(db, { contractId, milestoneId, label, scopeAvas, scopeOutsideAvas, notes }) {
  const { rows: [prev] } = await db.query(
    `SELECT id FROM contract_releases WHERE contract_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [contractId]
  );

  const { rows: [release] } = await db.query(
    `INSERT INTO contract_releases
       (contract_id, milestone_id, label, scope_avas, scope_outside_avas, based_on_release_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [contractId, milestoneId, label, scopeAvas, scopeOutsideAvas, prev?.id ?? null, notes]
  );

  // 1. Blocks in scope, fresh from the live tables.
  await db.query(
    `INSERT INTO contract_release_blocks (release_id, ${SNAPSHOT_COLUMNS.join(', ')})
     SELECT $1, b.id, b.vineyard_id, v.vineyard_name, b.block_name, b.acres, b.planted_acres,
            co.name, co.fips, COALESCE(av.slugs, '{}'), COALESCE(av.names, '{}'),
            b.block_status, b.imagery_year, owb_size_class(b.acres), b.acres < 2,
            b.acres >= 2 OR EXISTS (
              SELECT 1 FROM vineyard_blocks o
              WHERE o.owb_dataset AND o.id <> b.id AND o.block_status = 'standing'
                AND ST_DWithin(o.geometry, b.geometry, 0.001)
                AND ST_DWithin(o.geometry::geography, b.geometry::geography, 30)
            ),
            b.name_source, b.verification,
            COALESCE((SELECT jsonb_object_agg(ob.imagery_year::text, ob.present)
                      FROM vineyard_block_observations ob WHERE ob.block_id = b.id), '{}'),
            t.elevation_min_ft, t.elevation_mean_ft, t.elevation_max_ft, t.slope_mean_deg, t.aspect_dominant_deg,
            s.series, s.soil_class, s.drainage, s.available_water_cm, s.units,
            g.formation, g.rock_type,
            b.geometry
     FROM vineyard_blocks b
     LEFT JOIN vineyards v ON v.id = b.vineyard_id
     CROSS JOIN LATERAL (SELECT ST_PointOnSurface(b.geometry) AS pt) p
     LEFT JOIN LATERAL (
       SELECT array_agg(a.slug::text ORDER BY a.slug) AS slugs, array_agg(a.name::text ORDER BY a.slug) AS names
       FROM avas a
       WHERE a.id IN (SELECT s.ava_id FROM ava_subdivided s WHERE ST_Intersects(s.geometry, p.pt))
     ) av ON TRUE
     LEFT JOIN LATERAL (
       SELECT c.name, c.fips FROM county_subdivided cs JOIN counties c ON c.id = cs.county_id
       WHERE ST_Intersects(cs.geometry, p.pt) LIMIT 1
     ) co ON TRUE
     LEFT JOIN vineyard_block_topo_stats t ON t.block_id = b.id
     LEFT JOIN vineyard_block_soils s ON s.block_id = b.id
     LEFT JOIN vineyard_block_geology g ON g.block_id = b.id
     WHERE b.owb_dataset AND b.geometry IS NOT NULL
       AND (COALESCE(av.slugs, '{}') && $2::text[] OR ($3 AND av.slugs IS NULL))`,
    [release.id, scopeAvas, scopeOutsideAvas]
  );

  // 2. Everything else carried forward from the previous release.
  if (prev) {
    await db.query(
      `INSERT INTO contract_release_blocks (release_id, ${CARRIED_COLUMNS.join(', ')})
       SELECT $1, ${CARRIED_COLUMNS.map((c) => `rb.${c}`).join(', ')}
       FROM contract_release_blocks rb
       WHERE rb.release_id = $2
         AND NOT (rb.ava_slugs && $3::text[])
         AND NOT ($4 AND cardinality(rb.ava_slugs) = 0)
         AND NOT EXISTS (SELECT 1 FROM contract_release_blocks x
                         WHERE x.release_id = $1 AND x.block_id = rb.block_id)`,
      [release.id, prev.id, scopeAvas, scopeOutsideAvas]
    );
  }

  // 3. Grower fields from the live blocks, for organizations sharing with OWB now.
  await db.query(
    `UPDATE contract_release_blocks rb
     SET organization_id = v.winery_id,
         grower_supplied = b.grower_supplied,
         grower_data = g.ok,
         ${GROWER_FIELDS.map(([rc, lc]) => `${rc} = CASE WHEN g.ok THEN b.${lc} END`).join(',\n         ')}
     FROM vineyard_blocks b
     LEFT JOIN vineyards v ON v.id = b.vineyard_id
     CROSS JOIN LATERAL (
       SELECT NOT b.grower_supplied OR COALESCE(organization_shares_with_owb(v.winery_id), FALSE) AS ok
     ) g
     WHERE rb.release_id = $1 AND b.id = rb.block_id`,
    [release.id]
  );
  // Carried blocks no longer in the live data keep grower-supplied fields only while still shared.
  await db.query(
    `UPDATE contract_release_blocks rb
     SET grower_data = FALSE, ${GROWER_FIELDS.map(([rc]) => `${rc} = NULL`).join(', ')}
     WHERE rb.release_id = $1 AND rb.grower_data AND rb.grower_supplied
       AND NOT EXISTS (SELECT 1 FROM vineyard_blocks b WHERE b.id = rb.block_id)
       AND NOT COALESCE(organization_shares_with_owb(rb.organization_id), FALSE)`,
    [release.id]
  );

  const { rows: [built] } = await db.query(
    `UPDATE contract_releases r
     SET block_count = s.n, acres = s.acres
     FROM (SELECT count(*)::int AS n, COALESCE(sum(acres), 0) AS acres
           FROM contract_release_blocks WHERE release_id = $1) s
     WHERE r.id = $1
     RETURNING r.*`,
    [release.id]
  );
  return built;
}

/** Releases for a contract, newest first. `publishedOnly` for the client. */
export async function listReleases(db, contractId, { publishedOnly }) {
  const { rows } = await db.query(
    `SELECT r.id, r.milestone_id, m.number AS milestone_number, r.label, r.scope_avas,
            r.scope_outside_avas, r.based_on_release_id, r.notes, r.block_count,
            r.acres::float AS acres, r.published_at, r.created_at
     FROM contract_releases r
     LEFT JOIN contract_milestones m ON m.id = r.milestone_id
     WHERE r.contract_id = $1 ${publishedOnly ? 'AND r.published_at IS NOT NULL' : ''}
     ORDER BY r.created_at DESC, r.id DESC`,
    [contractId]
  );
  return rows;
}

// ── Stats ────────────────────────────────────────────────────────────────────

const statsCache = new Map();
export function forgetRelease(releaseId) {
  statsCache.delete(Number(releaseId));
}

const num = (v, d = 1) => (v == null ? null : Number(Number(v).toFixed(d)));

export async function releaseStats(db, releaseId) {
  const id = Number(releaseId);
  if (statsCache.has(id)) return statsCache.get(id);

  const headline = `block_status = 'standing' AND in_headline`;
  const [summary, byAva, byCounty, bySize, obs] = await Promise.all([
    db.query(
      `SELECT count(*)::int AS blocks,
              count(DISTINCT vineyard_id)::int AS vineyards,
              COALESCE(sum(acres) FILTER (WHERE ${headline}), 0) AS headline_acres,
              count(*) FILTER (WHERE ${headline})::int AS headline_blocks,
              COALESCE(sum(acres) FILTER (WHERE block_status = 'standing' AND NOT in_headline), 0) AS small_isolated_acres,
              count(*) FILTER (WHERE block_status = 'standing' AND NOT in_headline)::int AS small_isolated_blocks,
              COALESCE(sum(acres) FILTER (WHERE block_status = 'removed'), 0) AS removed_acres,
              count(*) FILTER (WHERE block_status = 'removed')::int AS removed_blocks,
              sum(planted_acres) FILTER (WHERE ${headline}) AS planted_acres,
              count(*) FILTER (WHERE verification = 'needs_field')::int AS needs_field,
              count(*) FILTER (WHERE name_source IS NULL)::int AS unconfirmed_names,
              COALESCE(sum(acres) FILTER (WHERE ${headline} AND grower_data AND COALESCE(variety, clone, rootstock,
                trellis, spacing, fruit_sold_to, year_planted::text) IS NOT NULL), 0) AS grower_shared_acres,
              count(DISTINCT organization_id) FILTER (WHERE grower_data)::int AS grower_shared_orgs,
              array_remove(array_agg(DISTINCT imagery_year ORDER BY imagery_year), NULL) AS imagery_years
       FROM contract_release_blocks WHERE release_id = $1`,
      [id]
    ),
    db.query(
      `SELECT u.slug, u.name, count(*)::int AS blocks, sum(rb.acres) AS acres
       FROM contract_release_blocks rb
       CROSS JOIN LATERAL unnest(rb.ava_slugs, rb.ava_names) AS u(slug, name)
       WHERE rb.release_id = $1 AND rb.${headline}
       GROUP BY 1, 2 ORDER BY acres DESC`,
      [id]
    ),
    db.query(
      `SELECT COALESCE(county_name, 'Unknown') AS county, county_fips AS fips,
              count(*)::int AS blocks, sum(acres) AS acres
       FROM contract_release_blocks WHERE release_id = $1 AND ${headline}
       GROUP BY 1, 2 ORDER BY acres DESC`,
      [id]
    ),
    db.query(
      `SELECT size_class, count(*)::int AS blocks, sum(acres) AS acres,
              count(*) FILTER (WHERE in_headline)::int AS headline_blocks
       FROM contract_release_blocks WHERE release_id = $1 AND block_status = 'standing'
       GROUP BY 1`,
      [id]
    ),
    db.query(
      `SELECT acres, observations FROM contract_release_blocks
       WHERE release_id = $1 AND observations <> '{}'::jsonb`,
      [id]
    ),
  ]);

  const s = summary.rows[0];
  const stats = {
    summary: {
      ...s,
      headline_acres: num(s.headline_acres),
      small_isolated_acres: num(s.small_isolated_acres),
      removed_acres: num(s.removed_acres),
      planted_acres: num(s.planted_acres),
      grower_shared_acres: num(s.grower_shared_acres),
    },
    by_ava: byAva.rows.map((r) => ({ ...r, acres: num(r.acres) })),
    by_county: byCounty.rows.map((r) => ({ ...r, acres: num(r.acres) })),
    by_size_class: SIZE_ORDER
      .map((cls) => bySize.rows.find((r) => r.size_class === cls))
      .filter(Boolean)
      .map((r) => ({ ...r, acres: num(r.acres) })),
    change: changeOverTime(obs.rows),
  };
  statsCache.set(id, stats);
  return stats;
}

/**
 * Acres present in each imagery year, and what was planted / removed between
 * consecutive years. A block only counts in a step when it was observed in
 * both years.
 */
function changeOverTime(rows) {
  const years = [...new Set(rows.flatMap((r) => Object.keys(r.observations)))].map(Number).sort((a, b) => a - b);
  const present = years.map((y) => ({
    year: y,
    acres: num(rows.reduce((a, r) => a + (r.observations[y] === true ? Number(r.acres) : 0), 0)),
    blocks: rows.filter((r) => r.observations[y] === true).length,
  }));
  const steps = years.slice(1).map((y, i) => {
    const from = years[i];
    let planted = 0; let removed = 0; let plantedN = 0; let removedN = 0;
    for (const r of rows) {
      const a = r.observations[from]; const b = r.observations[y];
      if (a === false && b === true) { planted += Number(r.acres); plantedN += 1; }
      if (a === true && b === false) { removed += Number(r.acres); removedN += 1; }
    }
    return {
      from, to: y,
      planted_acres: num(planted), planted_blocks: plantedN,
      removed_acres: num(removed), removed_blocks: removedN,
      net_acres: num(planted - removed),
    };
  });
  return { years: present, steps };
}

// ── CSV ──────────────────────────────────────────────────────────────────────

function csvCell(v) {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.join('; ') : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  const head = columns.map(([, label]) => csvCell(label)).join(',');
  const body = rows.map((r) => columns.map(([key]) => csvCell(r[key])).join(','));
  return [head, ...body].join('\r\n') + '\r\n';
}

/** The Data tab's report tables as CSV, keyed by name. */
export function statsTableCsv(stats, table) {
  switch (table) {
    case 'by-ava':
      return toCsv([['name', 'AVA'], ['blocks', 'Blocks'], ['acres', 'Acres']], stats.by_ava);
    case 'by-county':
      return toCsv([['county', 'County'], ['fips', 'FIPS'], ['blocks', 'Blocks'], ['acres', 'Acres']], stats.by_county);
    case 'by-size-class':
      return toCsv([['size_class', 'Size class'], ['blocks', 'Blocks'], ['acres', 'Acres'],
        ['headline_blocks', 'Blocks in headline figure']], stats.by_size_class);
    case 'change':
      return toCsv([['from', 'From'], ['to', 'To'], ['planted_acres', 'Planted acres'],
        ['planted_blocks', 'Planted blocks'], ['removed_acres', 'Removed acres'],
        ['removed_blocks', 'Removed blocks'], ['net_acres', 'Net change (acres)']], stats.change.steps);
    default:
      return null;
  }
}

const BLOCK_CSV_COLUMNS = [
  ['block_id', 'block_id'], ['vineyard_id', 'vineyard_id'], ['vineyard_name', 'vineyard_name'],
  ['block_name', 'block_name'], ['acres', 'acres'], ['planted_acres', 'planted_acres'],
  ['county_name', 'county'], ['county_fips', 'county_fips'], ['ava_names', 'avas'],
  ['block_status', 'status'], ['imagery_year', 'imagery_year'], ['size_class', 'size_class'],
  ['under_2_acres', 'under_2_acres'], ['in_headline', 'in_headline_figure'],
  ['name_source', 'name_source'], ['verification', 'verification'],
  ['present_2020', 'present_2020'], ['present_2022', 'present_2022'], ['present_2024', 'present_2024'],
  ['present_2026', 'present_2026'],
  ['elevation_min_ft', 'elevation_min_ft'], ['elevation_mean_ft', 'elevation_mean_ft'],
  ['elevation_max_ft', 'elevation_max_ft'], ['slope_mean_deg', 'slope_mean_deg'],
  ['aspect_dominant_deg', 'aspect_dominant_deg'], ['soil_series', 'soil_series'],
  ['soil_class', 'soil_class'], ['soil_drainage', 'soil_drainage'],
  ['available_water_cm', 'available_water_cm'], ['geology_formation', 'geology_formation'],
  ['rock_type', 'rock_type'],
  ['grower_data', 'planting_details_available'], ['variety', 'variety'], ['clone', 'clone'],
  ['rootstock', 'rootstock'], ['year_planted', 'year_planted'], ['rows', 'rows'],
  ['spacing', 'spacing'], ['vines_per_acre', 'vines_per_acre'], ['vines', 'vines'],
  ['trellis', 'trellis'], ['fruit_sold_to', 'fruit_buyers'], ['grower_notes', 'grower_notes'],
  ['lat', 'centroid_lat'], ['lon', 'centroid_lon'],
];

/** Every block in a release, one row each (no geometry — that is the GeoPackage). */
export async function releaseBlocksCsv(db, releaseId) {
  const { rows } = await db.query(
    `SELECT rb.*, ST_Y(ST_PointOnSurface(rb.geometry)) AS lat, ST_X(ST_PointOnSurface(rb.geometry)) AS lon
     FROM contract_release_blocks rb WHERE rb.release_id = $1
     ORDER BY rb.vineyard_name NULLS LAST, rb.block_id`,
    [releaseId]
  );
  for (const r of rows) {
    for (const y of [2020, 2022, 2024, 2026]) r[`present_${y}`] = r.observations?.[y] ?? null;
    r.lat = num(r.lat, 6);
    r.lon = num(r.lon, 6);
  }
  return toCsv(BLOCK_CSV_COLUMNS, rows);
}

// ── AVA context (statewide, not release-bound) ───────────────────────────────

let avaContextCache = null;
const AVA_CONTEXT_TTL_MS = 60 * 60 * 1000;

/**
 * One row per Oregon AVA: Oregon acreage, 1991–2020 climate normals, terrain
 * and dominant soil / bedrock. Derived from public data, so it is shown
 * before any vineyard data is delivered.
 */
export async function avaContext(db) {
  if (avaContextCache && Date.now() - avaContextCache.at < AVA_CONTEXT_TTL_MS) return avaContextCache.rows;

  const [avas, climate, terroir] = await Promise.all([
    db.query(
      `SELECT a.id, a.slug, a.name,
              (SELECT p.slug FROM ava_hierarchy h JOIN avas p ON p.id = h.parent_id
                WHERE h.child_id = a.id LIMIT 1) AS parent_slug,
              av.acres::float AS oregon_acres,
              t.elevation_min_ft::float AS elevation_min_ft, t.elevation_max_ft::float AS elevation_max_ft,
              t.elevation_mean_ft::float AS elevation_mean_ft, t.slope_mean_deg::float AS slope_mean_deg
       FROM avas a
       LEFT JOIN ava_states av ON av.ava_id = a.id
         AND av.state_id = (SELECT id FROM states WHERE abbreviation = 'OR')
       LEFT JOIN ava_topo_stats t ON t.ava_id = a.id
       WHERE a.removed IS NULL
       ORDER BY a.name`
    ),
    db.query(
      `SELECT entity_key AS slug, year, month, tmean_c, tmin_c, tmax_c, ppt_mm
       FROM climate_monthly WHERE entity_type = 'ava' ORDER BY entity_key, year, month`
    ),
    db.query(
      `SELECT ava_id, layer, class, pct::float AS pct FROM ava_terroir_composition
       WHERE rank = 1 AND layer IN ('soil', 'soil_series', 'bedrock', 'formation')`
    ),
  ]);

  const climateBy = new Map();
  for (const r of climate.rows) {
    if (!climateBy.has(r.slug)) climateBy.set(r.slug, []);
    climateBy.get(r.slug).push(r);
  }
  const terroirBy = new Map();
  for (const r of terroir.rows) {
    if (!terroirBy.has(r.ava_id)) terroirBy.set(r.ava_id, {});
    terroirBy.get(r.ava_id)[r.layer] = { class: r.class, pct: num(r.pct, 0) };
  }

  const rows = avas.rows.map((a) => {
    const c = climateBy.has(a.slug) ? buildVintages(climateBy.get(a.slug)).baselines.normal : null;
    const t = terroirBy.get(a.id) || {};
    return {
      slug: a.slug,
      name: a.name,
      parent_slug: a.parent_slug,
      oregon_acres: a.oregon_acres == null ? null : Math.round(a.oregon_acres),
      gdd_normal: c?.gdd ?? null,
      growing_season_temp_f: c?.seasons?.growing?.tmean ?? null,
      growing_season_precip_in: c?.seasons?.growing?.ppt ?? null,
      elevation_min_ft: a.elevation_min_ft == null ? null : Math.round(a.elevation_min_ft),
      elevation_max_ft: a.elevation_max_ft == null ? null : Math.round(a.elevation_max_ft),
      elevation_mean_ft: a.elevation_mean_ft == null ? null : Math.round(a.elevation_mean_ft),
      slope_mean_deg: num(a.slope_mean_deg),
      soil: t.soil ?? null,
      soil_series: t.soil_series ?? null,
      bedrock: t.bedrock ?? null,
      formation: t.formation ?? null,
    };
  });
  avaContextCache = { at: Date.now(), rows };
  return rows;
}

export function avaContextCsv(rows) {
  const flat = rows.map((r) => ({
    ...r,
    soil: r.soil && `${r.soil.class} (${r.soil.pct}%)`,
    soil_series: r.soil_series && `${r.soil_series.class} (${r.soil_series.pct}%)`,
    bedrock: r.bedrock && `${r.bedrock.class} (${r.bedrock.pct}%)`,
    formation: r.formation && `${r.formation.class} (${r.formation.pct}%)`,
  }));
  return toCsv([
    ['name', 'AVA'], ['oregon_acres', 'Oregon acres'],
    ['gdd_normal', 'GDD 1991–2020 normal (°F, base 50)'],
    ['growing_season_temp_f', 'Growing season mean temp (°F)'],
    ['growing_season_precip_in', 'Growing season precip (in)'],
    ['elevation_min_ft', 'Elevation min (ft)'], ['elevation_mean_ft', 'Elevation mean (ft)'],
    ['elevation_max_ft', 'Elevation max (ft)'], ['slope_mean_deg', 'Mean slope (°)'],
    ['soil', 'Dominant soil'], ['soil_series', 'Dominant soil series'],
    ['bedrock', 'Dominant bedrock'], ['formation', 'Dominant formation'],
  ], flat);
}
