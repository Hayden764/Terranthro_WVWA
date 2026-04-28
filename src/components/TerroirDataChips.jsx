import { TYPE, TOKENS, alpha } from '../styles/tokens';

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
              background: glass ? alpha(TOKENS.parchment, 0.06) : alpha(TOKENS.ink, 0.03),
              border: glass
                ? `1px solid ${alpha(TOKENS.parchment, 0.12)}`
                : `1px solid ${alpha(TOKENS.ink, 0.12)}`,
              borderRadius: 8,
              padding: '8px 10px',
            }}
          >
            <div style={{
              ...TYPE.uiLabel,
              fontSize: 9,
              color: glass ? alpha(TOKENS.parchment, 0.72) : TOKENS.muted,
              marginBottom: 4,
            }}>
              {chip.label}
            </div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
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