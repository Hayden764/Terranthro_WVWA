import { TOKENS } from '../styles/tokens';

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** 8-point compass label for a bearing in degrees. */
export function aspectPoint(deg) {
  if (deg == null || !Number.isFinite(Number(deg)) || deg < 0) return null;
  return POINTS[Math.round((((Number(deg) % 360) + 360) % 360) / 45) % 8];
}

/**
 * Summarise which way a vineyard faces from its polygons' main directions.
 * polygons: [{ aspect_deg, acres }]. Returns
 *   { range: 'SE–W', mostly: ['S', 'SW'], count }
 * where `range` spans the tightest arc that holds every polygon and `mostly`
 * is the fewest directions (max 2) covering at least half the acreage.
 */
export function summariseAspect(polygons = []) {
  const ps = polygons.filter((p) => p && p.aspect_deg != null && p.aspect_deg >= 0);
  if (!ps.length) return null;
  const angles = ps.map((p) => ((Number(p.aspect_deg) % 360) + 360) % 360).sort((a, b) => a - b);

  // Tightest arc = everything except the biggest empty gap between polygons
  let gapEnd = 0, gap = -1;
  for (let i = 0; i < angles.length; i++) {
    const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + 360;
    if (next - angles[i] > gap) { gap = next - angles[i]; gapEnd = (i + 1) % angles.length; }
  }
  const start = angles[gapEnd];
  const end = angles[(gapEnd - 1 + angles.length) % angles.length];
  const spread = angles.length > 1 ? 360 - gap : 0;
  const a = aspectPoint(start), b = aspectPoint(end);
  const range = spread >= 270 ? 'All directions' : (a === b ? a : `${a}–${b}`);

  const byPoint = {};
  let total = 0;
  for (const p of ps) {
    const w = Number(p.acres) > 0 ? Number(p.acres) : 1;
    const k = aspectPoint(p.aspect_deg);
    byPoint[k] = (byPoint[k] || 0) + w;
    total += w;
  }
  const ranked = Object.entries(byPoint).sort((x, y) => y[1] - x[1]);
  const mostly = [ranked[0][0]];
  if (ranked[0][1] / total < 0.6 && ranked[1]) mostly.push(ranked[1][0]);

  return { range, mostly, count: ps.length, points: Object.keys(byPoint).length };
}

/**
 * Small compass with one dot per polygon at its main facing direction, sized
 * by acres. With no polygons, a single needle at `fallbackDeg` instead.
 */
export default function AspectCompass({ polygons = [], fallbackDeg = null, size = 64 }) {
  const ps = polygons.filter((p) => p && p.aspect_deg != null && p.aspect_deg >= 0);
  if (!ps.length && (fallbackDeg == null || fallbackDeg < 0)) return null;
  const c = size / 2;
  const R = c - 9;               // dot ring radius, leaves room for N/S/E/W
  const maxAcres = Math.max(...ps.map((p) => Number(p.acres) || 0), 1);
  const at = (deg, r) => {
    const t = (deg * Math.PI) / 180;
    return [c + r * Math.sin(t), c - r * Math.cos(t)];
  };
  // Polygons facing the same way share a spot — nudge repeats inwards
  const seen = {};
  const dots = ps.map((p) => {
    const key = Math.round(p.aspect_deg);
    const n = seen[key] = (seen[key] || 0) + 1;
    const [x, y] = at(p.aspect_deg, R - (n - 1) * 6);
    const r = 2 + 3.5 * Math.sqrt((Number(p.acres) || 0) / maxAcres);
    return { x, y, r, id: p.id ?? `${key}-${n}` };
  });
  const tick = { fontFamily: 'var(--font-sans)', fontSize: 7, fill: TOKENS.muted };
  const summary = summariseAspect(ps);
  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={summary ? `Polygons face ${summary.range}` : `Faces ${aspectPoint(fallbackDeg)}`}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <circle cx={c} cy={c} r={R} fill="none" stroke="rgba(0, 0, 0, 0.18)" strokeWidth="1" />
      <circle cx={c} cy={c} r={R / 2} fill="none" stroke="rgba(0, 0, 0, 0.08)" strokeWidth="1" />
      <text x={c} y={7} textAnchor="middle" style={tick}>N</text>
      <text x={c} y={size - 1} textAnchor="middle" style={tick}>S</text>
      <text x={size - 1} y={c + 2.5} textAnchor="end" style={tick}>E</text>
      <text x={1} y={c + 2.5} style={tick}>W</text>
      {dots.length ? dots.map((d) => (
        <circle key={d.id} cx={d.x} cy={d.y} r={d.r} fill={TOKENS.electricBlue} fillOpacity="0.85" stroke="#fff" strokeWidth="0.75" />
      )) : (() => {
        const [x, y] = at(fallbackDeg, R);
        return <line x1={c} y1={c} x2={x} y2={y} stroke={TOKENS.electricBlue} strokeWidth="2" strokeLinecap="round" />;
      })()}
    </svg>
  );
}
