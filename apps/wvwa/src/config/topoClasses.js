// Topography classes, custom ranges and the color-relief colouring for the
// value tiles built by data-pipeline/scripts/build-topo-value-tiles.py.
// Each tile pixel stores the value itself (Terrarium-encoded), so the map
// colours it here — stepped bands, with anything outside the current legend
// selection or custom range faded. NODATA / FLAT sentinels match that script.

import { FADED_FILL_OPACITY } from '../lib/legendSelection';

export const TOPO_NODATA_BELOW = -100; // tiles store -500 outside the data
export const ASPECT_FLAT = -50;        // aspect where slope < 3°
const TOP = 100000;                    // open upper end of the last band

const pct = (deg) => Math.round(Math.tan((deg * Math.PI) / 180) * 100);
const fmt = (v) => Math.round(v).toLocaleString();

// Bands: [lo, hi) in the layer's unit. Elevation and slope breaks match the
// "Colour vineyards by" themes in vineyardThemes.js (plus a >1,500 ft band).
const ELEVATION = {
  unit: 'ft',
  domain: [0, 2700],
  step: 10,
  groups: [
    { label: 'Valley floor', bands: [{ lo: -100, hi: 200, color: '#274bb1', label: 'Under 200 ft' }] },
    { label: 'Hillside band', bands: [
      { lo: 200, hi: 400, color: '#0e7ee4', label: '200–400 ft' },
      { lo: 400, hi: 600, color: '#00acc4', label: '400–600 ft' },
      { lo: 600, hi: 800, color: '#0dcf69', label: '600–800 ft' },
      { lo: 800, hi: 1000, color: '#59de78', label: '800–1,000 ft' },
    ] },
    { label: 'Upper slopes', bands: [
      { lo: 1000, hi: 1500, color: '#f0ec91', label: '1,000–1,500 ft' },
      { lo: 1500, hi: TOP, color: '#c9a66b', label: 'Over 1,500 ft' },
    ] },
  ],
  rangeLabel: ([lo, hi]) => `${fmt(lo)}–${fmt(hi)} ft`,
};

const SLOPE = {
  unit: '°',
  domain: [0, 45],
  step: 0.5,
  groups: [
    { label: 'Flat', bands: [{ lo: -100, hi: 3, color: '#097940', label: `0–3° (0–${pct(3)}%)` }] },
    { label: 'Gentle to moderate', bands: [
      { lo: 3, hi: 6, color: '#219c52', label: `3–6° (${pct(3)}–${pct(6)}%)` },
      { lo: 6, hi: 10, color: '#60ba62', label: `6–10° (${pct(6)}–${pct(10)}%)` },
      { lo: 10, hi: 15, color: '#a9da6c', label: `10–15° (${pct(10)}–${pct(15)}%)` },
    ] },
    { label: 'Steep', bands: [
      { lo: 15, hi: 20, color: '#e3f399', label: `15–20° (${pct(15)}–${pct(20)}%)` },
      { lo: 20, hi: TOP, color: '#fdb768', label: `Over 20° (${pct(20)}%+)` },
    ] },
  ],
  rangeLabel: ([lo, hi]) => `${lo}–${hi}° (${pct(lo)}–${pct(hi)}%)`,
};

// Warm (south/south-west, afternoon sun) ↔ cool (north) — not a rainbow.
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compassOf = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const dir = (name, centre, color) => ({ key: name, lo: centre - 22.5, hi: centre + 22.5, color, label: name });
const ASPECT = {
  unit: '°',
  domain: [0, 360],
  step: 5,
  circular: true,
  groups: [
    { label: 'South-facing (warmest)', bands: [dir('SE', 135, '#f6b981'), dir('S', 180, '#d65c24'), dir('SW', 225, '#8a300e')] },
    { label: 'West (afternoon sun)', bands: [dir('W', 270, '#f8dcc0')] },
    { label: 'North-facing (coolest)', bands: [dir('NW', 315, '#7fa6d1'), dir('N', 0, '#1f4479'), dir('NE', 45, '#5b8cc4')] },
    { label: 'East (morning sun)', bands: [dir('E', 90, '#a8c3de')] },
    { label: 'Flat', bands: [{ key: 'Flat', lo: -100, hi: -1, color: '#b9b4aa', label: 'Slope under 3°' }] },
  ],
  rangeLabel: ([from, to]) => `${from}° (${compassOf(from)}) → ${to}° (${compassOf(to)})`,
};

export const TOPO_CLASSES = { elevation: ELEVATION, slope: SLOPE, aspect: ASPECT };
export const isTopoLayer = (id) => id in TOPO_CLASSES;

// Band keys: aspect uses compass names, elevation/slope the band index.
const bandsOf = (layerId) => TOPO_CLASSES[layerId].groups.flatMap((g) => g.bands)
  .map((b, i) => ({ ...b, key: b.key ?? i }));

/** Filterable legend groups (components/LegendFilter.jsx). */
export function topoLegendGroups(layerId) {
  const bands = bandsOf(layerId);
  let i = 0;
  return TOPO_CLASSES[layerId].groups.map((g) => ({
    label: g.label,
    rows: g.bands.map(() => bands[i++]).map(({ key, color, label }) => ({ key, color, label })),
  }));
}

/** Split a band so a wrapped aspect band (N: 337.5 → 22.5) becomes value intervals. */
const intervalsOf = (lo, hi, circular) => {
  if (!circular || lo <= TOPO_NODATA_BELOW) return [[lo, hi]]; // linear layers, and aspect's Flat band
  const a = ((lo % 360) + 360) % 360;
  const b = ((hi % 360) + 360) % 360 || 360;
  return a < b ? [[a, b]] : [[a, 360], [0, b]];
};

/**
 * Intervals of values to show, or null for "show everything".
 * `range` (custom, [lo, hi]; for aspect [from, to] clockwise) wins over classes.
 */
export function topoVisibleIntervals(layerId, selected, range) {
  const cfg = TOPO_CLASSES[layerId];
  if (range) {
    const [lo, hi] = range;
    if (!cfg.circular) return [[lo, hi]];
    return lo <= hi ? [[lo, hi]] : [[lo, 360], [0, hi]];
  }
  if (!selected?.length) return null;
  return bandsOf(layerId).filter((b) => selected.includes(b.key))
    .flatMap((b) => intervalsOf(b.lo, b.hi, cfg.circular));
}

/**
 * `color-relief-color` for a layer: stepped band colours (interpolate with
 * near-duplicate stops = hard steps), values outside `visible` faded, NODATA
 * transparent. `opacity` is the layer's color-relief-opacity, used to make the
 * fade match the other layers' faded fill.
 */
export function topoColorExpression(layerId, visible, opacity) {
  const cfg = TOPO_CLASSES[layerId];
  const segments = bandsOf(layerId).flatMap((b) => intervalsOf(b.lo, b.hi, cfg.circular)
    .map(([lo, hi]) => ({ lo, hi, color: b.color })));
  // Cut bands at the custom-range edges so a range can end mid-band
  const cuts = new Set(segments.flatMap((s) => [s.lo, s.hi]));
  (visible ?? []).forEach(([lo, hi]) => { cuts.add(lo); cuts.add(hi); });
  const points = [...cuts].sort((a, b) => a - b);

  const faded = `rgba(156,151,141,${Math.min(1, FADED_FILL_OPACITY / opacity).toFixed(3)})`;
  const isVisible = (v) => !visible || visible.some(([lo, hi]) => v >= lo && v < hi);
  const stops = [TOPO_NODATA_BELOW - 1000, 'rgba(0,0,0,0)', TOPO_NODATA_BELOW - 0.02, 'rgba(0,0,0,0)'];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const mid = (a + b) / 2;
    const seg = segments.find((s) => mid >= s.lo && mid < s.hi);
    if (!seg || a < TOPO_NODATA_BELOW - 0.01) continue;
    const color = isVisible(mid) ? seg.color : faded;
    stops.push(Math.max(a, TOPO_NODATA_BELOW - 0.01), color, b - 0.01, color);
  }
  return ['interpolate', ['linear'], ['elevation'], ...stops];
}

/** Chip / header text for a custom range. */
export const topoRangeLabel = (layerId, range) => TOPO_CLASSES[layerId].rangeLabel(range);
