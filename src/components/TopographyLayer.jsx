import { useEffect, useRef } from 'react';
import {
  getTopoTileUrl,
  getTopoStatsUrl,
  getTopoSourceId,
  getTopoLayerId,
  TOPO_LAYER_OPACITY,
} from '../config/topographyConfig';

/**
 * Loads a topography raster tile for the currently selected sub-AVA only.
 * Fetches per-AVA statistics from TiTiler first so the colormap rescale is
 * relative to that specific AVA's actual data range (not a global range).
 * Reports the fetched stats back via onStats({ min, max, mean, std }).
 */
const TopographyLayer = ({ map, activeLayer, selectedAva, onStats }) => {
  const prevLayerRef = useRef(null);
  const prevAvaRef   = useRef(null);

  useEffect(() => {
    if (!map) return;

    const prev    = prevLayerRef.current;
    const prevAva = prevAvaRef.current;

    const removeLayer = (slug, layerType) => {
      if (!slug || !layerType) return;
      try {
        const lid = getTopoLayerId(slug, layerType);
        const sid = getTopoSourceId(slug, layerType);
        if (map.getLayer(lid)) map.removeLayer(lid);
        if (map.getSource(sid)) map.removeSource(sid);
      } catch (e) { /* ignore */ }
    };

    // Tear down whatever was previously shown
    if (prevAva && prev && (prevAva !== selectedAva || prev !== activeLayer)) {
      removeLayer(prevAva, prev);
      prevLayerRef.current = null;
      prevAvaRef.current   = null;
    }

    if (!activeLayer || !selectedAva) {
      onStats?.(null);
      return;
    }

    let cancelled = false;

    const statsUrl = getTopoStatsUrl(selectedAva, activeLayer);

    const addTileLayer = (rescale) => {
      if (cancelled || !map) return;

      const tileUrl = getTopoTileUrl(selectedAva, activeLayer, rescale);
      if (!tileUrl) return;

      const sourceId = getTopoSourceId(selectedAva, activeLayer);
      const layerId  = getTopoLayerId(selectedAva, activeLayer);

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
        prevAvaRef.current   = selectedAva;
      } catch (e) {
        console.warn(`TopographyLayer: failed to add ${selectedAva}/${activeLayer}`, e);
      }
    };

    // Fetch per-AVA stats → rescale colormap to actual data range
    if (statsUrl) {
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
            addTileLayer(null);
          }
        })
        .catch(() => {
          if (cancelled) return;
          onStats?.(null);
          addTileLayer(null);
        });
    } else {
      onStats?.(null);
      addTileLayer(null);
    }

    return () => {
      cancelled = true;
      if (!map) return;
      removeLayer(selectedAva, activeLayer);
    };
  }, [map, activeLayer, selectedAva]);

  return null;
};

export default TopographyLayer;
