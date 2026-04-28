import { TOKENS, alpha } from './tokens';

export const GLASS_CARD = {
  background: 'rgba(255, 255, 255, 0.025)',
  border: '0.5px solid rgba(255, 255, 255, 0.07)',
  borderRadius: 10,
};

// Per terranthro-design-system.html `.btn`:
// Inter 10px / 500 / 0.16em tracked / uppercase, 10px·22px padding,
// 6px radius, transition box-shadow 0.2s, no border on base.
const BUTTON_BASE = {
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  padding: '10px 22px',
  transition: 'box-shadow 0.2s ease',
};

const BUTTON_VARIANTS = {
  primary: {
    background: TOKENS.electricBlue,
    color: TOKENS.ink,
  },
  ghost: {
    background: 'transparent',
    border: `0.5px solid ${TOKENS.electricBlue}`,
    color: TOKENS.electricBlue,
  },
  danger: {
    background: 'transparent',
    border: `0.5px solid ${TOKENS.crimson}`,
    color: TOKENS.crimson,
  },
};

export function btn(variant = 'primary', overrides = {}) {
  return {
    ...BUTTON_BASE,
    ...(BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary),
    ...overrides,
  };
}

export function panelCard(overrides = {}) {
  return {
    ...GLASS_CARD,
    padding: '12px 14px',
    marginBottom: 8,
    ...overrides,
  };
}

// Per terranthro-design-system.html `.input-preview`:
// surface bg, 0.5px border, 6px radius, 10px·14px padding,
// Inter 13px/300, parchment text, focus changes border-color to electric-blue.
export const INPUT_STYLE = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 6,
  border: `0.5px solid ${TOKENS.border}`,
  fontSize: 13,
  fontWeight: 300,
  color: TOKENS.parchment,
  background: TOKENS.surface,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'var(--font-sans)',
  transition: 'border-color 0.2s ease',
};

// Retained for legacy callers; spec-aligned focus uses border-color only via .ds-input.
export const INPUT_FOCUS_RING = `0 0 0 2px ${alpha(TOKENS.electricBlue, 0.2)}`;
