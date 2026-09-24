/**
 * One authority for where raster/vector overlays sit relative to the vineyard
 * polygons: always below them, so vineyards stay visible whatever order the
 * user toggles things in.
 *
 * Overlays choose their insertion point when they are added, so an overlay
 * switched on before the vineyard layers exist would otherwise land on top and
 * hide them. Overlays call placeBelowVineyards() after adding, and WVWAMap
 * calls it again once the vineyard layers are created.
 */

// Bottom-most vineyard layer first: overlays go under whichever exists.
export const VINEYARD_BASE_LAYER_IDS = [
  'vineyards-glow-heat',
  'vineyards-reference-fill',
  'vineyards-reference-passive-fill',
  'vineyards-linked-fill',
];

// Every overlay that must stay under the vineyards (soils/bedrock + topography).
export const OVERLAY_LAYER_IDS = [
  'earth-soils-fill', 'earth-soils-line',
  'earth-geology-fill', 'earth-geology-line',
  'topo-willamette-valley-elevation-layer',
  'topo-willamette-valley-slope-layer',
  'topo-willamette-valley-aspect-layer',
  'prism-climate-layer',
];

/** The id an overlay should be inserted before, or undefined for "on top". */
export function overlayBeforeId(map) {
  if (!map) return undefined;
  for (const id of [...VINEYARD_BASE_LAYER_IDS, 'wv-boundary-line']) {
    try { if (map.getLayer(id)) return id; } catch { /* style reloading */ }
  }
  return undefined;
}

/** Move the given overlay layers (default: all of them) below the vineyards. */
export function placeBelowVineyards(map, layerIds = OVERLAY_LAYER_IDS) {
  if (!map) return;
  const before = overlayBeforeId(map);
  if (!before) return;
  for (const id of layerIds) {
    try {
      if (map.getLayer(id) && id !== before) map.moveLayer(id, before);
    } catch { /* layer went away mid-move */ }
  }
}
