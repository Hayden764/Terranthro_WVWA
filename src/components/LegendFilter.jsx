import { alpha, border, interactive, interactiveSoft, ink, muted, TOKENS } from '../styles/tokens';
import { toggleLegendKeys } from '../lib/legendSelection';

/**
 * Legend whose rows filter the map: tap a row (or a group header, e.g. a
 * Winkler region) to show only that; tap more to add or remove; "Show all"
 * resets. Unselected rows dim to match the faded map.
 *
 *   groups   [{ label?, rows: [{ key, color, label }] }]
 *   selected array of keys; empty = everything shown
 *   variant  'light' (sidebar) | 'glass' (dark right panel)
 */
export default function LegendFilter({ groups, selected = [], onChange, variant = 'light', columns = 1 }) {
  const glass = variant === 'glass';
  const c = {
    text: glass ? alpha(TOKENS.parchment, 0.9) : ink,
    sub: glass ? alpha(TOKENS.parchment, 0.55) : muted,
    hover: glass ? alpha(TOKENS.parchment, 0.08) : alpha(TOKENS.ink, 0.05),
    on: interactiveSoft,
    swatchEdge: glass ? alpha(TOKENS.parchment, 0.15) : border,
  };
  const active = selected.length > 0;
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const toggle = (keys) => onChange?.(toggleLegendKeys(selected, keys));
  const isOn = (key) => !active || selected.includes(key);

  const swatch = (color, on) => (
    <span style={{
      width: 12, height: 12, borderRadius: 3, flexShrink: 0, background: color,
      border: `1px solid ${c.swatchEdge}`, opacity: on ? 1 : 0.35,
    }} />
  );

  const rowButton = ({ key, color, label }, { title, indent = false } = {}) => {
    const on = isOn(key);
    const picked = active && selected.includes(key);
    return (
      <button
        key={key}
        type="button"
        aria-pressed={picked}
        onClick={() => toggle([key])}
        className={`tx-box${picked ? ' is-active' : ''}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, width: '100%',
          minHeight: 30, padding: `3px 6px 3px ${indent ? 20 : 6}px`, borderRadius: 6,
          border: '1px solid transparent', background: picked ? c.on : 'transparent', cursor: 'pointer',
          textAlign: 'left', fontFamily: 'var(--font-sans)',
        }}
      >
        {swatch(color, on)}
        <span className="tx-title" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--type-ui-label-size)', color: on ? c.text : c.sub }}>
          {title ? <><strong style={{ fontWeight: 650 }}>{title}</strong> · {label}</> : label}
        </span>
      </button>
    );
  };

  const groupHeader = (g) => {
    const keys = g.rows.map((r) => r.key);
    const onCount = keys.filter((k) => active && selected.includes(k)).length;
    const anyOn = !active || keys.some((k) => selected.includes(k));
    return (
      <button
        type="button"
        aria-pressed={onCount === keys.length}
        onClick={() => toggle(keys)}
        className={`tx-box${onCount === keys.length && active ? ' is-active' : ''}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, width: '100%', minHeight: 30, padding: '3px 6px',
          borderRadius: 6, border: '1px solid transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)', textAlign: 'left',
          background: onCount === keys.length && active ? c.on : 'transparent',
        }}
      >
        <span style={{ display: 'flex', flexShrink: 0, borderRadius: 3, overflow: 'hidden', border: `1px solid ${c.swatchEdge}`, opacity: anyOn ? 1 : 0.35 }}>
          {g.rows.map((r) => <span key={r.key} style={{ width: 8, height: 12, background: r.color }} />)}
        </span>
        <span className="tx-title" style={{ fontSize: 'var(--type-ui-label-size)', fontWeight: 650, color: anyOn ? c.text : c.sub }}>{g.label}</span>
      </button>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4, minHeight: 18 }}>
        <span style={{ fontSize: 'var(--type-ui-label-size)', color: c.sub }}>
          {active ? `Showing ${selected.length} of ${total}` : 'Tap a class to show only that'}
        </span>
        {active && (
          <button
            type="button"
            onClick={() => onChange?.([])}
            className="tx-link"
            style={{
              border: 'none', background: 'none', padding: '2px 0', cursor: 'pointer', fontFamily: 'var(--font-sans)',
              fontSize: 'var(--type-ui-label-size)', fontWeight: 650, color: glass ? TOKENS.parchment : interactive,
            }}
          >Show all</button>
        )}
      </div>
      {groups.map((g, gi) => {
        if (g.label && g.rows.length === 1) {
          return <div key={g.label}>{rowButton(g.rows[0], { title: g.label })}</div>;
        }
        if (g.label) {
          return (
            <div key={g.label}>
              {groupHeader(g)}
              {g.rows.map((r) => rowButton(r, { indent: true }))}
            </div>
          );
        }
        return (
          <div key={gi} style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: '0 6px' }}>
            {g.rows.map((r) => rowButton(r))}
          </div>
        );
      })}
    </div>
  );
}
