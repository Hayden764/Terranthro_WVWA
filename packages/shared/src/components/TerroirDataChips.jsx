import { TOKENS } from '../styles/tokens';

const TONE = {
  blue: {
    color: TOKENS.electricBlue,
    glow: TOKENS.glowBlue,
  },
  green: {
    color: TOKENS.vividGreen,
    glow: TOKENS.glowGreen,
  },
  amber: {
    color: TOKENS.amber,
    glow: TOKENS.glowAmber,
  },
  parchment: {
    color: TOKENS.ink,
    glow: 'none',
  },
};

export default function TerroirDataChips({ chips = [], variant = 'light', columns = null }) {
  if (!chips.length) return null;

  const glass = variant === 'glass';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: columns ? `repeat(${columns}, 1fr)` : 'repeat(auto-fit, minmax(128px, 1fr))',
      gap: 8,
    }}>
      {chips.map((chip) => {
        const tone = TONE[chip.tone] || TONE.parchment;
        return (
          <div
            key={chip.label}
            style={{
              // Per terranthro-design-system.html `.chip`.
              // Glass variant sits on a dark dock surface; light variant sits
              // on a parchment panel and matches the vineyard popup look
              // (parchment fill + dark ghost border).
              background: glass ? 'var(--color-surface-raised)' : 'var(--color-parchment)',
              border: glass
                ? '0.5px solid rgba(255, 255, 255, 0.07)'
                : '1px solid var(--color-ghost)',
              borderRadius: 6,
              padding: '8px 12px',
            }}
          >
            <div style={{
              // `.chip-label`: 9px / 0.14em / uppercase / ghost
              fontFamily: 'var(--font-sans)',
              fontSize: 9,
              fontWeight: 500,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: glass ? 'rgba(232, 226, 214, 0.72)' : TOKENS.ink,
              marginBottom: 3,
            }}>
              {chip.label}
            </div>
            <div style={{
              // `.chip-value`: Cormorant Garamond 18px / 500 (non-italic)
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              fontWeight: 500,
              fontStyle: 'normal',
              lineHeight: 1.15,
              // On parchment the accent glow text-shadow muddies the value;
              // glow is only meaningful against the dark glass surface.
              color: glass ? tone.color : TOKENS.ink,
              textShadow: glass && chip.glow ? tone.glow : 'none',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {chip.value || '—'}
            </div>
            {chip.subValue && (
              <div style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 9,
                fontWeight: 400,
                letterSpacing: '0.04em',
                color: glass ? 'rgba(232, 226, 214, 0.5)' : TOKENS.muted,
                marginTop: 4,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {chip.subValue}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}