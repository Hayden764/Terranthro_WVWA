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

export const TYPE = {
  display: {
    fontFamily: FONTS.display,
    fontSize: 68,
  },
  displayMedium: {
    fontFamily: FONTS.display,
    fontSize: 30,
  },
  displayItalic: {
    fontFamily: FONTS.display,
    fontStyle: 'italic',
    fontSize: 22,
  },
  uiLabel: {
    fontFamily: FONTS.sans,
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.2em',
  },
  body: {
    fontFamily: FONTS.sans,
    fontSize: 14,
    fontWeight: 300,
  },
  mono: {
    fontFamily: FONTS.mono,
    fontSize: 13,
  },
};

export const alpha = (color, opacity) => (
  `color-mix(in srgb, ${color} ${toPercent(opacity)}%, transparent)`
);

export const mix = (primary, primaryWeight, secondary) => (
  `color-mix(in srgb, ${primary} ${toPercent(primaryWeight)}%, ${secondary})`
);

// ─── Map surface (opaque parchment card) ─────────────────────────────────────
// Single source of truth for all on-map chrome (controls, badges, hover pills,
// FAB) AND the MapLibre vineyard hover popup. Solid parchment fill + visible
// ghost-gray edge + lifted shadow — reads as a physical card, matching the
// wineries-page left panel and the vineyard popup so every surface that floats
// over the map looks like the same object.
export const MAP_GLASS = {
  bg:           parchment,
  bgStrong:     parchment,
  bgHover:      mix(parchment, 92, ink),     // subtle darken on hover
  bgActive:     crimson,
  border:       ghost,
  borderStrong: alpha(ink, 0.22),
  borderActive: alpha(crimson, 0.55),
  text:         alpha(ink, 0.88),
  textMuted:    alpha(ink, 0.55),
  textFaint:    alpha(ink, 0.35),
  textActive:   parchment,
  // Lifted card shadow — matches .maplibregl-popup-content
  shadow:       `0 8px 32px ${alpha(ink, 0.18)}, 0 2px 8px ${alpha(ink, 0.10)}`,
  radius:       8,
  radiusCard:   10,
  radiusPill:   999,
};
