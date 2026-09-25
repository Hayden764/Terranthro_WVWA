import { useEffect, useRef } from 'react';
import { overlayBeforeId, placeBelowVineyards } from '../lib/mapLayerOrder';
import {
  getTopoPmtilesUrl,
  getTopoStats,
  getTopoSourceId,
  getTopoLayerId,
  TOPO_LAYER_OPACITY,
} from '../config/topographyConfig';
import { topoColorExpression, topoVisibleIntervals } from '../config/topoClasses';

/**
 * Willamette Valley 3m topography (elevation / slope / aspect) from value tiles
 * on R2: each pixel stores the value (Terrarium raster-dem) and a MapLibre
 * `color-relief` layer colours it in stepped bands. A legend selection
 * (`selected` band keys) or a custom `range` fades everything else — a paint
 * update only, no refetch. `resampling: nearest` keeps each pixel's true value
 * (no blended fringes at the data edge or where aspect wraps through north).
 *
 * Reports the layer's fixed range via onStats({ min, max, mean, std }).
 */
/*
 * MapLibre 5.21 bug workaround: color-relief sizes its colour-ramp texture with
 * gl.getParameter(MAX_TEXTURE_SIZE), which returns null once the WebGL context
 * is lost (tab backgrounded on a phone, GPU reset). The ramp-remapping loop
 * then gets a negative step and never ends, freezing the page. Give the layer
 * instance a sane fallback. Remove when fixed upstream.
 */
function guardColorRamp(map, layerId) {
  const styleLayer = map.style?.getLayer?.(layerId);
  const create = styleLayer?._createColorRamp;
  if (typeof create !== 'function' || create.guarded) return;
  const guarded = (maxLength) => create.call(styleLayer, maxLength > 1 ? maxLength : 4096);
  guarded.guarded = true;
  styleLayer._createColorRamp = guarded;
}

const TopographyLayer = ({ map, activeLayer, selected, range, onStats }) => {
  const prevLayerRef = useRef(null);
  const filterRef = useRef({ selected, range });
  filterRef.current = { selected, range };

  const colorFor = (layer, { selected: sel, range: rng }) => (
    topoColorExpression(layer, topoVisibleIntervals(layer, sel, rng), TOPO_LAYER_OPACITY)
  );

  useEffect(() => {
    if (!map) return undefined;

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
      return undefined;
    }

    const sourceId = getTopoSourceId(activeLayer);
    const layerId  = getTopoLayerId(activeLayer);

    removeLayer(activeLayer);
    try {
      map.addSource(sourceId, {
        type: 'raster-dem',
        url: getTopoPmtilesUrl(activeLayer),
        encoding: 'terrarium',
        tileSize: 256,
        attribution: 'DOGAMI lidar',
      });

      map.addLayer({
        id: layerId,
        type: 'color-relief',
        source: sourceId,
        paint: {
          'color-relief-color': colorFor(activeLayer, filterRef.current),
          'color-relief-opacity': TOPO_LAYER_OPACITY,
          resampling: 'nearest',
        },
      }, overlayBeforeId(map));
      guardColorRamp(map, layerId);

      // Vineyard layers may load after this one; keep the relief underneath.
      placeBelowVineyards(map, [layerId]);
      prevLayerRef.current = activeLayer;
      onStats?.(getTopoStats(activeLayer));
    } catch (e) {
      console.warn(`TopographyLayer: failed to add ${activeLayer}`, e);
      onStats?.(null);
    }

    return () => removeLayer(activeLayer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, activeLayer]);

  // Legend selection / custom range changes only swap the colour ramp
  useEffect(() => {
    if (!map || !activeLayer) return;
    const layerId = getTopoLayerId(activeLayer);
    if (!map.getLayer(layerId)) return;
    map.setPaintProperty(layerId, 'color-relief-color', colorFor(activeLayer, { selected, range }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, activeLayer, selected, range]);

  return null;
};

export default TopographyLayer;
