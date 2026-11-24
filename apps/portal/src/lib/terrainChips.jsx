// Terrain boxes for portal pages, matching the public map's vineyard card:
// elevation and slope as ranges (never averages), aspect as the compass range
// the vineyard's polygons face, with a slope bar and a polygon compass.
import SlopeRangeBar from '@terranthro/shared/components/SlopeRangeBar.jsx';
import AspectCompass, { aspectPoint, summariseAspect } from '@terranthro/shared/components/AspectCompass.jsx';

const num = (v) => (v == null || v === '' ? null : Number(v));
const finite = (xs) => xs.map(num).filter((v) => v != null && Number.isFinite(v));

/** Combine one or more vineyard topo_stats rows into one terrain summary. */
export function combineTopo(rows) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  if (!list.length) return null;
  const min = (k) => { const v = finite(list.map((r) => r[k])); return v.length ? Math.min(...v) : null; };
  const max = (k) => { const v = finite(list.map((r) => r[k])); return v.length ? Math.max(...v) : null; };
  const avg = (k) => { const v = finite(list.map((r) => r[k])); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  return {
    elev_min: min('elevation_min_ft'),
    elev_max: max('elevation_max_ft'),
    slope_p10: min('slope_p10_deg'),
    slope_p90: max('slope_p90_deg'),
    slope_mean: avg('slope_mean_deg'),
    slope_max: max('slope_max_deg'),
    aspect_deg: num(list[0].aspect_dominant_deg),
  };
}

/** Mapped polygons ({ aspect_deg, acres }) from portal block rows (block.topo) or admin rows (aspect_deg). */
export function polygonsFromBlocks(blocks = []) {
  return (blocks || [])
    .filter((b) => b && b.has_geometry !== false)
    .map((b) => ({
      id: b.id,
      acres: num(b.acres),
      aspect_deg: num(b.topo?.aspect_dominant_deg ?? b.aspect_deg),
    }))
    .filter((p) => p.aspect_deg != null && p.aspect_deg >= 0);
}

export function fmtElevRange(min, max) {
  if (min == null || max == null) return null;
  const lo = Math.round(Number(min)), hi = Math.round(Number(max));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return lo === hi ? `${lo.toLocaleString()} ft` : `${lo.toLocaleString()}–${hi.toLocaleString()} ft`;
}

export function fmtSlopeRange(p10, p90) {
  if (p10 == null || p90 == null) return null;
  const lo = Math.round(p10), hi = Math.round(p90);
  return lo === hi ? `${Number(p10).toFixed(1)}–${Number(p90).toFixed(1)}°` : `${lo}–${hi}°`;
}

export function elevationChip(t, { label = 'Elevation', sub = true } = {}) {
  return {
    label,
    value: fmtElevRange(t?.elev_min, t?.elev_max) || '—',
    subValue: sub && t?.elev_min != null ? 'lowest to highest point' : null,
    tone: 'parchment', glow: false,
  };
}

/** Slope box: middle-80% range, with the bar unless `bar: false` (tight layouts). */
export function slopeChip(t, { bar = true } = {}) {
  const has = t?.slope_p10 != null && t?.slope_p90 != null;
  return {
    label: 'Slope',
    value: has ? fmtSlopeRange(t.slope_p10, t.slope_p90) : '—',
    visual: has && bar ? (
      <SlopeRangeBar p10={t.slope_p10} p90={t.slope_p90} mean={t.slope_mean} max={t.slope_max} />
    ) : null,
    subValue: t?.slope_max != null ? `steepest ${Math.round(t.slope_max)}°` : null,
    tone: 'green', glow: true,
  };
}

/** Aspect box: compass range of the polygons, main direction(s), polygon compass. */
export function aspectChip(t, polygons = [], { compass = true, size = 52 } = {}) {
  const facing = summariseAspect(polygons);
  return {
    label: 'Aspect',
    value: facing?.range || aspectPoint(t?.aspect_deg) || '—',
    subValue: !facing ? null
      : facing.points > 1 ? `mostly ${facing.mostly.join(', ')}`
      : facing.count > 1 ? `all ${facing.count} polygons`
      : 'one polygon',
    aside: compass && (polygons.length || t?.aspect_deg != null) ? (
      <AspectCompass polygons={polygons} fallbackDeg={t?.aspect_deg} size={size} />
    ) : null,
    tone: 'blue', glow: true,
  };
}
