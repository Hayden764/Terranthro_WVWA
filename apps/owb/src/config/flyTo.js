/**
 * flyTo.js
 *
 * All map navigation / animation helpers in one place.
 *
 * Design rules:
 *  - Every exported function is pure: it accepts a `map` instance (MapLibre GL)
 *    plus its own parameters and returns nothing unless noted.
 *  - Animation presets (FLY_PRESETS) are exported so they can be reused by
 *    future components that need to trigger identical motion curves.
 *  - Static camera targets used by multiple call sites live in avaCameraConfig.js
 *    (REGION_CAMERA, AVA_CAMERA); this file imports them as needed.
 */

import maplibregl from 'maplibre-gl';
import { AVA_CAMERA, REGION_CAMERA } from './avaCameraConfig';
import { REGION_AVAS, REGION_BOUNDS } from './regionConfig';

// ─────────────────────────────────────────────────────────────────────────────
// Animation presets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared animation parameter bundles.
 * Use spread syntax to merge into a map.flyTo() / map.fitBounds() call:
 *   map.flyTo({ center: [...], zoom: 12, ...FLY_PRESETS.ava });
 */
export const FLY_PRESETS = {
  /** Standard AVA / WV overview fly — cinematic cubic ease in-out. */
  ava: {
    curve:    1.85,
    speed:    0.45,
    easing:   t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    essential: true,
  },

  /** Quick point / listing fly — moderate ease. */
  point: {
    curve:    1.4,
    speed:    0.55,
    essential: true,
  },

  /** Intro leg 1: globe → Oregon state overview. */
  introLeg1: {
    duration: 3500,
    curve:    1.6,
    easing:   t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
    essential: true,
  },

  /** Intro leg 2: Oregon overview → Willamette Valley. */
  introLeg2: {
    duration: 2800,
    curve:    1.2,
    easing:   t => 1 - Math.pow(1 - t, 3),
    essential: true,
  },

  /** AVA bounds fallback (fitBounds). */
  avaBounds: {
    padding: { top: 80, bottom: 80, left: 60, right: 60 },
    pitch:    40,
    curve:    1.85,
    speed:    0.45,
    freezeElevation: true,
  },

  /** Vineyard parcel bounds (fitBounds). */
  vineyardBounds: {
    padding: { top: 100, bottom: 100, left: 80, right: 80 },
    pitch:    40,
    curve:    1.4,
    speed:    0.55,
    essential: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Named static camera targets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bounding box of the full Willamette Valley — used as a fallback when no
 * specific camera is selected (e.g. reset with nothing selected).
 */
// Statewide frame (OWB): fitted on every Oregon AVA, generated from the DB.
export const WV_BOUNDS = [[REGION_BOUNDS[0], REGION_BOUNDS[1]], [REGION_BOUNDS[2], REGION_BOUNDS[3]]];

/**
 * Fixed camera position used for the intro leg 1 stop (Oregon state overview).
 */
export const OREGON_OVERVIEW_CAMERA = {
  center:  [-120.5, 44.0],
  zoom:    5.0,
  pitch:   12,
  bearing: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Navigation functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fly to a named AVA using its AVA_CAMERA entry.
 * Falls back to fitting the source's bounding box if no camera entry exists.
 *
 * @param {maplibregl.Map} map
 * @param {string} slug  AVA slug key matching AVA_CAMERA
 * @param {{ onMoveEnd?: () => void }} [options]
 */
export function flyToAva(map, slug, { onMoveEnd } = {}) {
  if (!map || !slug) return;
  const cam = AVA_CAMERA[slug];

  if (cam) {
    map.flyTo({
      center:  [cam.lng, cam.lat],
      zoom:    cam.zoom,
      pitch:   cam.pitch   ?? 40,
      bearing: cam.bearing ?? 0,
      ...FLY_PRESETS.ava,
    });
    if (onMoveEnd) map.once('moveend', onMoveEnd);
  } else {
    // No curated camera (every AVA in the statewide explorer): fit the AVA's
    // bounds from the generated AVA list. (The WVWA version read MapLibre's
    // private GeoJSONSource._data, whose shape changed in v5.)
    const ava = REGION_AVAS.find((a) => a.slug === slug);
    if (!ava?.bounds) return;
    const [w, s, e, n] = ava.bounds;
    map.fitBounds([[w, s], [e, n]], FLY_PRESETS.avaBounds);
    if (onMoveEnd) map.once('moveend', onMoveEnd);
  }
}

/**
 * Fly to a simple lng/lat coordinate.
 *
 * @param {maplibregl.Map} map
 * @param {{ lng: number, lat: number, zoom?: number }} opts
 */
export function flyToCoords(map, { lng, lat, zoom = 14 }) {
  if (!map) return;
  map.flyTo({ center: [lng, lat], zoom, ...FLY_PRESETS.point });
}

/**
 * Fit the map to a set of GeoJSON polygon features (vineyard parcel bounds).
 * Returns true if bounds were valid and fitBounds was called;
 * false if the caller should fall back to a point navigation.
 *
 * @param {maplibregl.Map} map
 * @param {GeoJSON.Feature[]} features
 * @returns {boolean}
 */
export function flyToVineyardBounds(map, features) {
  if (!features?.length) return false;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const feature of features) {
    const rings = feature.geometry.type === 'Polygon'
      ? feature.geometry.coordinates
      : feature.geometry.coordinates.flat();
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return false;
  map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
    ...FLY_PRESETS.vineyardBounds,
    maxZoom: features.length === 1 ? 16.2 : 14.8,
  });
  return true;
}

/**
 * Fly back to the Willamette Valley overview camera (exact tuned position).
 *
 * @param {maplibregl.Map} map
 */
export function flyToWillamette(map) {
  if (!map) return;
  map.flyTo({
    center:  [REGION_CAMERA.lng, REGION_CAMERA.lat],
    zoom:    REGION_CAMERA.zoom,
    pitch:   REGION_CAMERA.pitch   ?? 35,
    bearing: REGION_CAMERA.bearing ?? 0,
    ...FLY_PRESETS.ava,
  });
}

/**
 * Reset to Willamette Valley using fitBounds — adapts to any viewport size.
 * Use this when nothing is selected (no winery, no AVA).
 *
 * @param {maplibregl.Map} map
 */
export function flyToWillametteOverview(map) {
  if (!map) return;
  map.fitBounds(WV_BOUNDS, {
    padding: 40,
    pitch:   REGION_CAMERA.pitch   ?? 35,
    bearing: REGION_CAMERA.bearing ?? 0,
    ...FLY_PRESETS.ava,
  });
}

/**
 * Play the two-leg cinematic entrance sequence:
 *   Leg 1 — globe → Oregon state overview
 *   Leg 2 — Oregon overview → Willamette Valley
 *
 * @param {maplibregl.Map} map
 * @param {{ onComplete?: () => void }} [options]
 */
export function flyToIntro(map, { onComplete } = {}) {
  if (!map) return;

  // Leg 1: fly from globe to Oregon state overview
  map.flyTo({
    ...OREGON_OVERVIEW_CAMERA,
    ...FLY_PRESETS.introLeg1,
  });

  // Leg 2: after leg 1 ends, pause 1 s then fly into the Willamette Valley
  map.once('moveend', () => {
    setTimeout(() => {
      map.flyTo({
        center:  [REGION_CAMERA.lng, REGION_CAMERA.lat],
        zoom:    REGION_CAMERA.zoom,
        pitch:   REGION_CAMERA.pitch,
        bearing: REGION_CAMERA.bearing,
        ...FLY_PRESETS.introLeg2,
      });
      if (onComplete) map.once('moveend', onComplete);
    }, 1000);
  });
}
