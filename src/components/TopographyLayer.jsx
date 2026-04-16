import { useEffect, useRef } from 'react';
import {
  getTopoTileUrl,
  getTopoStatsUrl,
  getTopoSourceId,
  getTopoLayerId,
  TOPO_LAYER_OPACITY,
} from '../config/topographyConfig';

/**
 * Loads the full Willamette Valley 1m LiDAR topography raster for the active
 * layer type (elevation / slope / aspect).
 *
 * The single WV-wide COG is used regardless of which sub-AVA (if any) is
 * selected. TiTiler statistics are fetched first to rescale the colormap to
 * the actual data range.
 *
 * Reports stats back via onStats({ min, max, mean, std }).
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

    let cancelled = false;
    const statsUrl = getTopoStatsUrl(activeLayer);

    const addTileLayer = (rescale) => {
      if (cancelled || !map) return;

      const tileUrl  = getTopoTileUrl(activeLayer, rescale);
      const sourceId = getTopoSourceId(activeLayer);
      const layerId  = getTopoLayerId(activeLayer);

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
      } catch (e) {
        console.warn(`TopographyLayer: failed to add ${activeLayer}`, e);
      }
    };

    // Fetch WV-level COG stats → rescale colormap to actual data range
    fetch(statsUrl)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        // TiTiler returns { "b1": { min, max, mean, std, ... } }
        const band = json?.b1 ?? Object.values(json ?? {})[0];
        if (band?.min != null && band?.max != null) {
          const { min, max, mean, std } = band;
          onStats?.({ min, max, mean, std });
          addTileLayer(`${min},${max}`);
        } else {
          onStats?.(null);
          removeLayer(activeLayer);
        }
      })
      .catch(() => {
        if (cancelled) return;
        onStats?.(null);
        removeLayer(activeLayer);
      });

    return () => {
      cancelled = true;
      if (!map) return;
      removeLayer(activeLayer);
    };
  }, [map, activeLayer]);

  return null;
};

export default TopographyLayer;
