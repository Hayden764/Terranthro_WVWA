// Climate map layers — heat (growing degree days) and rain — as PMTiles built by
// data-pipeline/scripts/build-climate-tiles.py from PRISM 800m monthly grids.
// Band edges here must match the *_EDGES constants in that script. Features
// carry `bin` (index into the colour arrays), `lo`/`hi` (band edges, null at the
// open ends), `region` (Winkler, heat normal) and `yr` (vintage layers).

import { EARTH_TILES_BASE } from './earthLayersConfig';

// One file per layer (climate-normal.pmtiles, climate-rain-annual.pmtiles, …)
const tilesUrl = (name) => `${EARTH_TILES_BASE}/climate-${name}.pmtiles`;
export const CLIMATE_MAP_OPACITY = 0.62;

export const VINTAGE_FIRST_YEAR = 1991;
export const VINTAGE_LAST_YEAR = 2025;

const PRISM_SOURCE = 'PRISM Climate Group, Oregon State University (800 m monthly)';

// Growing degree days (°F, Apr–Oct). Bin 0 = below 1500 ("too cool", neutral);
// bins 1–8 = single-hue orange ramp, light → dark.
export const NORMAL_EDGES = [1500, 1750, 2000, 2250, 2500, 2750, 3000, 3500];
export const NORMAL_COLORS = [
  '#e4e1da',
  '#fbd3a6', '#f8b579', '#f39650', '#e97a32', '#d15f1e', '#ac4916', '#843711', '#5b270b',
];

// Diverging cool ↔ warm anomaly bins (°F·days vs the 1991–2020 normal), shared
// with the vintage stripes in components/climate/ClimateVintages.jsx.
export const ANOM_EDGES = [-350, -250, -150, -50, 50, 150, 250, 350];
export const ANOM_COLORS = ['#184f95', '#2a78d6', '#6da7ec', '#b7d3f6', '#d6d1c7', '#f4c1b8', '#ec8a7c', '#e34948', '#a8231f'];

export function anomalyColor(anom) {
  if (anom == null) return 'transparent';
  let i = 0;
  while (i < ANOM_EDGES.length && anom > ANOM_EDGES[i]) i++;
  return ANOM_COLORS[i];
}

// Rain (inches): single-hue teal ramp, light (dry) → dark (wet). Teal rather
// than blue so rain never reads as the heat maps' "cooler" arm.
export const RAIN_COLORS = ['#e6f3f4', '#c0e1e4', '#9dd0d5', '#74bac2', '#4fa3ad', '#358a96', '#23727e', '#175a65', '#0d434d'];
export const ANNUAL_PPT_EDGES = [15, 25, 35, 45, 55, 70, 90, 120];
export const HARVEST_PPT_EDGES = [1.5, 2.5, 3.5, 4.5, 5.5, 7, 9, 12];
// Harvest rain as % of normal: brown (drier) ↔ neutral ↔ teal (wetter),
// log-symmetric bins (½× ↔ 2×, ⅔× ↔ 1.5×, 0.8× ↔ 1.25×)
export const PPT_PCT_EDGES = [50, 67, 80, 125, 150, 200];
export const PPT_PCT_COLORS = ['#a8702f', '#d4a46a', '#ecd3b0', '#d6d1c7', '#a8d5d9', '#4fa3ad', '#1d6f7a'];

const WINKLER_WHY = 'Growing degree days (GDD) add up how much warmth the vines get over the season: each day, the degrees the average temperature sits above 50°F, summed April through October. More heat means riper fruit; the Winkler regions group GDD into bands that suit different grapes. Cool-climate Pinot noir and Chardonnay do best in Region Ia–Ib (1,500–2,500 GDD).';

/*
 * Per layer: `group` (heat | rain, for the sidebar), `format` (how band edges
 * read), `vintage` (one feature set per year, filtered by the shared year),
 * `keyLabels` (low/high ends for compact keys) and `popup(props, year)` →
 * { kicker, note } for the tap popup.
 */
export const CLIMATE_MAP_LAYERS = {
  gdd_normal: {
    id: 'gdd_normal',
    group: 'heat',
    label: 'Heat accumulation',
    sub: 'Growing degree days · 1991–2020',
    icon: '🌡️',
    sourceLayer: 'gdd_normal',
    url: tilesUrl('normal'),
    colors: NORMAL_COLORS,
    edges: NORMAL_EDGES,
    format: 'gdd',
    why: WINKLER_WHY,
    source: PRISM_SOURCE,
    period: '1991–2020 average, April–October',
    popup: (p) => ({
      kicker: Number(p.bin) === 0 ? 'Too cool for wine grapes' : `Winkler ${p.region}`,
      note: 'Average growing season, 1991–2020',
    }),
  },
  gdd_vintage: {
    id: 'gdd_vintage',
    group: 'heat',
    label: 'Vintage heat',
    sub: 'One year vs the 1991–2020 normal',
    icon: '🍇',
    sourceLayer: 'gdd_vintage',
    url: tilesUrl('vintage'),
    colors: ANOM_COLORS,
    edges: ANOM_EDGES,
    format: 'gdd_anom',
    vintage: true,
    keyLabels: ['Cooler', 'Warmer'],
    why: 'How much warmer or cooler one growing season was than the 1991–2020 normal, in growing degree days. Scrub through the years to see cool vintages like 2011 and hot ones like 2015 play out across the state — the same colours as the vintage stripes in each AVA.',
    source: PRISM_SOURCE,
    period: `Each vintage ${VINTAGE_FIRST_YEAR}–${VINTAGE_LAST_YEAR}, April–October`,
    popup: (p, year) => ({ kicker: `${year} vintage heat`, note: 'Compared with the 1991–2020 normal' }),
  },
  gdd_warming: {
    id: 'gdd_warming',
    group: 'heat',
    label: 'Recent warming',
    sub: '2016–2025 vs 1991–2020',
    icon: '📈',
    sourceLayer: 'gdd_warming',
    url: tilesUrl('warming'),
    colors: ANOM_COLORS,
    edges: ANOM_EDGES,
    format: 'gdd_anom',
    keyLabels: ['Cooler', 'Warmer'],
    why: 'The last ten vintages (2016–2025) averaged against the 1991–2020 normal. Nearly everywhere has gained heat; this map shows where the growing season has warmed the most.',
    source: PRISM_SOURCE,
    period: '2016–2025 average minus 1991–2020 average',
    popup: () => ({ kicker: 'Recent warming', note: '2016–2025 average vs 1991–2020' }),
  },
  ppt_annual: {
    id: 'ppt_annual',
    group: 'rain',
    label: 'Annual rainfall',
    sub: 'Inches per year · 1991–2020',
    icon: '🌧️',
    sourceLayer: 'ppt_annual',
    url: tilesUrl('rain-annual'),
    colors: RAIN_COLORS,
    edges: ANNUAL_PPT_EDGES,
    format: 'inches',
    why: 'Total yearly precipitation. The Coast Range wrings most of the Pacific moisture out before it reaches the valley, so the valley floor gets roughly a third of what the coastal ridges do — and almost all of it falls between October and May, leaving a dry growing season.',
    source: PRISM_SOURCE,
    period: '1991–2020 average, January–December',
    popup: () => ({ kicker: 'Annual rainfall', note: 'Average year, 1991–2020' }),
  },
  ppt_harvest: {
    id: 'ppt_harvest',
    group: 'rain',
    label: 'Harvest rain',
    sub: 'September–October · 1991–2020',
    icon: '☔',
    sourceLayer: 'ppt_harvest',
    url: tilesUrl('rain-harvest'),
    colors: RAIN_COLORS,
    edges: HARVEST_PPT_EDGES,
    format: 'inches',
    why: 'Rain during September and October, when grapes are ripening and being picked. Late rain can swell and split berries, dilute flavour and invite rot, so drier harvest windows are prized — this is where the risk is lowest in a typical year.',
    source: PRISM_SOURCE,
    period: '1991–2020 average, September–October',
    popup: () => ({ kicker: 'Harvest rain', note: 'Average September–October, 1991–2020' }),
  },
  ppt_vintage: {
    id: 'ppt_vintage',
    group: 'rain',
    label: 'Vintage harvest rain',
    sub: 'One year vs the 1991–2020 normal',
    icon: '🌦️',
    sourceLayer: 'ppt_vintage',
    url: tilesUrl('rain-vintage'),
    colors: PPT_PCT_COLORS,
    edges: PPT_PCT_EDGES,
    format: 'pct',
    vintage: true,
    keyLabels: ['Drier', 'Wetter'],
    why: 'How wet each harvest (September–October) was compared with the 1991–2020 normal. Scrub through the years to see soaked harvests like 2013 and 2016 against dry ones like 2003 and 2022.',
    source: PRISM_SOURCE,
    period: `Each vintage ${VINTAGE_FIRST_YEAR}–${VINTAGE_LAST_YEAR}, September–October`,
    popup: (p, year) => ({ kicker: `${year} harvest rain`, note: 'Compared with the 1991–2020 normal' }),
  },
};

export const CLIMATE_MAP_GROUPS = [
  { id: 'heat', label: 'Heat' },
  { id: 'rain', label: 'Rain' },
];

export const CLIMATE_MAP_LAYER_IDS = Object.keys(CLIMATE_MAP_LAYERS);
export const isClimateMapLayer = (id) => CLIMATE_MAP_LAYER_IDS.includes(id);
export const isVintageLayer = (id) => !!CLIMATE_MAP_LAYERS[id]?.vintage;

/** MapLibre expression colouring band features by their `bin` index. */
export const binColorExpression = (colors) => [
  'match', ['to-number', ['get', 'bin'], -1],
  ...colors.flatMap((c, i) => [i, c]),
  'rgba(0,0,0,0)',
];

const fmt = (v) => Math.abs(v).toLocaleString();
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(v)}`;

/** Human label for a band, e.g. "2,000–2,250 GDD", "+150 to +250 GDD", "4.5–5.5 in", "125–150% of normal". */
export function bandLabel(layerId, lo, hi) {
  switch (CLIMATE_MAP_LAYERS[layerId]?.format) {
    case 'gdd_anom':
      if (lo == null) return `${fmt(-hi)}+ GDD cooler`;
      if (hi == null) return `${fmt(lo)}+ GDD warmer`;
      if (lo < 0 && hi > 0) return 'Within ±50 GDD of normal';
      return `${signed(lo)} to ${signed(hi)} GDD`;
    case 'inches':
      if (lo == null) return `Under ${fmt(hi)} in`;
      if (hi == null) return `Over ${fmt(lo)} in`;
      return `${fmt(lo)}–${fmt(hi)} in`;
    case 'pct':
      if (lo == null) return `Under ${hi}% of normal`;
      if (hi == null) return `Over ${lo}% of normal`;
      if (lo < 100 && hi > 100) return `Near normal (${lo}–${hi}%)`;
      return `${lo}–${hi}% of normal`;
    default:
      if (lo == null) return `Under ${fmt(hi)} GDD`;
      if (hi == null) return `Over ${fmt(lo)} GDD`;
      return `${fmt(lo)}–${fmt(hi)} GDD`;
  }
}

/** Legend rows for a layer: [{ color, label }], in bin order. */
export function climateLegend(layerId) {
  const cfg = CLIMATE_MAP_LAYERS[layerId];
  if (!cfg) return [];
  const { edges, colors } = cfg;
  return colors.map((color, i) => ({
    color,
    label: cfg.format === 'gdd' && i === 0 ? 'Too cool (under 1,500)' : bandLabel(layerId, i > 0 ? edges[i - 1] : null, i < edges.length ? edges[i] : null),
  }));
}

// Winkler regions as groups of normal-GDD bins (bin index = position in NORMAL_COLORS)
const WINKLER_GROUPS = [
  { label: 'Too cool', bins: [0] },
  { label: 'Region Ia', bins: [1, 2] },
  { label: 'Region Ib', bins: [3, 4] },
  { label: 'Region II', bins: [5, 6] },
  { label: 'Region III', bins: [7] },
  { label: 'Region IV–V', bins: [8] },
];

/**
 * Legend for the filterable legend (components/LegendFilter.jsx):
 * [{ label?, rows: [{ key, color, label }] }]. Heat accumulation groups its
 * 250-GDD bands under Winkler regions; the other layers are one flat list.
 */
export function climateLegendGroups(layerId) {
  const rows = climateLegend(layerId).map((r, i) => ({ key: i, ...r }));
  if (layerId !== 'gdd_normal') return [{ rows }];
  rows[0].label = 'Under 1,500 GDD';
  return WINKLER_GROUPS.map((g) => ({ label: g.label, rows: g.bins.map((b) => rows[b]) }));
}
