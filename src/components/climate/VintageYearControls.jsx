import { useCallback, useEffect, useRef, useState } from 'react';
import { VINTAGE_FIRST_YEAR, VINTAGE_LAST_YEAR } from '../../config/climateMapConfig';

/**
 * Year stepping + playback for the vintage map layers, shared by the
 * sidebar picker and the on-map key (components/MapKey.jsx).
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
