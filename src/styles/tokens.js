const v = (name) => `var(${name})`;

const toPercent = (value) => {
  const percent = value <= 1 ? value * 100 : value;
  return Number.isInteger(percent) ? percent : Number(percent.toFixed(1));
};

// ─── Design-system tokens ────────────────────────────────────────────────────

export const ink = v('--color-ink');
export const surface = v('--color-surface');
export const surfaceRaised = v('--color-surface-raised');
export const border = v('--color-border');
export const parchment = v('--color-parchment');
export const muted = v('--color-muted');
export const ghost = v('--color-ghost');

export const electricBlue = v('--color-electric-blue');
export const vividGreen = v('--color-vivid-green');
export const crimson = v('--color-crimson');
export const amber = v('--color-amber');
export const violet = v('--color-violet');

export const success = v('--color-success');
export const successDim = v('--color-success-dim');
export const warning = v('--color-warning');
export const warningDim = v('--color-warning-dim');
export const danger = v('--color-danger');
export const dangerDim = v('--color-danger-dim');

export const glowBlue = v('--glow-blue');
export const glowGreen = v('--glow-green');
export const glowCrimson = v('--glow-crimson');
export const glowAmber = v('--glow-amber');
export const glowViolet = v('--glow-violet');

export const TOKENS = {
  // Base
  ink,
  surface,
  surfaceRaised,
  border,
  parchment,
  muted,
  ghost,
  // Accent
  electricBlue,
  vividGreen,
  crimson,
  amber,
  violet,
  // Semantic status
  success,
  successDim,
  warning,
  warningDim,
  danger,
  dangerDim,
  // Glows (for use in boxShadow / textShadow)
  glowBlue,
  glowGreen,
  glowCrimson,
  glowAmber,
  glowViolet,
};

export const FONTS = {
  display: v('--font-display'),
  sans:    v('--font-sans'),
  mono:    v('--font-mono'),
};

export const alpha = (color, opacity) => (
  `color-mix(in srgb, ${color} ${toPercent(opacity)}%, transparent)`
);

export const mix = (primary, primaryWeight, secondary) => (
  `color-mix(in srgb, ${primary} ${toPercent(primaryWeight)}%, ${secondary})`
);