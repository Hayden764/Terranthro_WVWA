import { TOKENS } from '../styles/tokens';

// Slope as a range: a band for the middle 80% of the vineyard (10th–90th
// percentile), a tick at the typical slope and a thin whisker out to the
// steepest point, on a 0° scale that grows in 10° steps (min 20°).
// Plain positioned divs so it stretches to any chip width without distortion.
export default function SlopeRangeBar({ p10, p90, mean = null, max = null }) {
  if (p10 == null || p90 == null) return null;
  const top = Math.max(20, Math.ceil(Math.max(p90, max ?? 0) / 10) * 10);
  const pct = (deg) => `${Math.min(100, Math.max(0, (deg / top) * 100))}%`;
  const label = { position: 'absolute', top: 16, fontFamily: 'var(--font-sans)', fontSize: 9, color: TOKENS.muted };
  return (
    <div
      role="img"
      aria-label={`Slope mostly ${p10.toFixed(1)} to ${p90.toFixed(1)} degrees${max != null ? `, steepest ${Math.round(max)} degrees` : ''}`}
      style={{ position: 'relative', height: 28, marginTop: 6 }}
    >
      {/* track */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 6, height: 3, borderRadius: 2, background: 'rgba(0, 0, 0, 0.08)' }} />
      {/* whisker to the steepest point */}
      {max != null && max > p90 && (
        <>
          <div style={{ position: 'absolute', left: pct(p90), width: `calc(${pct(max)} - ${pct(p90)})`, top: 7, height: 1, background: TOKENS.muted }} />
          <div style={{ position: 'absolute', left: pct(max), top: 4, width: 1, height: 7, background: TOKENS.muted }} />
        </>
      )}
      {/* middle-80% band */}
      <div style={{
        position: 'absolute', left: pct(p10), width: `max(3px, calc(${pct(p90)} - ${pct(p10)}))`,
        top: 3, height: 9, borderRadius: 3, background: TOKENS.vividGreen,
      }} />
      {/* typical slope */}
      {mean != null && (
        <div style={{ position: 'absolute', left: pct(mean), top: 1, width: 2, marginLeft: -1, height: 13, background: TOKENS.ink }} />
      )}
      <span style={{ ...label, left: 0 }}>0°</span>
      <span style={{ ...label, right: 0 }}>{top}°</span>
    </div>
  );
}
