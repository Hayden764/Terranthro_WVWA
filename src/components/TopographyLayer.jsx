import { useEffect, useRef } from 'react';
import {
  getTopoPmtilesUrl,
  getTopoStats,
  getTopoSourceId,
  getTopoLayerId,
  TOPO_LAYER_OPACITY,
} from '../config/topographyConfig';

/**
 * Shows the Willamette Valley 3m topography for the active layer type
 * (elevation / slope / aspect) from pre-rendered raster PMTiles on R2 — colours
 * are baked in at build time, so there is no tile server or stats request.
 *
 * Reports the layer's fixed range via onStats({ min, max, mean, std }).
 */
const TopographyLayer = ({ map, activeLayer, onStats }) => {
  const prevLayerRef = useRef(null);

  useEffect(() => {
    if (!map) return;

    const prev = prevLayerRef.current;

    const removeLayer = (layerType) => {
      if (!layerType) return;
      try {
        const lid = getTopoLayerId(layerType);
        const sid = getTopoSourceId(layerType);
        if (map.getLayer(lid)) map.removeLayer(lid);
        if (map.getSource(sid)) map.removeSource(sid);
      } catch (e) { /* ignore */ }
    };

    // Tear down the previous layer if the active layer type changed
    if (prev && prev !== activeLayer) {
      removeLayer(prev);
      prevLayerRef.current = null;
    }

    if (!activeLayer) {
      onStats?.(null);
      return;
    }

    const sourceId = getTopoSourceId(activeLayer);
    const layerId  = getTopoLayerId(activeLayer);

    removeLayer(activeLayer);
    try {
      map.addSource(sourceId, {
        type: 'raster',
        url: getTopoPmtilesUrl(activeLayer),
        tileSize: 256,
        attribution: 'DOGAMI lidar',
      });

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

      prevLayerRef.current = activeLayer;
      onStats?.(getTopoStats(activeLayer));
    } catch (e) {
      console.warn(`TopographyLayer: failed to add ${activeLayer}`, e);
      onStats?.(null);
    }

    return () => {
      if (!map) return;
      removeLayer(activeLayer);
    };
  }, [map, activeLayer]);

  return null;
};

export default TopographyLayer;
