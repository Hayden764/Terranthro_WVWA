/**
 * Contract query engine — the OWB Portal's query builder.
 *
 * Every query runs against one published release (a frozen snapshot), so a
 * figure can always be reproduced. A query is a JSON spec:
 *
 *   {
 *     population: 'headline' | 'standing' | 'all',   default 'headline'
 *     group_by:   ['county', 'variety'],               0–2 dimension keys
 *     filters:    { ava: ['dundee-hills'], soil_class: ['Volcanic'],
 *                   elevation_ft: { min: 500 }, … },
 *     mode:       'summary' | 'blocks'                 default 'summary'
 *   }
 *
 * Dimensions and filters are an allowlist; values are always bound as
 * parameters. Headline acres follow the contract (standing blocks, isolated
 * blocks under 2 ac excluded). Grouping by AVA counts a block in every AVA it
 * falls in, so nested AVAs overlap their parents.
 *
 * Planting fields (variety, clone, …) come from Terranthro's research or,
 * for grower-supplied blocks, only once the grower shares with OWB; withheld
 * blocks group as "Not shared", blocks with nothing on file as "Not
 * reported". Every result reports how many of its acres have planting
 * details behind them.
 */

import { toCsv } from './contractReleases.js';

// A block counts toward "planting details on file" only when OWB may see its
// planting fields and at least one of them is filled in.
const HAS_PLANTING = `rb.grower_data AND COALESCE(rb.variety, rb.clone, rb.rootstock, rb.trellis,
  rb.spacing, rb.fruit_sold_to, rb.year_planted::text, rb.vines::text, rb.vines_per_acre::text) IS NOT NULL`;

const SIZE_ORDER = ['Under 2 ac', '2–5 ac', '5–10 ac', '10–25 ac', '25–50 ac', '50+ ac'];

/** A grower field, normalized for grouping, with its consent fallbacks. */
const grower = (expr) => `CASE WHEN NOT rb.grower_data THEN 'Not shared'
  ELSE COALESCE(NULLIF(${expr}, ''), 'Not reported') END`;

const ELEVATION_BAND = `CASE WHEN rb.elevation_mean_ft IS NULL THEN 'Unknown'
  ELSE (floor(rb.elevation_mean_ft / 250) * 250)::int || '–' || ((floor(rb.elevation_mean_ft / 250) + 1) * 250)::int || ' ft' END`;
const SLOPE_BAND = `CASE WHEN rb.slope_mean_deg IS NULL THEN 'Unknown'
  WHEN rb.slope_mean_deg < 3 THEN 'Flat (under 3°)' WHEN rb.slope_mean_deg < 8 THEN 'Gentle (3–8°)'
  WHEN rb.slope_mean_deg < 15 THEN 'Moderate (8–15°)' WHEN rb.slope_mean_deg < 25 THEN 'Steep (15–25°)'
  ELSE 'Very steep (25°+)' END`;
const ASPECT = `CASE WHEN rb.aspect_dominant_deg IS NULL THEN 'Unknown'
  WHEN rb.slope_mean_deg < 3 THEN 'Flat'
  ELSE (ARRAY['N','NE','E','SE','S','SW','W','NW'])[(floor(((rb.aspect_dominant_deg::numeric + 22.5) % 360) / 45))::int + 1] END`;

/**
 * Dimensions you can group and filter by.
 *   sql     expression over contract_release_blocks rb
 *   group   section in the UI
 *   order   optional fixed display order (otherwise acres, largest first)
 */
export const DIMENSIONS = {
  ava:               { label: 'AVA', group: 'Location', special: 'ava' },
  county:            { label: 'County', group: 'Location', sql: `COALESCE(rb.county_name, 'Unknown')` },
  vineyard:          { label: 'Vineyard', group: 'Location', sql: `COALESCE(rb.vineyard_name, 'Unnamed')` },
  size_class:        { label: 'Block size', group: 'Block', sql: `rb.size_class`, order: SIZE_ORDER },
  status:            { label: 'Standing / removed', group: 'Block', sql: `rb.block_status` },
  imagery_year:      { label: 'Imagery year', group: 'Block', sql: `COALESCE(rb.imagery_year::text, 'Unknown')` },
  elevation_band:    { label: 'Elevation (250 ft bands)', group: 'Site', sql: ELEVATION_BAND, numericOrder: true },
  slope_band:        { label: 'Slope', group: 'Site', sql: SLOPE_BAND,
                       order: ['Flat (under 3°)', 'Gentle (3–8°)', 'Moderate (8–15°)', 'Steep (15–25°)', 'Very steep (25°+)', 'Unknown'] },
  aspect:            { label: 'Aspect', group: 'Site', sql: ASPECT,
                       order: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'Flat', 'Unknown'] },
  soil_class:        { label: 'Soil class', group: 'Site', sql: `COALESCE(rb.soil_class, 'Unknown')` },
  soil_series:       { label: 'Soil series', group: 'Site', sql: `COALESCE(rb.soil_series, 'Unknown')` },
  soil_drainage:     { label: 'Soil drainage', group: 'Site', sql: `COALESCE(rb.soil_drainage, 'Unknown')` },
  rock_type:         { label: 'Bedrock', group: 'Site', sql: `COALESCE(rb.rock_type, 'Unknown')` },
  geology_formation: { label: 'Geologic formation', group: 'Site', sql: `COALESCE(rb.geology_formation, 'Unknown')` },
  variety:           { label: 'Variety', group: 'Planting details', grower: true, sql: grower(`initcap(lower(trim(rb.variety)))`) },
  clone:             { label: 'Clone', group: 'Planting details', grower: true, sql: grower(`trim(rb.clone)`) },
  rootstock:         { label: 'Rootstock', group: 'Planting details', grower: true, sql: grower(`trim(rb.rootstock)`) },
  trellis:           { label: 'Trellis', group: 'Planting details', grower: true, sql: grower(`initcap(lower(trim(rb.trellis)))`) },
  planting_decade:   { label: 'Planting decade', group: 'Planting details', grower: true, numericOrder: true,
                       sql: grower(`CASE WHEN rb.year_planted IS NULL THEN NULL ELSE ((rb.year_planted / 10) * 10)::text || 's' END`) },
  fruit_buyer:       { label: 'Fruit buyer', group: 'Planting details', grower: true, sql: grower(`trim(rb.fruit_sold_to)`) },
  name_source:       { label: 'Name confirmed by', group: 'Data quality', sql: `COALESCE(rb.name_source, 'Not yet confirmed')` },
  verification:      { label: 'Verification', group: 'Data quality', sql: `COALESCE(rb.verification, 'Unknown')` },
};

/** Numeric range filters. */
export const RANGES = {
  acres:          { label: 'Block acres', sql: 'rb.acres' },
  elevation_ft:   { label: 'Elevation (ft)', sql: 'rb.elevation_mean_ft' },
  slope_deg:      { label: 'Slope (°)', sql: 'rb.slope_mean_deg' },
  year_planted:   { label: 'Year planted', sql: 'rb.year_planted', grower: true },
  vines_per_acre: { label: 'Vines per acre', sql: 'rb.vines_per_acre', grower: true },
};

const POPULATIONS = {
  headline: { label: 'Headline acreage', sql: `rb.block_status = 'standing' AND rb.in_headline` },
  standing: { label: 'All standing blocks', sql: `rb.block_status = 'standing'` },
  all:      { label: 'Everything, including removed', sql: 'TRUE' },
};

const MAX_GROUP_ROWS = 1000;
const MAX_BLOCK_ROWS = 500;

export class QueryError extends Error {}

/** Validate and normalize a spec from the client. Throws QueryError. */
export function parseSpec(raw) {
  const spec = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
  const population = spec.population || 'headline';
  if (!POPULATIONS[population]) throw new QueryError('Unknown population');
  const mode = spec.mode === 'blocks' ? 'blocks' : 'summary';

  const groupBy = Array.isArray(spec.group_by) ? spec.group_by.filter(Boolean) : [];
  if (groupBy.length > 2) throw new QueryError('Group by at most two fields');
  for (const g of groupBy) if (!DIMENSIONS[g]) throw new QueryError(`Unknown field: ${g}`);
  if (new Set(groupBy).size !== groupBy.length) throw new QueryError('Group by two different fields');

  const filters = {};
  for (const [key, val] of Object.entries(spec.filters || {})) {
    if (DIMENSIONS[key]) {
      const values = (Array.isArray(val) ? val : [val]).map(String).filter((v) => v.length <= 200);
      if (values.length) filters[key] = values.slice(0, 200);
    } else if (RANGES[key]) {
      const min = val?.min === '' || val?.min == null ? null : Number(val.min);
      const max = val?.max === '' || val?.max == null ? null : Number(val.max);
      if ([min, max].some((v) => v != null && !Number.isFinite(v))) throw new QueryError(`Invalid range for ${key}`);
      if (min != null || max != null) filters[key] = { min, max };
    } else {
      throw new QueryError(`Unknown filter: ${key}`);
    }
  }
  return { population, mode, group_by: groupBy, filters };
}

/** WHERE clause + params for a spec. Params start at $2 ($1 is the release). */
function whereClause(spec) {
  const params = [];
  const add = (v) => { params.push(v); return `$${params.length + 1}`; };
  const parts = [`rb.release_id = $1`, POPULATIONS[spec.population].sql];
  for (const [key, val] of Object.entries(spec.filters)) {
    if (key === 'ava') parts.push(`rb.ava_slugs && ${add(val)}::text[]`);
    else if (DIMENSIONS[key]) parts.push(`(${DIMENSIONS[key].sql}) = ANY(${add(val)}::text[])`);
    else {
      const col = RANGES[key].sql;
      if (val.min != null) parts.push(`${col} >= ${add(val.min)}`);
      if (val.max != null) parts.push(`${col} <= ${add(val.max)}`);
    }
  }
  return { where: parts.join(' AND '), params };
}

// Placeholder buckets always sort after real values.
const TAIL = new Set(['Not shared', 'Not reported', 'Unknown', 'Unnamed', 'Not yet confirmed']);

function sortRows(rows, groupBy) {
  const rank = (dimKey, v) => {
    const d = DIMENSIONS[dimKey];
    if (d.order) { const i = d.order.indexOf(v); return i < 0 ? 999 : i; }
    if (d.numericOrder) { const n = parseFloat(v); return Number.isFinite(n) ? n : 1e9; }
    return null;
  };
  return rows.sort((a, b) => {
    for (const [i, g] of groupBy.entries()) {
      const tailA = TAIL.has(a[`g${i}`]); const tailB = TAIL.has(b[`g${i}`]);
      if (tailA !== tailB) return tailA ? 1 : -1;
      const ra = rank(g, a[`g${i}`]); const rbk = rank(g, b[`g${i}`]);
      if (ra != null && ra !== rbk) return ra - rbk;
      if (ra == null && i < groupBy.length - 1 && a[`g${i}`] !== b[`g${i}`]) {
        // Unordered outer group: keep its members together, biggest group first.
        return (b[`t${i}`] - a[`t${i}`]) || String(a[`g${i}`]).localeCompare(String(b[`g${i}`]));
      }
    }
    return b.acres - a.acres;
  });
}

const n1 = (v) => (v == null ? null : Number(Number(v).toFixed(1)));

/** Run a parsed spec against a release. */
export async function runQuery(db, releaseId, spec) {
  const { where, params } = whereClause(spec);
  const totals = await db.query(
    `SELECT count(*)::int AS blocks, count(DISTINCT rb.vineyard_id)::int AS vineyards,
            COALESCE(sum(rb.acres), 0) AS acres,
            COALESCE(sum(rb.acres) FILTER (WHERE ${HAS_PLANTING}), 0) AS grower_acres
     FROM contract_release_blocks rb WHERE ${where}`,
    [releaseId, ...params]
  );
  const t = totals.rows[0];
  const result = {
    spec,
    totals: { blocks: t.blocks, vineyards: t.vineyards, acres: n1(t.acres), grower_acres: n1(t.grower_acres) },
  };

  if (spec.mode === 'blocks') {
    const { rows } = await db.query(
      `SELECT rb.block_id, rb.vineyard_name, rb.block_name, rb.acres::float AS acres, rb.county_name,
              rb.ava_names, rb.block_status, rb.size_class, rb.elevation_mean_ft::float AS elevation_mean_ft,
              rb.slope_mean_deg::float AS slope_mean_deg, rb.soil_series, rb.rock_type, rb.grower_data,
              rb.variety, rb.clone, rb.rootstock, rb.year_planted, rb.trellis, rb.fruit_sold_to
       FROM contract_release_blocks rb WHERE ${where}
       ORDER BY rb.vineyard_name NULLS LAST, rb.acres DESC
       LIMIT ${MAX_BLOCK_ROWS}`,
      [releaseId, ...params]
    );
    result.blocks = rows;
    result.truncated = t.blocks > rows.length;
    return result;
  }

  if (!spec.group_by.length) return { ...result, rows: [] };

  const usesAva = spec.group_by.includes('ava');
  const exprs = spec.group_by.map((g) => (g === 'ava' ? 'av.name' : DIMENSIONS[g].sql));
  // Filtered to some AVAs and grouped by AVA: show only those AVAs, not their parents.
  let avaRows = '';
  if (usesAva && spec.filters.ava) {
    params.push(spec.filters.ava);
    avaRows = ` AND av.slug = ANY($${params.length + 1}::text[])`;
  }
  const { rows } = await db.query(
    `SELECT ${exprs.map((e, i) => `${e} AS g${i}`).join(', ')},
            count(*)::int AS blocks, count(DISTINCT rb.vineyard_id)::int AS vineyards,
            sum(rb.acres) AS acres,
            COALESCE(sum(rb.acres) FILTER (WHERE ${HAS_PLANTING}), 0) AS grower_acres
     FROM contract_release_blocks rb
     ${usesAva ? 'CROSS JOIN LATERAL unnest(rb.ava_slugs, rb.ava_names) AS av(slug, name)' : ''}
     WHERE ${where}${avaRows}
     GROUP BY ${exprs.map((_, i) => i + 1).join(', ')}
     LIMIT ${MAX_GROUP_ROWS + 1}`,
    [releaseId, ...params]
  );
  const shaped = rows.slice(0, MAX_GROUP_ROWS).map((r) => ({
    ...r, acres: n1(r.acres), grower_acres: n1(r.grower_acres),
  }));
  // Outer-group totals, so an unordered outer dimension sorts by its size.
  if (spec.group_by.length === 2) {
    const outer = new Map();
    for (const r of shaped) outer.set(r.g0, (outer.get(r.g0) || 0) + r.acres);
    for (const r of shaped) r.t0 = outer.get(r.g0);
  }
  result.rows = sortRows(shaped, spec.group_by).map(({ t0, ...r }) => r);
  result.truncated = rows.length > MAX_GROUP_ROWS;
  result.overlapping = usesAva;
  return result;
}

/** Every block matching a spec, as CSV rows (no row limit). */
export async function queryBlockRows(db, releaseId, spec) {
  const { where, params } = whereClause(spec);
  const { rows } = await db.query(
    `SELECT rb.* FROM contract_release_blocks rb WHERE ${where}
     ORDER BY rb.vineyard_name NULLS LAST, rb.block_id`,
    [releaseId, ...params]
  );
  return rows;
}

/** Field catalogue + the values present in a release, for the builder's dropdowns. */
const schemaCache = new Map();
export async function querySchema(db, releaseId) {
  const id = Number(releaseId);
  if (schemaCache.has(id)) return schemaCache.get(id);

  const values = {};
  // Every AVA, so a saved query naming one with no blocks yet still reads well.
  const avas = await db.query(
    `SELECT a.slug::text AS value, a.name::text AS label, COALESCE(c.blocks, 0) AS blocks
     FROM avas a
     LEFT JOIN (SELECT av.slug, count(*)::int AS blocks
                FROM contract_release_blocks rb CROSS JOIN LATERAL unnest(rb.ava_slugs) AS av(slug)
                WHERE rb.release_id = $1 GROUP BY 1) c ON c.slug = a.slug
     WHERE a.removed IS NULL ORDER BY a.name`,
    [id]
  );
  values.ava = avas.rows;
  for (const [key, d] of Object.entries(DIMENSIONS)) {
    if (d.special) continue;
    const { rows } = await db.query(
      `SELECT ${d.sql} AS value, count(*)::int AS blocks
       FROM contract_release_blocks rb WHERE rb.release_id = $1
       GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 2000`,
      [id]
    );
    values[key] = sortRows(rows.map((r) => ({ g0: r.value, ...r, acres: r.blocks })), [key])
      .map((r) => ({ value: r.value, label: r.value, blocks: r.blocks }));
  }

  const schema = {
    populations: Object.entries(POPULATIONS).map(([key, p]) => ({ key, label: p.label })),
    dimensions: Object.entries(DIMENSIONS).map(([key, d]) => ({ key, label: d.label, group: d.group, grower: !!d.grower })),
    ranges: Object.entries(RANGES).map(([key, r]) => ({ key, label: r.label, grower: !!r.grower })),
    values,
  };
  schemaCache.set(id, schema);
  return schema;
}

export function forgetQuerySchema(releaseId) {
  schemaCache.delete(Number(releaseId));
}

/** CSV columns for a summary result. */
export function summaryCsvColumns(spec) {
  return [
    ...spec.group_by.map((g, i) => [`g${i}`, DIMENSIONS[g].label]),
    ['blocks', 'Blocks'], ['vineyards', 'Vineyards'], ['acres', 'Acres'],
    ['grower_acres', 'Acres with planting details'],
  ];
}

// ── HTTP glue shared by the client and admin routes ─────────────────────────


const BLOCK_CSV = [
  ['block_id', 'block_id'], ['vineyard_name', 'vineyard_name'], ['block_name', 'block_name'],
  ['acres', 'acres'], ['county_name', 'county'], ['ava_names', 'avas'], ['block_status', 'status'],
  ['size_class', 'size_class'], ['elevation_mean_ft', 'elevation_mean_ft'],
  ['slope_mean_deg', 'slope_mean_deg'], ['aspect_dominant_deg', 'aspect_dominant_deg'],
  ['soil_series', 'soil_series'], ['soil_class', 'soil_class'], ['rock_type', 'rock_type'],
  ['grower_data', 'planting_details_available'], ['variety', 'variety'], ['clone', 'clone'],
  ['rootstock', 'rootstock'], ['year_planted', 'year_planted'], ['spacing', 'spacing'],
  ['vines_per_acre', 'vines_per_acre'], ['vines', 'vines'], ['trellis', 'trellis'],
  ['fruit_sold_to', 'fruit_buyers'], ['grower_notes', 'grower_notes'],
];

/**
 * GET handler body for /releases/:rid/query?q=<json spec>[&format=csv].
 * `sendCsv(res, filename, csv)` is passed in to avoid a route import cycle.
 */
export async function handleQuery(db, releaseId, req, res, sendCsv) {
  let spec;
  try {
    spec = parseSpec(req.query.q || '{}');
  } catch (err) {
    return res.status(400).json({ error: err instanceof QueryError ? err.message : 'Invalid query' });
  }
  if (req.query.format === 'csv') {
    if (spec.mode === 'blocks') {
      const rows = await queryBlockRows(db, releaseId, spec);
      return sendCsv(res, `owb-query-blocks-${releaseId}.csv`, toCsv(BLOCK_CSV, rows));
    }
    const result = await runQuery(db, releaseId, spec);
    return sendCsv(res, `owb-query-${releaseId}.csv`, toCsv(summaryCsvColumns(spec), result.rows));
  }
  res.json(await runQuery(db, releaseId, spec));
}
