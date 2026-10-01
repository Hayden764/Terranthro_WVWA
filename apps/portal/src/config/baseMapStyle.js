/**
 * Satellite basemap shared by the portal map and the public winery site map.
 * The Terranthro MapTiler style when a key is configured, Esri World Imagery otherwise.
 */
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;

export const MAP_STYLE = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/019d98dc-0865-7ac5-a184-a072f37b9509/style.json?key=${MAPTILER_KEY}`
  : {
      version: 8,
      sources: {
        esri: {
          type: 'raster',
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Sources: Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [{ id: 'esri-bg', type: 'raster', source: 'esri' }],
    };
