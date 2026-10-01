// Titiler and COG server URLs
export const TITILER_URL = 'https://titiler-latest-0cem.onrender.com';
export const COG_SERVER_URL = 'https://pub-9686f7c1467c4989896000832d9500b0.r2.dev';

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export const CLIMATE_LAYER_OPACITY = 0.6;
export const CLIMATE_SOURCE_ID = 'prism-climate';
export const CLIMATE_LAYER_ID  = 'prism-climate-layer';

export const CLIMATE_LAYER_TYPES = {
  tdmean: {
    id: 'tdmean',
    label: 'Mean Temperature',
    unit: '°C',
    colormap: 'plasma',
    prismVar: 'tdmean',
    description: 'Average daily mean temperature',
    hasMonthSlider: true,
    available: true,
  },
};
