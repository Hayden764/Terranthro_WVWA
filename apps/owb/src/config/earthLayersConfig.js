// Soils + bedrock geology vector layers (PMTiles built by
// data-pipeline/scripts/build-soil-geology-tiles.py). Features carry a `cls`
// property from data-pipeline/scripts/terroir_classes.py — keep class names in sync.

// Hosted on R2 (bucket terranthro-cogs, prefix earth/). Set
// VITE_EARTH_TILES_BASE_URL=/tiles to use local copies in public/tiles/
// (written there by the build script with --public).
export const EARTH_TILES_BASE =
  import.meta.env.VITE_EARTH_TILES_BASE_URL
  || 'https://pub-9686f7c1467c4989896000832d9500b0.r2.dev/earth';

export const EARTH_LAYER_OPACITY = 0.62;

// Earthy categorical palette: volcanic reds, marine blue-greens, flood blues,
// loess gold. Shared by both layers so "Volcanic" reads the same in soil and rock.
export const TERROIR_CLASS_COLORS = {
  'Volcanic':                     '#A2432E',
  'Volcaniclastic':               '#D08A68',
  'Mixed volcanic & sedimentary': '#9A7196',
  'Marine sedimentary':           '#2F7D86',
  'Sedimentary':                  '#76AEB0',
  'Loess':                        '#E0BE55',
  'Missoula Flood':               '#5F83C4',
  'Alluvial':                     '#8DB57C',
  'Landslide & colluvium':        '#B4987A',
  'Glacial':                      '#B9D3DE',
  'Granitic':                     '#D593B2',
  'Metamorphic':                  '#6F5F4E',
  'Ultramafic':                   '#3F6E48',
  'Organic':                      '#3A3A2C',
};
export const UNCLASSIFIED_COLOR = '#A6A29A';

export const EARTH_LAYER_TYPES = {
  soils: {
    id: 'soils',
    label: 'Soils',
    icon: '🟫',
    description: 'Soil series by origin',
    sourceLayer: 'soils',
    url: `${EARTH_TILES_BASE}/soils.pmtiles`,
    attribution: 'USDA NRCS SSURGO',
    why: 'The soil a vine actually roots in. Each map unit is colored by what its dominant soil formed from: red Jory-type soils weathered from basalt, Willakenzie-type soils from ancient seabed sandstones and siltstones, windblown Laurelwood loess, and Missoula Flood silts on the valley floor. Click the map for the soil series, texture, drainage and depth to bedrock.',
    source: 'USDA NRCS Soil Survey Geographic Database (SSURGO)',
    period: 'Current survey releases (2025–2026)',
    classes: ['Volcanic', 'Volcaniclastic', 'Mixed volcanic & sedimentary', 'Sedimentary',
              'Loess', 'Missoula Flood', 'Alluvial', 'Granitic', 'Metamorphic', 'Ultramafic', 'Organic'],
  },
  geology: {
    id: 'geology',
    label: 'Bedrock',
    icon: '🪨',
    description: 'Geologic map units by rock type',
    sourceLayer: 'geology',
    url: `${EARTH_TILES_BASE}/geology.pmtiles`,
    attribution: 'DOGAMI OGDC-8',
    why: 'The rock beneath the soil. Columbia River Basalt flows, Eocene marine formations (Yamhill, Spencer, Keasey), Ice Age flood deposits and old landslides shape drainage, rooting depth and the character of the soils above them. Click the map for the formation, age and lithology.',
    source: 'Oregon Dept. of Geology and Mineral Industries — Oregon Geologic Data Compilation, release 8',
    period: 'Static geologic mapping',
    classes: ['Volcanic', 'Volcaniclastic', 'Marine sedimentary', 'Sedimentary', 'Missoula Flood',
              'Loess', 'Alluvial', 'Landslide & colluvium', 'Glacial', 'Granitic', 'Metamorphic', 'Ultramafic'],
  },
};

export const EARTH_LAYER_IDS = Object.keys(EARTH_LAYER_TYPES);
export const isEarthLayer = (id) => EARTH_LAYER_IDS.includes(id);

/** MapLibre `match` expression colouring features by their `cls` property. */
export const terroirClassColorExpression = () => [
  'match', ['coalesce', ['get', 'cls'], ''],
  ...Object.entries(TERROIR_CLASS_COLORS).flat(),
  UNCLASSIFIED_COLOR,
];

/** Legend for the filterable legend: one flat group keyed by `cls`. */
export const earthLegendGroups = (layerId) => [{
  rows: (EARTH_LAYER_TYPES[layerId]?.classes ?? []).map((cls) => ({ key: cls, color: TERROIR_CLASS_COLORS[cls], label: cls })),
}];
