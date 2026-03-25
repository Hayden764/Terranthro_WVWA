import { BRAND } from '../../config/brandColors';

/**
 * Glass-morphism design tokens adapted for the WVWA wine palette.
 * Shared across all dock panel components.
 */
export const GLASS = {
  bg:          'rgba(72,55,41,0.82)',       // brown glass
  bgLight:     'rgba(72,55,41,0.60)',
  blur:        'blur(16px)',
  border:      'rgba(250,247,242,0.12)',
  borderLight: 'rgba(250,247,242,0.08)',
  shadow:      '0 8px 32px rgba(46,34,26,0.35), 0 2px 8px rgba(46,34,26,0.2)',
  accent:      BRAND.burgundy,
  accentDim:   'rgba(142,21,55,0.25)',
  text:        BRAND.eggshell,
  textDim:     'rgba(250,247,242,0.55)',
  textMuted:   'rgba(250,247,242,0.35)',
};
