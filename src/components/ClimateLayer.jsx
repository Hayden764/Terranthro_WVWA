import { useEffect, useState, useRef } from 'react';
import {
  CLIMATE_SOURCE_ID,
  CLIMATE_LAYER_ID,
  CLIMATE_LAYER_OPACITY,
  TITILER_URL,
} from '../config/climateConfig';

/**
 * Manages PRISM climate raster tiles on the MapLibre map via Titiler.
 * Uses the national COG — no per-AVA clipping needed.
 */
const ClimateLayer = ({
  map,
  prismVar = 'tdmean',
  colormap = 'plasma',
  isVisible = false,
  currentMonth = 1,
  rescale = null
}) => {
  const [isSourceAdded, setIsSourceAdded] = useState(false);
  const mapRef = useRef(map);

  useEffect(() => { mapRef.current = map; }, [map]);

  useEffect(() => {
    if (!map) return;

    const addLayer = async () => {
      if (!map || !map.getStyle || !map.getStyle()) return;

      try {
        if (map.getLayer(CLIMATE_LAYER_ID)) map.removeLayer(CLIMATE_LAYER_ID);
        if (map.getSource(CLIMATE_SOURCE_ID)) map.removeSource(CLIMATE_SOURCE_ID);
      } catch (e) { /* ignore */ }

      const monthStr = String(currentMonth).padStart(2, '0');
      const cogUrl = `https://cogs.terranthro.com/climate-data/national/prism_${prismVar}_us_30s_2020${monthStr}_avg_30y_cog.tif`;
      const encodedUrl = encodeURIComponent(cogUrl);
      const rescaleParam = rescale ? rescale : '-22,26';
      const tileUrl = `${TITILER_URL}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodedUrl}&rescale=${rescaleParam}&colormap_name=${colormap}`;
      const statsUrl = `${TITILER_URL}/cog/statistics?url=${encodedUrl}`;

      try {
        const statsRes = await fetch(statsUrl);
        if (!statsRes.ok) {
          setIsSourceAdded(false);
          return;
        }
      } catch {
        setIsSourceAdded(false);
        return;
      }

      try {
        map.addSource(CLIMATE_SOURCE_ID, {
          type: 'raster',
          tiles: [tileUrl],
          tileSize: 256,
          attribution: 'PRISM Climate Data'
        });

        // Insert below AVA boundary layers if they exist
        let beforeLayerId;
        if (map.getLayer('wv-boundary-line')) beforeLayerId = 'wv-boundary-line';

        map.addLayer({
          id: CLIMATE_LAYER_ID,
          type: 'raster',
          source: CLIMATE_SOURCE_ID,
          paint: {
            'raster-opacity': isVisible ? CLIMATE_LAYER_OPACITY : 0,
            'raster-fade-duration': 300
          }
        }, beforeLayerId);

        setIsSourceAdded(true);
      } catch (error) {
        console.error('ClimateLayer: error adding layer', error);
      }
    };

    const timeoutId = setTimeout(() => {
      if (map.loaded && map.loaded()) {
        addLayer();
      } else {
        map.once('load', addLayer);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [map, prismVar, colormap, currentMonth, isVisible, rescale]);

  useEffect(() => {
    if (!map || !isSourceAdded) return;
    try {
      if (map.getStyle && map.getStyle() && map.getLayer(CLIMATE_LAYER_ID)) {
        map.setPaintProperty(CLIMATE_LAYER_ID, 'raster-opacity', isVisible ? CLIMATE_LAYER_OPACITY : 0);
      }
    } catch (e) { /* map removed */ }
  }, [map, isVisible, isSourceAdded]);

  return null;
};

export default ClimateLayer;
