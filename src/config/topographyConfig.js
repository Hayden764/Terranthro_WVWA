import { TOKENS } from '../styles/tokens';

// Value tiles on R2 (topo-<layer>.pmtiles, Terrarium raster-dem) built by
// data-pipeline/scripts/build-topo-value-tiles.py from the 3m DOGAMI COGs; the
// map colours them in the browser (see topoClasses.js). `range`/`stats`/`legend`
// below describe the underlying data and feed the older panels.
export const TOPO_TILES_BASE_URL =
  import.meta.env.VITE_TOPO_TILES_BASE_URL
  || 'https://pub-9686f7c1467c4989896000832d9500b0.r2.dev/topography-tiles/OR/willamette_valley';

export const TOPO_LAYER_TYPES = {
  elevation: {
    id: 'elevation',
    label: 'Elevation',
    unit: 'ft',
    colormap: 'terrain',
    description: 'Height above sea level',
    // Baked colour range; mean/std are the valley-wide COG statistics
    range: { min: 0, max: 2650 },
    stats: { mean: 497.3, std: 334.5 },
    legend: {
      // Matches matplotlib 'terrain': blue → cyan → green → tan → grey → white
      colors: ['#333399', '#57A5CC', '#339966', '#B8A06A', '#9E9E9E', '#FFFFFF'],
      labels: ['0ft', '530ft', '1060ft', '1590ft', '2120ft', '2650ft']
    }
  },
  slope: {
    id: 'slope',
    label: 'Slope',
    unit: '°',
    colormap: 'rdylgn_r',
    description: 'Steepness of terrain',
    range: { min: 0, max: 41 },
    stats: { mean: 6.9, std: 6.6 },
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

// Retained for reference only (no longer used as topo sources)
export const WV_SUB_AVAS = [
  { slug: 'chehalem-mountains',       name: 'Chehalem Mountains',       file: '/data/chehalem_mountains.geojson',       color: TOKENS.amber,
    subAvas: ['ribbon-ridge', 'laurelwood-district'] },
  { slug: 'laurelwood-district',      name: 'Laurelwood District',      file: '/data/laurelwood_district.geojson',      color: TOKENS.amber,
    parentAva: 'chehalem-mountains' },
  { slug: 'ribbon-ridge',             name: 'Ribbon Ridge',             file: '/data/ribbon_ridge.geojson',             color: TOKENS.amber,
    parentAva: 'chehalem-mountains' },
  { slug: 'dundee-hills',             name: 'Dundee Hills',             file: '/data/dundee_hills.geojson',             color: TOKENS.amber },
  { slug: 'eola-amity-hills',         name: 'Eola-Amity Hills',         file: '/data/eola_amity_hills.geojson',         color: TOKENS.amber },
  { slug: 'lower-long-tom',           name: 'Lower Long Tom',           file: '/data/lower_long_tom.geojson',           color: TOKENS.amber },
  { slug: 'mcminnville',              name: 'McMinnville',               file: '/data/mcminnville.geojson',              color: TOKENS.amber },
  { slug: 'mount-pisgah-polk-county', name: 'Mount Pisgah/Polk County', file: '/data/mount_pisgah_polk_county.geojson', color: TOKENS.amber },
  { slug: 'tualatin-hills',           name: 'Tualatin Hills',           file: '/data/tualatin_hills.geojson',           color: TOKENS.amber },
  { slug: 'van-duzer-corridor',       name: 'Van Duzer Corridor',       file: '/data/van_duzer_corridor.geojson',       color: TOKENS.amber },
  { slug: 'yamhill-carlton',          name: 'Yamhill-Carlton',          file: '/data/yamhill_carlton.geojson',          color: TOKENS.amber },
];

/**
 * Returns true if topo data is available.
 * The valley-wide tiles cover every AVA, so topo is always available.
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
