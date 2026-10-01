/**
 * Winery site theme. Wineries pick one accent from this curated list — never a
 * free hex — so every winery page stays legible and recognisably the same format.
 * Keys must match SITE_ACCENTS in server/src/services/wineSite.js.
 */
export const SITE_ACCENTS = {
  burgundy:   { label: 'Burgundy',   hex: '#7A1F2B' },
  forest:     { label: 'Forest',     hex: '#2F5D3A' },
  ochre:      { label: 'Ochre',      hex: '#A8741A' },
  slate:      { label: 'Slate',      hex: '#3E4C5E' },
  plum:       { label: 'Plum',       hex: '#5B3A5E' },
  terracotta: { label: 'Terracotta', hex: '#B0543A' },
};

export const DEFAULT_ACCENT = 'burgundy';

export function accentHex(key) {
  return (SITE_ACCENTS[key] || SITE_ACCENTS[DEFAULT_ACCENT]).hex;
}

// Fixed variety → colour mapping so "Pinot Noir" is the same colour on every
// winery's page. Unlisted varieties fall back to a stable hash into OTHER.
const VARIETY_COLORS = {
  'pinot noir':      '#8E3B5A',
  'chardonnay':      '#D9B64A',
  'pinot gris':      '#C98B6B',
  'pinot blanc':     '#E3D48A',
  'riesling':        '#B8C95A',
  'gamay noir':      '#B04A6E',
  'gamay':           '#B04A6E',
  'syrah':           '#5A2E4A',
  'sauvignon blanc': '#9CC06A',
  'gewurztraminer':  '#E0A86A',
  'pinot meunier':   '#7B4B7A',
  'melon de bourgogne': '#CFE08A',
};
const OTHER = ['#6E8BA8', '#A88A6E', '#6EA89A', '#9A6EA8', '#A86E6E'];
export const UNKNOWN_VARIETY_COLOR = '#9AA0A6';

export function varietyColor(variety) {
  if (!variety) return UNKNOWN_VARIETY_COLOR;
  const k = variety.trim().toLowerCase();
  if (VARIETY_COLORS[k]) return VARIETY_COLORS[k];
  let h = 0;
  for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return OTHER[h % OTHER.length];
}

export const ASPECT_LABELS = {
  N: 'North', NE: 'Northeast', E: 'East', SE: 'Southeast',
  S: 'South', SW: 'Southwest', W: 'West', NW: 'Northwest', FLAT: 'Flat',
};
