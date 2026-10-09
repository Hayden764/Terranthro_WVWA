
// Value tiles on R2 (topo-<layer>.pmtiles, Terrarium raster-dem) built by
// data-pipeline/scripts/build-topo-value-tiles.py --sources statewide from the
// 3m DOGAMI rasters of every Oregon region; the
// map colours them in the browser (see topoClasses.js). `range`/`stats`/`legend`
// below describe the underlying data and feed the older panels.
export const TOPO_TILES_BASE_URL =
  import.meta.env.VITE_TOPO_TILES_BASE_URL
  || 'https://pub-9686f7c1467c4989896000832d9500b0.r2.dev/topography-tiles/OR/statewide';

export const TOPO_LAYER_TYPES = {
  elevation: {
    id: 'elevation',
    label: 'Elevation',
    unit: 'ft',
    colormap: 'terrain',
    description: 'Height above sea level',
    // Statewide: 99.9% of Oregon AVA land lies below ~4,550 ft (peaks reach
    // ~6,500). mean/std are area-weighted over every Oregon AVA's Oregon land
    // (compute-ava-terrain.py, 2026-10-05).
    range: { min: 0, max: 5000 },
    stats: { mean: 1343.8, std: 996.5 },
    legend: {
      // Matches matplotlib 'terrain': blue → cyan → green → tan → grey → white
      colors: ['#333399', '#57A5CC', '#339966', '#B8A06A', '#9E9E9E', '#FFFFFF'],
      labels: ['0ft', '1000ft', '2000ft', '3000ft', '4000ft', '5000ft']
    }
  },
  slope: {
    id: 'slope',
    label: 'Slope',
    unit: '°',
    colormap: 'rdylgn_r',
    description: 'Steepness of terrain',
    range: { min: 0, max: 41 },
    stats: { mean: 9.6, std: 9.7 },   // statewide, as for elevation
    legend: {
      colors: ['#1A9850', '#91CF60', '#D9EF8B', '#FEE08B', '#FC8D59', '#D73027'],
      labels: ['0°', '8°', '16°', '25°', '33°', '41°+']
    }
  },
  aspect: {
    id: 'aspect',
    label: 'Aspect',
    unit: '°',
    colormap: 'hsv',
    description: 'Direction slope faces',
    range: { min: 0, max: 360 },
    stats: null,
    legend: {
      colors: ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000'],
      labels: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N']
    }
  }
};

// The AVA list comes from the region config (all Oregon AVAs, generated from the DB).
export { REGION_AVAS } from './regionConfig';

/**
 * Returns true if topo data is available.
 * The statewide tiles cover every Oregon AVA, so topo is always available.
 */
export const hasTopographyData = () => true;

/** pmtiles:// source URL for a topography layer's value tiles. */
export const getTopoPmtilesUrl = (layerType) => `pmtiles://${new URL(`${TOPO_TILES_BASE_URL}/topo-${layerType}.pmtiles`, window.location.origin).href}`;

/** Static range + stats for the data-range card and legend (no stats request). */
export const getTopoStats = (layerType) => {
  const cfg = TOPO_LAYER_TYPES[layerType];
  if (!cfg) return null;
  return { min: cfg.range.min, max: cfg.range.max, mean: cfg.stats?.mean ?? null, std: cfg.stats?.std ?? null };
};

export const getTopoSourceId = (layerType) => `topo-willamette-valley-${layerType}`;
export const getTopoLayerId  = (layerType) => `topo-willamette-valley-${layerType}-layer`;

export const TOPO_LAYER_OPACITY = 0.65;
