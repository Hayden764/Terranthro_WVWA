import { TERROIR_CLASS_COLORS, UNCLASSIFIED_COLOR } from './earthLayersConfig';
import { TOPO_CLASSES } from './topoClasses';

/**
 * "Colour vineyards by" themes for the reference vineyard layer.
 *
 * `ownership` is the default and paints nothing of its own — it is the existing
 * member-graph / grey / white styling. Every other theme paints one extra fill
 * layer from attributes carried on the vineyard MVT tiles
 * (GET /api/vineyards/tiles/:z/:x/:y), leaving hover, selection, highlight and
 * click behaviour untouched.
 */

export const VINEYARD_THEME_OPACITY = 0.8;
export const NO_DATA_COLOR = UNCLASSIFIED_COLOR;

// Terrain themes sample the SAME colour ramps and value ranges as the
// topography raster layers (topographyConfig / build-topo-tiles.py), at each
// bin's midpoint — so a 300 ft vineyard reads the same colour as 300 ft on the
// elevation basemap. Regenerate with matplotlib if those ranges ever change.
// terrain, 0–2650 ft at 100/300/500/700/900/1400
const ELEV = ['#274bb1', '#0e7ee4', '#00acc4', '#0dcf69', '#59de78', '#f0ec91'];
// RdYlGn_r, 0–41° at 1.5/4.5/8/12.5/17.5/28
const SLOPE = ['#097940', '#219c52', '#60ba62', '#a9da6c', '#e3f399', '#fdb768'];
// Warm (south) ↔ cool (north), taken from the Aspect layer's classes so a
// block and the ground around it read the same colour. Compass order for the legend.
const ASPECT_BANDS = TOPO_CLASSES.aspect.groups.flatMap((g) => g.bands);
const ASPECT = Object.fromEntries(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  .map((dir) => [dir, ASPECT_BANDS.find((b) => b.key === dir).color]));

const catExpression = (field, colors) => [
  'match', ['coalesce', ['get', field], ''],
  ...Object.entries(colors).flat(),
  NO_DATA_COLOR,
];

// Missing values coalesce to -9999 and keep the no-data colour; everything at
// or above -9998 falls into the real bands (colors needs breaks.length + 1).
const stepExpression = (field, breaks, colors) => {
  const expr = ['step', ['coalesce', ['to-number', ['get', field]], -9999], NO_DATA_COLOR, -9998, colors[0]];
  breaks.forEach((b, i) => expr.push(b, colors[i + 1]));
  return expr;
};

const rangeLegend = (breaks, colors, unit, lastSuffix = '+') => colors.map((color, i) => ({
  color,
  label: i === 0 ? `< ${breaks[0]}${unit}`
    : i === colors.length - 1 ? `${breaks[i - 1]}${unit}${lastSuffix}`
    : `${breaks[i - 1]}–${breaks[i]}${unit}`,
}));

const ELEV_BREAKS = [200, 400, 600, 800, 1000];  // ft, 6 bins
const SLOPE_BREAKS = [3, 6, 10, 15, 20];

export const VINEYARD_THEMES = {
  ownership: {
    id: 'ownership',
    label: 'Ownership (default)',
    description: 'Member wineries in their own colours, others grey',
    paint: null,
    legend: null,
  },
  none: {
    id: 'none',
    label: 'None',
    description: 'Every vineyard in one neutral colour — no classification',
    // A constant, not an attribute: shapes only, nothing to read into the colour
    paint: '#E6DCC3',
    legend: null,
  },
  soil: {
    id: 'soil',
    label: 'Soil origin',
    description: 'What the vineyard soil formed from — USDA SSURGO',
    paint: catExpression('soil_class', TERROIR_CLASS_COLORS),
    legend: Object.entries(TERROIR_CLASS_COLORS).map(([label, color]) => ({ label, color })),
    legendKey: 'soil_class',
  },
  bedrock: {
    id: 'bedrock',
    label: 'Bedrock',
    description: 'Rock beneath the soil — DOGAMI OGDC-8',
    paint: catExpression('bedrock_class', TERROIR_CLASS_COLORS),
    legend: Object.entries(TERROIR_CLASS_COLORS).map(([label, color]) => ({ label, color })),
    legendKey: 'bedrock_class',
  },
  elevation: {
    id: 'elevation',
    label: 'Elevation',
    description: 'Mean elevation per block — same ramp as the Elevation layer',
    paint: stepExpression('elev_ft', ELEV_BREAKS, ELEV),
    legend: rangeLegend(ELEV_BREAKS, ELEV, ' ft'),
    legendKey: 'elev_ft',
  },
  slope: {
    id: 'slope',
    label: 'Slope',
    description: 'Mean steepness per block — same ramp as the Slope layer',
    paint: stepExpression('slope_deg', SLOPE_BREAKS, SLOPE),
    legend: rangeLegend(SLOPE_BREAKS, SLOPE, '°'),
    legendKey: 'slope_deg',
  },
  aspect: {
    id: 'aspect',
    label: 'Aspect',
    description: 'Direction each block faces — same warm/cool colours as the Aspect layer',
    paint: catExpression('aspect', ASPECT),
    legend: Object.entries(ASPECT).map(([label, color]) => ({ label, color })),
  },
};

export const VINEYARD_THEME_IDS = Object.keys(VINEYARD_THEMES);
export const isVineyardTheme = (id) => id && id !== 'ownership' && VINEYARD_THEME_IDS.includes(id);
