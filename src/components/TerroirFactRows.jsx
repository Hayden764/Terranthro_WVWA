import { TOKENS } from '../styles/tokens';

/**
 * Label/value rows for the text facts on a terroir card — the counterpart to
 * TerroirDataChips (which carries the numbers). Same two components are used on
 * the sidebar vineyard card, the map listing panel and the AVA panel so every
 * surface reads the same: tiles for numbers, rows for words.
 *
 * rows: [{ label, value, swatch?, sub? }] — falsy `value` rows are dropped.
 */
export default function TerroirFactRows({ rows = [], variant = 'light' }) {
  const visible = rows.filter((r) => r && r.value);
  if (!visible.length) return null;

  const glass = variant === 'glass';
  const labelColor = glass ? 'rgba(232, 226, 214, 0.72)' : TOKENS.muted;
  const valueColor = glass ? 'rgba(232, 226, 214, 0.92)' : TOKENS.ink;
  const subColor = glass ? 'rgba(232, 226, 214, 0.5)' : TOKENS.muted;
  const divider = glass ? 'rgba(255, 255, 255, 0.07)' : 'var(--color-ghost)';

  return (
    <div style={{
      background: glass ? 'var(--color-surface-raised)' : 'var(--color-parchment)',
      border: glass ? '0.5px solid rgba(255, 255, 255, 0.07)' : '1px solid var(--color-ghost)',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {visible.map((r, i) => (
        <div
          key={r.label}
          style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
            padding: '7px 12px',
            borderTop: i === 0 ? 'none' : `1px solid ${divider}`,
          }}
        >
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: 9, fontWeight: 500,
            letterSpacing: '0.14em', textTransform: 'uppercase', color: labelColor,
            flexShrink: 0, paddingTop: 2,
          }}>
            {r.label}
          </span>
          <span style={{ textAlign: 'right', minWidth: 0 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'baseline', gap: 6,
              fontFamily: 'var(--font-sans)', fontSize: 'var(--type-mono-size)',
              color: valueColor, lineHeight: 1.4,
            }}>
              {r.swatch && (
                <span style={{ width: 9, height: 9, borderRadius: 2, background: r.swatch, flexShrink: 0, alignSelf: 'center' }} />
              )}
              {r.value}
            </span>
            {r.sub && (
              <div style={{
                fontFamily: 'var(--font-sans)', fontSize: 9, letterSpacing: '0.04em',
                color: subColor, marginTop: 2,
              }}>
                {r.sub}
              </div>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
