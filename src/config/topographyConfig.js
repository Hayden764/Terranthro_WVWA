import { TITILER_URL } from './climateConfig';

export const TOPO_COG_BASE_URL = 'https://pub-9686f7c1467c4989896000832d9500b0.r2.dev';

export const TOPO_LAYER_TYPES = {
  elevation: {
    id: 'elevation',
    label: 'Elevation',
    unit: 'm',
    colormap: 'terrain',
    description: 'Height above sea level',
    legend: {
      colors: ['#0B6623', '#90EE90', '#F5F5DC', '#D2B48C', '#8B4513', '#FFFFFF'],
      labels: ['0m', '200m', '500m', '1000m', '2000m', '3000m+']
    }
  },
  slope: {
    id: 'slope',
    label: 'Slope',
    unit: '°',
    colormap: 'rdylgn_r',
    description: 'Steepness of terrain',
    legend: {
      colors: ['#1A9850', '#91CF60', '#D9EF8B', '#FEE08B', '#FC8D59', '#D73027'],
      labels: ['0°', '5°', '10°', '20°', '35°', '45°+']
    }
  },
  aspect: {
    id: 'aspect',
    label: 'Aspect',
    unit: '°',
    colormap: 'hsv',
    description: 'Direction slope faces',
    legend: {
      colors: ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000'],
      labels: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N']
    }
  }
};

// Willamette Valley sub-AVAs only
export const AVA_TOPO_REGISTRY = {
  'chehalem-mountains':  { state: 'OR', folder: 'chehalem_mountains' },
  'dundee-hills':        { state: 'OR', folder: 'dundee_hills' },
  'eola-amity-hills':    { state: 'OR', folder: 'eola_amity_hills' },
  'laurelwood-district': { state: 'OR', folder: 'laurelwood_district' },
  'mcminnville':         { state: 'OR', folder: 'mcminnville' },
  'ribbon-ridge':        { state: 'OR', folder: 'ribbon_ridge' },
  'tualatin-hills':      { state: 'OR', folder: 'tualatin_hills' },
  'yamhill-carlton':     { state: 'OR', folder: 'yamhill_carlton' },
};

export const WV_SUB_AVAS = [
  { slug: 'chehalem-mountains',  name: 'Chehalem Mountains',  file: '/data/chehalem_mountains.geojson',  color: '#2D6A4F' },
  { slug: 'dundee-hills',        name: 'Dundee Hills',        file: '/data/dundee_hills.geojson',        color: '#8B1A1A' },
  { slug: 'eola-amity-hills',    name: 'Eola-Amity Hills',    file: '/data/eola_amity_hills.geojson',    color: '#6B4226' },
  { slug: 'laurelwood-district', name: 'Laurelwood District', file: '/data/laurelwood_district.geojson', color: '#7B5E7B' },
  { slug: 'mcminnville',         name: 'McMinnville',         file: '/data/mcminnville.geojson',         color: '#4B7B9E' },
  { slug: 'ribbon-ridge',        name: 'Ribbon Ridge',        file: '/data/ribbon_ridge.geojson',        color: '#9E6B2A' },
  { slug: 'tualatin-hills',      name: 'Tualatin Hills',      file: '/data/tualatin_hills.geojson',      color: '#3A7D44' },
  { slug: 'yamhill-carlton',     name: 'Yamhill-Carlton',     file: '/data/yamhill_carlton.geojson',     color: '#8B6914' },
];

export const hasTopographyData = (avaSlug) => avaSlug in AVA_TOPO_REGISTRY;

export const getTopoCogUrl = (avaSlug, layerType) => {
  const entry = AVA_TOPO_REGISTRY[avaSlug];
  if (!entry) return null;
  return `${TOPO_COG_BASE_URL}/topography-data/${entry.state}/${entry.folder}/${layerType}.tif`;
};

export const getTopoTileUrl = (avaSlug, layerType, rescale = null) => {
  const cogUrl = getTopoCogUrl(avaSlug, layerType);
  if (!cogUrl) return null;
  const config = TOPO_LAYER_TYPES[layerType];
  const encodedUrl = encodeURIComponent(cogUrl);
  const rescaleParam = rescale ? `&rescale=${rescale}` : '';
  return `${TITILER_URL}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodedUrl}${rescaleParam}&colormap_name=${config.colormap}`;
};

export const getTopoSourceId = (avaSlug, layerType) => `topo-${avaSlug}-${layerType}`;
export const getTopoLayerId  = (avaSlug, layerType) => `topo-${avaSlug}-${layerType}-layer`;

export const TOPO_LAYER_OPACITY = 0.65;
