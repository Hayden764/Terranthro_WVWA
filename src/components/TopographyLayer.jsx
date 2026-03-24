import { useEffect, useRef } from 'react';
import {
  getTopoTileUrl,
  getTopoSourceId,
  getTopoLayerId,
  TOPO_LAYER_OPACITY,
  WV_SUB_AVAS,
} from '../config/topographyConfig';

/**
 * Loads topography raster tiles for ALL WV sub-AVAs simultaneously.
 * Each sub-AVA gets its own MapLibre source + layer, inserted below
 * the AVA boundary lines so terrain doesn't obscure borders.
 */
const TopographyLayer = ({ map, activeLayer }) => {
  const prevLayerRef = useRef(null);

  useEffect(() => {
    if (!map) return;

    // Remove previous layer type for all AVAs
    const prev = prevLayerRef.current;
    if (prev && prev !== activeLayer) {
      WV_SUB_AVAS.forEach(({ slug }) => {
        try {
          const lid = getTopoLayerId(slug, prev);
          const sid = getTopoSourceId(slug, prev);
          if (map.getLayer(lid)) map.removeLayer(lid);
          if (map.getSource(sid)) map.removeSource(sid);
        } catch (e) { /* ignore */ }
      });
      prevLayerRef.current = null;
    }

    if (!activeLayer) return;

    // Add topo layers for all 8 sub-AVAs
    WV_SUB_AVAS.forEach(({ slug }) => {
      const tileUrl = getTopoTileUrl(slug, activeLayer);
      if (!tileUrl) return;

      const sourceId = getTopoSourceId(slug, activeLayer);
      const layerId  = getTopoLayerId(slug, activeLayer);

      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch (e) { /* ignore */ }

      try {
        map.addSource(sourceId, {
          type: 'raster',
          tiles: [tileUrl],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 18,
        });

        // Insert below AVA boundary lines
        let beforeLayerId;
        if (map.getLayer('wv-boundary-line')) beforeLayerId = 'wv-boundary-line';

        map.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: {
            'raster-opacity': TOPO_LAYER_OPACITY,
            'raster-fade-duration': 300,
          },
        }, beforeLayerId);
      } catch (e) {
        console.warn(`TopographyLayer: failed to add ${slug}/${activeLayer}`, e);
      }
    });

    prevLayerRef.current = activeLayer;

    return () => {
      if (!map) return;
      WV_SUB_AVAS.forEach(({ slug }) => {
        try {
          if (map.getLayer(getTopoLayerId(slug, activeLayer))) map.removeLayer(getTopoLayerId(slug, activeLayer));
          if (map.getSource(getTopoSourceId(slug, activeLayer))) map.removeSource(getTopoSourceId(slug, activeLayer));
        } catch (e) { /* map may be destroyed */ }
      });
    };
  }, [map, activeLayer]);

  return null;
};

export default TopographyLayer;
