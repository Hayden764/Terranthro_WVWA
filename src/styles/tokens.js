const v = (name) => `var(${name})`;

const toPercent = (value) => {
  const percent = value <= 1 ? value * 100 : value;
  return Number.isInteger(percent) ? percent : Number(percent.toFixed(1));
};

// ─── Design-system tokens ────────────────────────────────────────────────────

export const TOKENS = {
  // Base
  ink:          v('--color-ink'),
  surface:      v('--color-surface'),
  surfaceRaised:v('--color-surface-raised'),
  border:       v('--color-border'),
  parchment:    v('--color-parchment'),
  muted:        v('--color-muted'),
  ghost:        v('--color-ghost'),
  // Accent
  electricBlue: v('--color-electric-blue'),
  vividGreen:   v('--color-vivid-green'),
  crimson:      v('--color-crimson'),
  amber:        v('--color-amber'),
  violet:       v('--color-violet'),
  // Semantic status
  success:      v('--color-success'),
  successDim:   v('--color-success-dim'),
  warning:      v('--color-warning'),
  warningDim:   v('--color-warning-dim'),
  danger:       v('--color-danger'),
  dangerDim:    v('--color-danger-dim'),
  // Glows (for use in boxShadow / textShadow)
  glowBlue:    v('--glow-blue'),
  glowGreen:   v('--glow-green'),
  glowCrimson: v('--glow-crimson'),
  glowAmber:   v('--glow-amber'),
  glowViolet:  v('--glow-violet'),
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

// ─── Legacy BRAND shim (backward-compat, no Proxy/runtime dependency) ────────
// Existing components using BRAND.* continue to work unchanged.
// Migrate component-by-component to TOKENS.* in Phase 2.

export const BRAND = {
  white:      'white',
  brown:      TOKENS.ink,
  brownDark:  TOKENS.ink,
  text:       TOKENS.ink,
  burgundy:   TOKENS.crimson,
  eggshell:   TOKENS.parchment,
  cream:      TOKENS.parchment,
  brownLight: TOKENS.muted,
  textMuted:  TOKENS.muted,
  border:     TOKENS.ghost,
};