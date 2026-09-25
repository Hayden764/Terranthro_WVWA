// Heat-accumulation climate layers (PMTiles built by
// data-pipeline/scripts/build-climate-tiles.py from PRISM 800m monthly tmean).
// Band edges here must match NORMAL_EDGES / ANOM_EDGES in that script. Features
// carry `bin` (index into the colour arrays), `lo`/`hi` (band edges, null at the
// open ends), `region` (Winkler, normal layer) and `yr` (vintage layer).

import { EARTH_TILES_BASE } from './earthLayersConfig';

// One file per layer (climate-normal / -warming / -vintage.pmtiles)
const tilesUrl = (name) => `${EARTH_TILES_BASE}/climate-${name}.pmtiles`;
export const CLIMATE_MAP_OPACITY = 0.62;

export const VINTAGE_FIRST_YEAR = 1991;
export const VINTAGE_LAST_YEAR = 2025;

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

const WINKLER_WHY = 'Growing degree days (GDD) add up how much warmth the vines get over the season: each day, the degrees the average temperature sits above 50°F, summed April through October. More heat means riper fruit; the Winkler regions group GDD into bands that suit different grapes. Cool-climate Pinot noir and Chardonnay do best in Region Ia–Ib (1,500–2,500 GDD).';

export const CLIMATE_MAP_LAYERS = {
  gdd_normal: {
    id: 'gdd_normal',
    label: 'Heat accumulation',
    sub: 'Growing degree days · 1991–2020',
    icon: '🌡️',
    sourceLayer: 'gdd_normal',
    url: tilesUrl('normal'),
    colors: NORMAL_COLORS,
    edges: NORMAL_EDGES,
    why: WINKLER_WHY,
    source: 'PRISM Climate Group, Oregon State University (800 m monthly)',
    period: '1991–2020 average, April–October',
  },
  gdd_vintage: {
    id: 'gdd_vintage',
    label: 'Vintage heat',
    sub: 'One year vs the 1991–2020 normal',
    icon: '🍇',
    sourceLayer: 'gdd_vintage',
    url: tilesUrl('vintage'),
    colors: ANOM_COLORS,
    edges: ANOM_EDGES,
    diverging: true,
    why: 'How much warmer or cooler one growing season was than the 1991–2020 normal, in growing degree days. Scrub through the years to see cool vintages like 2011 and hot ones like 2015 play out across the state — the same colours as the vintage stripes in each AVA.',
    source: 'PRISM Climate Group, Oregon State University (800 m monthly)',
    period: `Each vintage ${VINTAGE_FIRST_YEAR}–${VINTAGE_LAST_YEAR}, April–October`,
  },
  gdd_warming: {
    id: 'gdd_warming',
    label: 'Recent warming',
    sub: '2016–2025 vs 1991–2020',
    icon: '📈',
    sourceLayer: 'gdd_warming',
    url: tilesUrl('warming'),
    colors: ANOM_COLORS,
    edges: ANOM_EDGES,
    diverging: true,
    why: 'The last ten vintages (2016–2025) averaged against the 1991–2020 normal. Nearly everywhere has gained heat; this map shows where the growing season has warmed the most.',
    source: 'PRISM Climate Group, Oregon State University (800 m monthly)',
    period: '2016–2025 average minus 1991–2020 average',
  },
};

export const CLIMATE_MAP_LAYER_IDS = Object.keys(CLIMATE_MAP_LAYERS);
export const isClimateMapLayer = (id) => CLIMATE_MAP_LAYER_IDS.includes(id);

/** MapLibre expression colouring band features by their `bin` index. */
export const binColorExpression = (colors) => [
  'match', ['to-number', ['get', 'bin'], -1],
  ...colors.flatMap((c, i) => [i, c]),
  'rgba(0,0,0,0)',
];

const fmt = (v) => Math.abs(v).toLocaleString();
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(v)}`;

/** Human label for a band, e.g. "2,000–2,250 GDD" or "+150 to +250 GDD". */
export function bandLabel(layerId, lo, hi) {
  const cfg = CLIMATE_MAP_LAYERS[layerId];
  if (!cfg?.diverging) {
    if (lo == null) return `Under ${fmt(hi)} GDD`;
    if (hi == null) return `Over ${fmt(lo)} GDD`;
    return `${fmt(lo)}–${fmt(hi)} GDD`;
  }
  if (lo == null) return `${fmt(-hi)}+ GDD cooler`;
  if (hi == null) return `${fmt(lo)}+ GDD warmer`;
  if (lo < 0 && hi > 0) return 'Within ±50 GDD of normal';
  return `${signed(lo)} to ${signed(hi)} GDD`;
}

/** Legend rows for a layer: [{ color, label }], in bin order. */
export function climateLegend(layerId) {
  const cfg = CLIMATE_MAP_LAYERS[layerId];
  if (!cfg) return [];
  const { edges, colors } = cfg;
  return colors.map((color, i) => ({
    color,
    label: !cfg.diverging && i === 0 ? 'Too cool (under 1,500)' : bandLabel(layerId, i > 0 ? edges[i - 1] : null, i < edges.length ? edges[i] : null),
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
 * 250-GDD bands under Winkler regions; the anomaly layers are one flat list.
 */
export function climateLegendGroups(layerId) {
  const rows = climateLegend(layerId).map((r, i) => ({ key: i, ...r }));
  if (layerId !== 'gdd_normal') return [{ rows }];
  rows[0].label = 'Under 1,500 GDD';
  return WINKLER_GROUPS.map((g) => ({ label: g.label, rows: g.bins.map((b) => rows[b]) }));
}
