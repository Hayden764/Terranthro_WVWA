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

export default function TerroirDataChips({ chips = [], variant = 'light' }) {
  if (!chips.length) return null;

  const glass = variant === 'glass';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))',
      gap: 8,
    }}>
      {chips.map((chip) => {
        const tone = TONE[chip.tone] || TONE.parchment;
        return (
          <div
            key={chip.label}
            style={{
              // Per terranthro-design-system.html `.chip`
              background: 'var(--color-surface-raised)',
              border: `0.5px solid ${glass ? 'rgba(255, 255, 255, 0.07)' : 'var(--color-border)'}`,
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
              color: glass ? 'rgba(232, 226, 214, 0.72)' : TOKENS.ghost,
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
              color: tone.color,
              textShadow: chip.glow ? tone.glow : 'none',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {chip.value || '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}