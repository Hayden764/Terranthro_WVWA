import { border, interactive, ink, muted, parchment } from '../styles/tokens';
import { TOPO_CLASSES, topoRangeLabel } from '../config/topoClasses';

// Where a new custom range starts: the hillside band, gentle-to-moderate
// slopes, south-facing.
const STARTING_RANGE = { elevation: [200, 1000], slope: [3, 15], aspect: [135, 225] };

/**
 * Custom min–max range for a topography layer (aspect: from → to, clockwise,
 * so a range can wrap through north). Two plain sliders rather than one
 * two-thumb slider — both are easy to grab on a phone.
 */
export default function TopoRangeControl({ layerId, range, onChange }) {
  const cfg = TOPO_CLASSES[layerId];
  if (!cfg) return null;
  const [min, max] = cfg.domain;
  const [lo, hi] = range ?? [];
  const names = cfg.circular ? ['From', 'To'] : ['Min', 'Max'];

  const set = (i, v) => {
    const next = [lo, hi];
    next[i] = v;
    // Linear layers keep min ≤ max by moving the other end along
    if (!cfg.circular && next[0] > next[1]) next[i === 0 ? 1 : 0] = v;
    onChange?.(next);
  };

  if (!range) {
    return (
      <button
        type="button"
        onClick={() => onChange?.(STARTING_RANGE[layerId])}
        className="tx-box tx-link"
        style={{
          width: '100%', minHeight: 34, padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
          border: `1px dashed ${border}`, background: 'transparent', color: ink, textAlign: 'left',
          fontFamily: 'var(--font-sans)', fontSize: 'var(--type-ui-label-size)', fontWeight: 600,
        }}
      >
        + Custom range…
      </button>
    );
  }

  const slider = (i) => (
    <label key={i} style={{ display: 'block', marginTop: 4 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--type-ui-label-size)', color: muted }}>
        <span>{names[i]}</span>
        <span style={{ color: ink, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
          {[lo, hi][i].toLocaleString()}{cfg.unit}
        </span>
      </span>
      <input
        type="range" min={min} max={max} step={cfg.step} value={[lo, hi][i]}
        aria-label={`${names[i]} ${cfg.unit === 'ft' ? 'elevation' : layerId}`}
        onChange={(e) => set(i, Number(e.target.value))}
        style={{ width: '100%', accentColor: interactive, cursor: 'pointer', height: 26, margin: 0 }}
      />
    </label>
  );

  return (
    <div style={{ border: `1px solid ${interactive}`, borderRadius: 8, padding: '8px 10px', background: parchment }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 'var(--type-ui-label-size)', color: ink, fontWeight: 650 }}>
          Showing {topoRangeLabel(layerId, range)}
        </span>
        <button
          type="button"
          onClick={() => onChange?.(null)}
          className="tx-link"
          style={{
            border: 'none', background: 'none', padding: '2px 0', cursor: 'pointer', fontFamily: 'var(--font-sans)',
            fontSize: 'var(--type-ui-label-size)', fontWeight: 650, color: interactive, flexShrink: 0,
          }}
        >Clear</button>
      </div>
      {slider(0)}
      {slider(1)}
      {cfg.circular && (
        <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 4 }}>
          Clockwise from “From” to “To” — e.g. 300° → 60° covers NW through NE. Flat ground is excluded.
        </div>
      )}
    </div>
  );
}
