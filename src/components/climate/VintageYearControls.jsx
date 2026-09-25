import { useCallback, useEffect, useRef, useState } from 'react';
import { alpha, border, crimson, ink, muted, parchment, TOKENS } from '../../styles/tokens';
import { CLIMATE_MAP_LAYERS, VINTAGE_FIRST_YEAR, VINTAGE_LAST_YEAR } from '../../config/climateMapConfig';

/**
 * Year stepping + playback for the vintage map layers, shared by the
 * sidebar picker and the floating on-map control (mobile, where the sidebar
 * sits in a bottom sheet).
 */
export function useVintagePlayback(year, onChange) {
  const [playing, setPlaying] = useState(false);
  const yearRef = useRef(year);
  yearRef.current = year;

  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => {
      const next = yearRef.current >= VINTAGE_LAST_YEAR ? VINTAGE_FIRST_YEAR : yearRef.current + 1;
      onChange?.(next);
      if (next === VINTAGE_LAST_YEAR) setPlaying(false);
    }, 900);
    return () => clearInterval(t);
  }, [playing, onChange]);

  const step = useCallback((d) => {
    setPlaying(false);
    onChange?.(Math.min(VINTAGE_LAST_YEAR, Math.max(VINTAGE_FIRST_YEAR, yearRef.current + d)));
  }, [onChange]);
  const setYear = useCallback((y) => { setPlaying(false); onChange?.(y); }, [onChange]);
  const togglePlay = useCallback(() => {
    if (!playing && yearRef.current >= VINTAGE_LAST_YEAR) onChange?.(VINTAGE_FIRST_YEAR);
    setPlaying((p) => !p);
  }, [playing, onChange]);

  return { playing, step, setYear, togglePlay };
}

/** Year control floated over the map (mobile); the page positions it. */
export function MapVintageYearControl({ layerId, year, onChange }) {
  const cfg = CLIMATE_MAP_LAYERS[layerId];
  const { playing, step, setYear, togglePlay } = useVintagePlayback(year, onChange);
  const btn = {
    width: 40, height: 40, borderRadius: 10, border: `1px solid ${border}`, background: parchment,
    color: ink, cursor: 'pointer', fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, padding: 0, touchAction: 'manipulation',
  };
  return (
    <div
      role="group"
      aria-label="Vintage shown on the map"
      style={{
        width: '100%', boxSizing: 'border-box',
        background: alpha(TOKENS.parchment, 0.96), border: `1px solid ${border}`, borderRadius: 14,
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)', padding: '8px 10px 8px',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" aria-label="Previous vintage" style={btn} onClick={() => step(-1)} disabled={year <= VINTAGE_FIRST_YEAR}>‹</button>
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: muted }}>{cfg?.label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: ink, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{year}</div>
        </div>
        <button type="button" aria-label="Next vintage" style={btn} onClick={() => step(1)} disabled={year >= VINTAGE_LAST_YEAR}>›</button>
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play through every vintage'}
          aria-pressed={playing}
          style={{ ...btn, background: playing ? TOKENS.dangerDim : parchment, color: playing ? crimson : ink, fontSize: 14 }}
          onClick={togglePlay}
        >{playing ? '❚❚' : '▶'}</button>
      </div>
      <input
        type="range" min={VINTAGE_FIRST_YEAR} max={VINTAGE_LAST_YEAR} value={year}
        aria-label="Vintage year"
        onChange={(e) => setYear(Number(e.target.value))}
        style={{ width: '100%', accentColor: crimson, cursor: 'pointer', margin: '6px 0 2px', height: 28 }}
      />
      {/* Compact key — the full legend is in the sheet */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: muted }}>
        <span>{cfg?.keyLabels?.[0]}</span>
        <div style={{ flex: 1, display: 'flex', gap: 1, height: 6 }}>
          {cfg?.colors.map((c) => <span key={c} style={{ flex: 1, background: c, borderRadius: 1 }} />)}
        </div>
        <span>{cfg?.keyLabels?.[1]}</span>
      </div>
      <div style={{ fontSize: 11, color: muted, textAlign: 'center', marginTop: 2 }}>vs 1991–2020 normal</div>
    </div>
  );
}
