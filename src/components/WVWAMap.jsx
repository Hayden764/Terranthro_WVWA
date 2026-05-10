import { useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';

// Register pmtiles:// protocol with MapLibre (must happen before any map is created)
const pmtilesProtocol = new Protocol();
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile.bind(pmtilesProtocol));
import ClimateLayer from './ClimateLayer';
import TopographyLayer from './TopographyLayer';
import MapControls from './MapControls';
import CameraDebug from './CameraDebug';
import TerroirDataChips from './TerroirDataChips';
import HoverPill from './map/HoverPill';
import { WV_SUB_AVAS, TOPO_LAYER_TYPES } from '../config/topographyConfig';
import { AVA_CAMERA, WV_CAMERA } from '../config/avaCameraConfig';
import { FLY_PRESETS, flyToAva, flyToCoords, flyToVineyardBounds, flyToWillamette, flyToIntro, WV_BOUNDS } from '../config/flyTo';
import { alpha, border, crimson, ink, MAP_GLASS, muted, parchment, TOKENS, TYPE } from '../styles/tokens';
import { getVineyardFeatureBounds } from '../lib/vineyardBounds';
import {
  buildInteractiveReferenceVineyardFilter,
  buildPassiveReferenceVineyardFilter,
} from '../lib/datasetFilters';

// In dev, always use relative API paths through the Vite proxy.
// In production, use VITE_API_BASE_URL if provided.
const API_BASE = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const API_HEADERS = import.meta.env.VITE_INTERNAL_API_KEY
  ? { 'x-api-key': import.meta.env.VITE_INTERNAL_API_KEY }
  : {};
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;
// PMTiles URL for the vineyard reference layer.
// In production: set VITE_PMTILES_URL to your R2/CDN URL.
// In local dev: leave unset to fall back to GeoJSON from the API.
const PMTILES_URL = import.meta.env.VITE_PMTILES_URL || null;
const FALLBACK_STYLE = {
  version: 8,
  sources: {
    esriWorldImagery: {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
  },
  layers: [
    {
      id: 'esri-world-imagery',
      type: 'raster',
      source: 'esriWorldImagery',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};
const MAP_STYLE = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/019d98dc-0865-7ac5-a184-a072f37b9509/style.json?key=${MAPTILER_KEY}`
  : FALLBACK_STYLE;

// ── Vineyard parcel data (fetched at map load, indexed here at runtime) ──
// Keyed by winery_recid (integer) → array of GeoJSON Feature objects
// so a single winery can map to multiple parcels.
// Populated from /api/vineyards/parcels?dataset=adelsheim during map load.
let VINEYARD_BY_RECID = {};
let LINKED_VINEYARD_BY_RECID = {};
let VINEYARD_FEATURES_BY_NAME = {}; // keyed by normalized vineyard_name → [feature, ...]
let VINEYARD_ALL_BY_NAME = {};      // keyed by normalized vineyard_name → [feature, ...] (all datasets)

function getVineyardNameFromProperties(properties = {}) {
  return properties.vineyard_name || properties.Vineyard_Name || properties.A1_VineyardName || '';
}

function normalizeVineyardName(name) {
  return (typeof name === 'string' ? name : '').trim().toLowerCase();
}

// ── Listing categories ────────────────────────────────────────────────────
export const LISTING_CATEGORIES = {
  hotel:      { label: 'Hotel / Inn',        color: TOKENS.amber, icon: '🏨', emoji: '🏨' },
  restaurant: { label: 'Restaurant / Dining', color: TOKENS.vividGreen, icon: '🍽️', emoji: '🍽️' },
  tasting:    { label: 'Tasting Room',        color: TOKENS.violet, icon: '🍷', emoji: '🍷' },
  winery:     { label: 'Winery / Vineyard',   color: crimson, icon: '🍇', emoji: '🍇' },
  other:      { label: 'Other',               color: muted, icon: '📍', emoji: '📍' },
};

const UI = {
  white: parchment,
  panelBg: alpha(TOKENS.ink, 0.92),
  panelBorder: alpha(TOKENS.parchment, 0.12),
  panelShadow: alpha(TOKENS.ink, 0.45),
  panelDivider: alpha(TOKENS.parchment, 0.08),
  tabActiveBg: alpha(TOKENS.parchment, 0.06),
  tabActiveText: alpha(TOKENS.parchment, 0.95),
  tabIdleText: alpha(TOKENS.parchment, 0.4),
  closeBtnBg: alpha(TOKENS.ink, 0.7),
  closeBtnBorder: alpha(TOKENS.parchment, 0.15),
  closeBtnText: alpha(TOKENS.parchment, 0.7),
  scrollbar: alpha(TOKENS.parchment, 0.15),
  cardBg: alpha(TOKENS.parchment, 0.06),
  cardBorder: alpha(TOKENS.parchment, 0.08),
  labelText: alpha(TOKENS.parchment, 0.4),
  valueText: alpha(TOKENS.parchment, 0.85),
  titleText: alpha(TOKENS.parchment, 0.95),
  bodyText: alpha(TOKENS.parchment, 0.6),
  phoneText: alpha(TOKENS.parchment, 0.7),
  sectionLabel: alpha(TOKENS.parchment, 0.35),
  vineyardAccent: TOKENS.vividGreen,
  vineyardAccentSoft: alpha(TOKENS.vividGreen, 0.12),
  vineyardAccentBorder: alpha(TOKENS.vividGreen, 0.35),
  vineyardAccentMuted: alpha(TOKENS.vividGreen, 0.5),
  hoverAccent: TOKENS.electricBlue,
  hoverAccentSoft: alpha(TOKENS.electricBlue, 0.1),
  hoverAccentBorder: alpha(TOKENS.electricBlue, 0.55),
  hoverAccentMuted: alpha(TOKENS.electricBlue, 0.9),
  subtleDivider: alpha(TOKENS.parchment, 0.06),
  faintText: alpha(TOKENS.parchment, 0.45),
  cardTextStrong: alpha(TOKENS.parchment, 0.9),
  blockBg: alpha(TOKENS.parchment, 0.03),
  blockBorder: alpha(TOKENS.parchment, 0.1),
  spinnerBorder: alpha(TOKENS.parchment, 0.15),
  spinnerTop: alpha(TOKENS.parchment, 0.9),
  devGroupBg: alpha(TOKENS.ink, 0.8),
  devGroupBorder: alpha(TOKENS.parchment, 0.14),
  devPanelBg: alpha(TOKENS.ink, 0.84),
  devPanelBorder: alpha(TOKENS.parchment, 0.2),
  devPanelShadow: alpha('black', 0.34),
  devPanelText: alpha(TOKENS.parchment, 0.96),
  devHeaderBorder: alpha(TOKENS.parchment, 0.14),
  devButtonBorder: alpha(TOKENS.parchment, 0.2),
  devButtonText: alpha(TOKENS.parchment, 0.84),
  devResetBg: alpha(TOKENS.parchment, 0.08),
  devResetText: alpha(TOKENS.parchment, 0.92),
  // Map chrome — raw atmospheric/earth-tone values not derivable from tokens
  // audit-ignore-start map-chrome-atmosphere
  mapContainerBg: 'black',
  popupLabelColor: '#1e293b',
  // audit-ignore-end
};

// MapLibre paint properties require concrete color values, not CSS var() tokens.
const MAP_PARCHMENT = '#EDE2D4';
const MAP_AMBER = '#C28A3A';
const toMapLibreColor = (color, fallback) => (
  typeof color === 'string' && color.startsWith('var(') ? fallback : color
);

// Shared listing hover/selection accent — used by the on-map dot/glow paint
// AND the bottom-center HoverPill so both stay visually linked.
// audit-ignore-start map-chrome-atmosphere
export const LISTING_HOVER_COLOR = '#38BDF8';
// audit-ignore-end

export const LISTING_FILTER_MODES = {
  allWineries: 'allWineries',
  withVineyardPolygons: 'withVineyardPolygons',
  withoutVineyardPolygons: 'withoutVineyardPolygons',
  noVineyardsVisualized: 'noVineyardsVisualized',
  noWineriesVisualized: 'noWineriesVisualized',
};

export const LISTING_SYMBOLOGY_PRESETS = {
  estateMinimal: 'estateMinimal',
  topoModern: 'topoModern',
  heritagePremium: 'heritagePremium',
};

const LISTING_SYMBOLOGY_OPTIONS = [];

// audit-ignore-start centralized-listing-symbology
const LISTING_SYMBOLOGY_PALETTES = {
  [LISTING_SYMBOLOGY_PRESETS.estateMinimal]: {
    clusterCircleColor: [
      'step', ['get', 'point_count'],
      'rgba(234, 236, 233, 0.82)', 10,
      'rgba(218, 223, 217, 0.84)', 30,
      'rgba(196, 204, 198, 0.88)',
    ],
    clusterStrokeColor: 'rgba(41, 49, 42, 0.52)',
    clusterCountColor: '#1F2A22',
    clusterCountHaloColor: 'rgba(250,247,242,0.72)',
    markerFillColor: '#304437',
    markerStrokeColor: 'rgba(250,247,242,0.82)',
    markerTextColor: '#F5EFE3',
    markerTextHaloColor: 'rgba(16,22,18,0.42)',
    focusAccentColor: '#6FB78D',
  },
  [LISTING_SYMBOLOGY_PRESETS.topoModern]: {
    clusterCircleColor: [
      'step', ['get', 'point_count'],
      'rgba(226, 238, 244, 0.82)', 10,
      'rgba(204, 227, 236, 0.84)', 30,
      'rgba(177, 210, 224, 0.88)',
    ],
    clusterStrokeColor: 'rgba(44, 72, 88, 0.46)',
    clusterCountColor: '#203744',
    clusterCountHaloColor: 'rgba(239,247,250,0.78)',
    markerFillColor: '#255A73',
    markerStrokeColor: 'rgba(235,246,252,0.86)',
    markerTextColor: '#EDF8FF',
    markerTextHaloColor: 'rgba(16,38,49,0.44)',
    focusAccentColor: '#38BDF8',
  },
  [LISTING_SYMBOLOGY_PRESETS.heritagePremium]: {
    clusterCircleColor: [
      'step', ['get', 'point_count'],
      'rgba(228, 213, 188, 0.82)', 10,
      'rgba(214, 193, 161, 0.84)', 30,
      'rgba(190, 163, 124, 0.88)',
    ],
    clusterStrokeColor: 'rgba(74, 52, 30, 0.55)',
    clusterCountColor: '#3B2613',
    clusterCountHaloColor: 'rgba(246,235,214,0.76)',
    markerFillColor: '#6A4C2D',
    markerStrokeColor: 'rgba(245,229,203,0.86)',
    markerTextColor: '#FFF6E8',
    markerTextHaloColor: 'rgba(40,26,14,0.44)',
    focusAccentColor: '#B88A4A',
  },
};

const LISTING_SYMBOLOGY_CONFIG = {
  [LISTING_SYMBOLOGY_PRESETS.estateMinimal]: {
    clusterMaxZoom: 11,
    clusterRadius: 34,
    clusterMinPoints: 3,
    ...LISTING_SYMBOLOGY_PALETTES[LISTING_SYMBOLOGY_PRESETS.estateMinimal],
    clusterCircleRadius: ['step', ['get', 'point_count'], 14, 10, 19, 30, 24],
    clusterStrokeWidth: 1.3,
    markerRadius: ['interpolate', ['linear'], ['zoom'], 10, 5.8, 14, 8.4],
    markerStrokeWidth: 1.6,
  },
  [LISTING_SYMBOLOGY_PRESETS.topoModern]: {
    clusterMaxZoom: 12,
    clusterRadius: 31,
    clusterMinPoints: 3,
    ...LISTING_SYMBOLOGY_PALETTES[LISTING_SYMBOLOGY_PRESETS.topoModern],
    clusterCircleRadius: ['step', ['get', 'point_count'], 13, 10, 18, 30, 23],
    clusterStrokeWidth: 1.4,
    markerRadius: ['interpolate', ['linear'], ['zoom'], 10, 5.7, 14, 8.2],
    markerStrokeWidth: 1.6,
  },
  [LISTING_SYMBOLOGY_PRESETS.heritagePremium]: {
    clusterMaxZoom: 12,
    clusterRadius: 37,
    clusterMinPoints: 2,
    ...LISTING_SYMBOLOGY_PALETTES[LISTING_SYMBOLOGY_PRESETS.heritagePremium],
    clusterCircleRadius: ['step', ['get', 'point_count'], 15, 10, 20, 30, 25],
    clusterStrokeWidth: 1.45,
    markerRadius: ['interpolate', ['linear'], ['zoom'], 10, 6.2, 14, 8.9],
    markerStrokeWidth: 1.7,
  },
};
// audit-ignore-end centralized-listing-symbology

const DEFAULT_LISTING_SYMBOLOGY = LISTING_SYMBOLOGY_PRESETS.topoModern;
const LISTING_BASE_LAYER_IDS = [
  'listings-clusters',
  'listings-cluster-count',
  'listings-unclustered',
];


function getListingSymbologyConfig(preset) {
  return LISTING_SYMBOLOGY_CONFIG[preset] || LISTING_SYMBOLOGY_CONFIG[DEFAULT_LISTING_SYMBOLOGY];
}

function removeListingsBaseLayersAndSource(map) {
  for (const layerId of LISTING_BASE_LAYER_IDS) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  if (map.getSource('listings')) map.removeSource('listings');
}

function addListingsSourceAndBaseLayers(map, geojsonData, preset, isVisible) {
  if (!map || !map.getStyle?.() || !map.isStyleLoaded?.()) return false;
  const config = getListingSymbologyConfig(preset);
  map.addSource('listings', {
    type: 'geojson',
    data: geojsonData,
    cluster: true,
    clusterMaxZoom: config.clusterMaxZoom,
    clusterRadius: config.clusterRadius,
    clusterMinPoints: config.clusterMinPoints,
  });

  map.addLayer({
    id: 'listings-clusters',
    type: 'circle',
    source: 'listings',
    filter: ['has', 'point_count'],
    layout: { visibility: isVisible ? 'visible' : 'none' },
    paint: {
      'circle-color': config.clusterCircleColor,
      'circle-radius': config.clusterCircleRadius,
      'circle-stroke-width': config.clusterStrokeWidth,
      'circle-stroke-color': config.clusterStrokeColor,
      'circle-opacity': 1,
    },
  });

  map.addLayer({
    id: 'listings-cluster-count',
    type: 'symbol',
    source: 'listings',
    filter: ['has', 'point_count'],
    layout: {
      visibility: isVisible ? 'visible' : 'none',
      'text-field': '{point_count_abbreviated}',
      'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
      'text-size': 11,
    },
    paint: {
      'text-color': config.clusterCountColor,
      'text-halo-color': config.clusterCountHaloColor,
      'text-halo-width': 0.45,
    },
  });

  map.addLayer({
    id: 'listings-unclustered',
    type: 'circle',
    source: 'listings',
    filter: ['!', ['has', 'point_count']],
    layout: { visibility: isVisible ? 'visible' : 'none' },
    paint: {
      'circle-color': config.markerFillColor,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 14, 5.5],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': UI.white,
      'circle-opacity': 0.2,
      'circle-stroke-opacity': 0.85,
    },
  });

  return true;
}

function applyListingFocusAccent(map, preset) {
  // accent color is still used by the glow ring circle layers
  const accent = getListingSymbologyConfig(preset).focusAccentColor;

  if (map.getLayer('listings-selected-glow')) {
    map.setPaintProperty('listings-selected-glow', 'circle-stroke-color', accent);
  }
  if (map.getLayer('listings-hovered-glow')) {
    map.setPaintProperty('listings-hovered-glow', 'circle-stroke-color', accent);
  }
}


// Willamette Valley approximate bounding box
// WV_BOUNDS is imported from '../config/flyTo'

// Build a GeoJSON FeatureCollection for the listings source, filtered to
// winery records with optional vineyard polygon and AVA restrictions.
function buildListingsGeoJSON(listings, listingFilterMode, vineyardRecidSet, insideIds = null) {
  if (listingFilterMode === LISTING_FILTER_MODES.noWineriesVisualized) {
    return { type: 'FeatureCollection', features: [] };
  }
  const features = listings
    .filter(l => {
      if (l.category !== 'winery') return false;
      if (listingFilterMode === LISTING_FILTER_MODES.withVineyardPolygons && !vineyardRecidSet.has(l.id)) return false;
      if (listingFilterMode === LISTING_FILTER_MODES.withoutVineyardPolygons && vineyardRecidSet.has(l.id)) return false;
      if (insideIds && !insideIds.includes(l.id)) return false;
      return true;
    })
    .map(listing => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [listing.lng, listing.lat] },
      properties: {
        id:       listing.id,
        num:      listing.num,
        title:    listing.title,
        desc:     listing.desc,
        phone:    listing.phone,
        url:      listing.url,
        image_url: listing.image_url,
        category: listing.category,
        color:    LISTING_CATEGORIES[listing.category].color,
        catLabel: LISTING_CATEGORIES[listing.category].label,
      },
    }));
  return { type: 'FeatureCollection', features };
}


// Ordered list of listing layers — always kept on top of AVA boundary layers.
// Vineyard-selected layers sit just below the dot layers so dots are visible
// on top of highlighted parcels.
const LISTING_LAYER_ORDER = [
  'vineyards-reference-line',
  'vineyards-linked-fill',
  'vineyards-linked-line',
  'vineyards-reference-hover-line',
  'vineyards-passive-hover-line',
  'vineyards-selected-fill',
  'vineyards-selected-line',
  'vineyards-hovered-fill',
  'vineyards-hovered-line',
  'listings-clusters',
  'listings-cluster-count',
  'listings-unclustered',
  'listings-hovered-glow',
  'listings-hovered-dot',
  'listings-selected-glow',
  'listings-selected-dot',
];

const LISTING_LAYERS_HIDDEN_IN_VINEYARD_FOCUS = [
  'listings-clusters',
  'listings-cluster-count',
  'listings-unclustered',
  'listings-hovered-glow',
  'listings-hovered-dot',
];

const LISTING_MARKER_LAYERS = [
  'listings-clusters',
  'listings-cluster-count',
  'listings-unclustered',
  'listings-hovered-glow',
  'listings-hovered-dot',
  'listings-selected-glow',
  'listings-selected-dot',
];

const DEV_LAYER_DEFAULTS = {
  wvMask: true,
  wvBoundary: true,
  avaBoundaries: true,
  vineyardsDundeeChehalem: true,
  vineyardsYC: true,
  vineyardsAdelsheimReference: true,
  vineyardsLinked: true,
  vineyardHighlights: true,
  wineries: true,
  climate: true,
  topography: true,
};

const VINEYARD_HATCH_PATTERN_ID = 'vineyard-diagonal-hatch';

// ── World wine region callout data (shown on rotating globe entrance) ────────
// offset: [x, y] in ems — diagonal values spread labels apart vertically.
// anchor: MapLibre text-anchor — positions the text box edge at the offset point.
const WORLD_WINE_REGIONS = [
  // Europe — stagger vertically so clustered regions don't collide
  { id: 'bordeaux',     name: 'Bordeaux',       country: 'France',        lng: -0.57,  lat: 44.84,  offset: [-2.0, -0.6], anchor: 'right'  },
  { id: 'champagne',    name: 'Champagne',      country: 'France',        lng: 4.03,   lat: 49.05,  offset: [2.0,  0.6],  anchor: 'left'   },
  { id: 'tuscany',      name: 'Tuscany',        country: 'Italy',         lng: 11.25,  lat: 43.45,  offset: [2.0,  0.0],  anchor: 'left'   },
  { id: 'rioja',        name: 'Rioja',          country: 'Spain',         lng: -2.44,  lat: 42.47,  offset: [-2.0, 0.6],  anchor: 'right'  },
  { id: 'douro',        name: 'Douro Valley',   country: 'Portugal',      lng: -7.67,  lat: 41.18,  offset: [-2.0, -0.6], anchor: 'right'  },
  { id: 'mosel',        name: 'Mosel',          country: 'Germany',       lng: 7.05,   lat: 50.00,  offset: [2.0,  -0.6], anchor: 'left'   },
  // North America
  { id: 'napa',         name: 'Napa Valley',    country: 'California',    lng: -122.3, lat: 38.5,   offset: [-2.0, 0.6],  anchor: 'right'  },
  { id: 'walla_walla',  name: 'Walla Walla',    country: 'Washington',    lng: -118.3, lat: 46.1,   offset: [2.0,  0.0],  anchor: 'left'   },
  { id: 'finger_lakes', name: 'Finger Lakes',   country: 'New York',      lng: -76.9,  lat: 42.7,   offset: [2.0,  0.6],  anchor: 'left'   },
  // South America
  { id: 'mendoza',      name: 'Mendoza',        country: 'Argentina',     lng: -68.83, lat: -32.89, offset: [2.0,  0.0],  anchor: 'left'   },
  // Southern Hemisphere
  { id: 'barossa',      name: 'Barossa Valley', country: 'Australia',     lng: 138.90, lat: -34.52, offset: [-2.0, 0.0],  anchor: 'right'  },
  { id: 'capewine',     name: 'Cape Winelands', country: 'South Africa',  lng: 18.97,  lat: -33.92, offset: [2.0,  0.0],  anchor: 'left'   },
  { id: 'marlborough',  name: 'Marlborough',    country: 'New Zealand',   lng: 173.95, lat: -41.51, offset: [-2.0, 0.0],  anchor: 'right'  },
];

function setLayerVisibility(map, layerId, isVisible) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
}

function ensureVineyardHatchPattern(map) {
  if (map.hasImage(VINEYARD_HATCH_PATTERN_ID)) return;

  const size = 8;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Transparent tile with repeated diagonal strokes.
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(165, 165, 165, 0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-2, 6);
  ctx.lineTo(2, 10);
  ctx.moveTo(2, 2);
  ctx.lineTo(6, 6);
  ctx.moveTo(6, -2);
  ctx.lineTo(10, 2);
  ctx.stroke();

  const image = ctx.getImageData(0, 0, size, size);
  map.addImage(VINEYARD_HATCH_PATTERN_ID, image, { pixelRatio: 2 });
}

/** Re-raise all listing (+ vineyard-selected) layers to the top of the map stack. */
function raiseListingLayers(map) {
  for (const layerId of LISTING_LAYER_ORDER) {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  }
}

function raiseBasemapLabelLayers(map, basemapLabelLayerIds = []) {
  for (const layerId of basemapLabelLayerIds) {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  }
}

function normalizeOverlayAndLabelOrder(map, basemapLabelLayerIds = []) {
  raiseListingLayers(map);
  raiseBasemapLabelLayers(map, basemapLabelLayerIds);
}

// flyToVineyardBounds, flyToAva, flyToCoords, flyToWillamette, flyToIntro
// are imported from '../config/flyTo'.

/**
 * blinkMapLayer — pulse a paint property through a sequence of timed values.
 * beats: [{ delay: ms, value: any }, ...]
 */
function blinkMapLayer(map, layerId, property, beats) {
  beats.forEach(({ delay, value }) => {
    setTimeout(() => {
      if (!map || !map.getLayer(layerId)) return;
      try { map.setPaintProperty(layerId, property, value); } catch { /* ignore */ }
    }, delay);
  });
}

function setListingVisibilityForVineyardFocus(map, isFocused) {
  const visibility = isFocused ? 'none' : 'visible';
  for (const layerId of LISTING_LAYERS_HIDDEN_IN_VINEYARD_FOCUS) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visibility);
    }
  }
}

function setListingVisibilityForIntro(map, isIntroComplete) {
  const visibility = isIntroComplete ? 'visible' : 'none';
  for (const layerId of LISTING_MARKER_LAYERS) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visibility);
    }
  }
}

function setListingVisualizationVisibility(map, isVisible) {
  const visibility = isVisible ? 'visible' : 'none';
  for (const layerId of LISTING_MARKER_LAYERS) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visibility);
    }
  }
}

function setListingSoftFocus(map, isSoftFocused) {
  const clusterOpacity = isSoftFocused ? 0.3 : 1;
  const clusterCountOpacity = isSoftFocused ? 0.35 : 1;
  const unclusteredOpacity = isSoftFocused ? 0.24 : 0.92;
  const unclusteredStrokeOpacity = isSoftFocused ? 0.3 : 0.55;
  const unclusteredNumOpacity = isSoftFocused ? 0.32 : 1;
  const hoveredGlowOpacity = isSoftFocused ? 0.22 : 0.22;
  const hoveredDotOpacity = isSoftFocused ? 0.3 : 0.3;
  const hoveredNumOpacity = isSoftFocused ? 0.38 : 1;
  const hoveredGlowRadius = ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 14];
  const hoveredGlowStrokeWidth = 1.5;
  const hoveredDotRadius = ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 6];
  const hoveredDotStrokeWidth = 1;

  if (map.getLayer('listings-clusters')) {
    map.setPaintProperty('listings-clusters', 'circle-opacity', clusterOpacity);
  }
  if (map.getLayer('listings-cluster-count')) {
    map.setPaintProperty('listings-cluster-count', 'text-opacity', clusterCountOpacity);
  }
  if (map.getLayer('listings-unclustered')) {
    map.setPaintProperty('listings-unclustered', 'circle-opacity', unclusteredOpacity);
    map.setPaintProperty('listings-unclustered', 'circle-stroke-opacity', unclusteredStrokeOpacity);
  }
  if (map.getLayer('listings-unclustered-num')) {
    map.setPaintProperty('listings-unclustered-num', 'text-opacity', unclusteredNumOpacity);
  }
  if (map.getLayer('listings-hovered-glow')) {
    map.setPaintProperty('listings-hovered-glow', 'circle-radius', hoveredGlowRadius);
    map.setPaintProperty('listings-hovered-glow', 'circle-stroke-width', hoveredGlowStrokeWidth);
    map.setPaintProperty('listings-hovered-glow', 'circle-stroke-opacity', hoveredGlowOpacity);
  }
  if (map.getLayer('listings-hovered-dot')) {
    map.setPaintProperty('listings-hovered-dot', 'circle-radius', hoveredDotRadius);
    map.setPaintProperty('listings-hovered-dot', 'circle-stroke-width', hoveredDotStrokeWidth);
    map.setPaintProperty('listings-hovered-dot', 'circle-opacity', hoveredDotOpacity);
  }
  if (map.getLayer('listings-hovered-num')) {
    map.setPaintProperty('listings-hovered-num', 'text-opacity', hoveredNumOpacity);
  }
}

function setVineyardReferenceSoftFocus(map, isSoftFocused) {
  const referenceFillOpacity = isSoftFocused ? 0.003 : 0.06;
  const referenceLineOpacity = isSoftFocused ? 0.04 : 0.5;
  const passiveFillOpacity = isSoftFocused ? 0.04 : 0.18;
  const passivePatternOpacity = isSoftFocused ? 0.03 : 0.2;
  const passiveLineOpacity = isSoftFocused ? 0.05 : 0.34;
  const passiveLineWidth = isSoftFocused ? 0.5 : 0.85;
  const linkedLineOpacity = isSoftFocused ? 0.008 : 0.86;
  const linkedFillOpacity = isSoftFocused ? 0.001 : 0.03;
  const hoverLineOpacity = isSoftFocused ? 0.35 : 1;
  const passiveHoverLineOpacity = isSoftFocused ? 0.22 : 0.7;
  const referenceLineWidth = isSoftFocused ? 0.7 : 1.1;
  const linkedLineWidth = isSoftFocused ? 0.6 : 1.4;
  const hoverLineWidth = isSoftFocused ? 2.0 : 3.0;
  const passiveHoverLineWidth = isSoftFocused ? 1.0 : 1.8;
  const referenceLineColor = isSoftFocused ? '#E8EEF5' : '#C7D6E8';
  const passiveLineColor = '#FFFFFF';
  const linkedLineColor = isSoftFocused ? '#D2DDD5' : '#3FAF79';
  const linkedFillColor = isSoftFocused ? '#D2DDD5' : '#22C55E';

  if (map.getLayer('vineyards-reference-fill')) {
    map.setPaintProperty('vineyards-reference-fill', 'fill-opacity', referenceFillOpacity);
  }
  if (map.getLayer('vineyards-reference-line')) {
    map.setPaintProperty('vineyards-reference-line', 'line-color', referenceLineColor);
    map.setPaintProperty('vineyards-reference-line', 'line-width', referenceLineWidth);
    map.setPaintProperty('vineyards-reference-line', 'line-opacity', referenceLineOpacity);
  }
  if (map.getLayer('vineyards-reference-passive-fill')) {
    map.setPaintProperty('vineyards-reference-passive-fill', 'fill-opacity', passiveFillOpacity);
  }
  if (map.getLayer('vineyards-reference-passive-hatch')) {
    map.setPaintProperty('vineyards-reference-passive-hatch', 'fill-opacity', passivePatternOpacity);
  }
  if (map.getLayer('vineyards-reference-passive-line')) {
    map.setPaintProperty('vineyards-reference-passive-line', 'line-color', passiveLineColor);
    map.setPaintProperty('vineyards-reference-passive-line', 'line-width', passiveLineWidth);
    map.setPaintProperty('vineyards-reference-passive-line', 'line-opacity', passiveLineOpacity);
  }
  if (map.getLayer('vineyards-linked-line')) {
    map.setPaintProperty('vineyards-linked-line', 'line-color', linkedLineColor);
    map.setPaintProperty('vineyards-linked-line', 'line-width', linkedLineWidth);
    map.setPaintProperty('vineyards-linked-line', 'line-opacity', linkedLineOpacity);
  }
  if (map.getLayer('vineyards-linked-fill')) {
    map.setPaintProperty('vineyards-linked-fill', 'fill-color', linkedFillColor);
    map.setPaintProperty('vineyards-linked-fill', 'fill-opacity', linkedFillOpacity);
  }
  if (map.getLayer('vineyards-reference-hover-line')) {
    map.setPaintProperty('vineyards-reference-hover-line', 'line-width', hoverLineWidth);
    map.setPaintProperty('vineyards-reference-hover-line', 'line-opacity', hoverLineOpacity);
  }
  if (map.getLayer('vineyards-passive-hover-line')) {
    map.setPaintProperty('vineyards-passive-hover-line', 'line-width', passiveHoverLineWidth);
    map.setPaintProperty('vineyards-passive-hover-line', 'line-opacity', passiveHoverLineOpacity);
  }
}

function setVineyardVisualizationVisibility(map, isVisible) {
  const visibility = isVisible ? 'visible' : 'none';
  const vineyardLayerIds = [
    'vineyards-reference-fill',
    'vineyards-reference-line',
    'vineyards-reference-passive-fill',
    'vineyards-reference-passive-hatch',
    'vineyards-reference-passive-line',
    'vineyards-linked-fill',
    'vineyards-linked-line',
    'vineyards-reference-hover-line',
    'vineyards-passive-hover-line',
    'vineyards-selected-fill',
    'vineyards-selected-line',
    'vineyards-hovered-fill',
    'vineyards-hovered-line',
  ];
  for (const layerId of vineyardLayerIds) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visibility);
    }
  }
}

// ── Right-side tabbed context panel ──────────────────────────────────────
// Shown whenever a listing is selected, a layer is active, or both.
// When both are present a tab bar appears; when only one is present no tabs
// are shown (the single content fills the panel directly).
function RightContextPanel({ listing, activeLayer, topoStats, selectedAva, vineyards, parcelTopoStats, onCloseListing, onCloseLayer, onVineyardHover, onViewAllVineyards }) {
  const hasBoth = !!(listing && activeLayer);
  // Default tab: winery when a listing is selected, otherwise layer
  const [tab, setTab] = useState(listing ? 'listing' : 'layer');

  // Keep the active tab valid when content changes
  const resolvedTab = hasBoth ? tab : (listing ? 'listing' : 'layer');

  const cat = listing ? LISTING_CATEGORIES[listing.category] : null;

  // ── Shared shell ──────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'absolute',
      right: 16,
      top: '50%',
      transform: 'translateY(-50%)',
      width: 288,
      maxHeight: 'calc(100vh - 120px)',
      background: UI.panelBg,
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: `1px solid ${UI.panelBorder}`,
      borderRadius: 14,
      boxShadow: `0 8px 40px ${UI.panelShadow}`,
      fontFamily: 'var(--font-sans)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 40,
    }}>

      {/* ── Header / tab bar ─────────────────────────────────────────── */}
      <div style={{
        padding: hasBoth ? '0' : '12px 14px 0',
        borderBottom: `1px solid ${UI.panelDivider}`,
        flexShrink: 0,
      }}>
        {hasBoth ? (
          /* Tab bar */
          <div style={{ display: 'flex' }}>
            {[
              { id: 'listing', icon: cat?.icon ?? '📍', label: 'Listing' },
              { id: 'layer',   icon: getLayerIcon(activeLayer), label: getLayerLabel(activeLayer) },
            ].map(t => {
              const isActive = resolvedTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    flex: 1,
                    padding: '10px 8px',
                    background: isActive ? UI.tabActiveBg : 'transparent',
                    border: 'none',
                    borderBottom: isActive ? `2px solid ${crimson}` : '2px solid transparent',
                    color: isActive ? UI.tabActiveText : UI.tabIdleText,
                    cursor: 'pointer',
                    fontSize: 'var(--type-ui-label-size)',
                    fontWeight: 700,
                    fontFamily: 'var(--font-sans)',
                    letterSpacing: '0.04em',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    transition: 'color 0.15s, border-color 0.15s, background 0.15s',
                  }}
                >
                  <span style={{ fontSize: 'var(--type-mono-size)' }}>{t.icon}</span>
                  {t.label}
                  {/* Per-tab close × */}
                  <span
                    role="button"
                    title={`Close ${t.label}`}
                    onClick={e => { e.stopPropagation(); t.id === 'listing' ? onCloseListing() : onCloseLayer(); }}
                    style={{
                      marginLeft: 4,
                      fontSize: 'var(--type-ui-label-size)',
                      opacity: 0.5,
                      lineHeight: 1,
                      cursor: 'pointer',
                      padding: '1px 3px',
                      borderRadius: 3,
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
                  >✕</span>
                </button>
              );
            })}
          </div>
        ) : (
          /* Single-mode header row */
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 'var(--type-display-italic-size)' }}>
                {resolvedTab === 'listing' ? (cat?.icon ?? '📍') : getLayerIcon(activeLayer)}
              </span>
              <div>
                <div style={{ ...TYPE.uiLabel, color: UI.tabIdleText, lineHeight: 1, marginBottom: 2 }}>
                  {resolvedTab === 'listing' ? cat?.label : 'Active Layer'}
                </div>
                <div style={{ fontSize: 'var(--type-mono-size)', fontWeight: 700, color: UI.tabActiveText, lineHeight: 1.2 }}>
                  {resolvedTab === 'listing' ? listing.title : getLayerLabel(activeLayer)}
                </div>
              </div>
            </div>
            <button
              onClick={resolvedTab === 'listing' ? onCloseListing : onCloseLayer}
              style={{
                background: UI.closeBtnBg,
                border: `1px solid ${UI.closeBtnBorder}`,
                borderRadius: 8,
                color: UI.closeBtnText,
                width: 28, height: 28,
                cursor: 'pointer', fontSize: 'var(--type-body-size)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1, flexShrink: 0,
              }}
            >✕</button>
          </div>
        )}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div style={{ overflowY: 'auto', flex: 1, scrollbarWidth: 'thin', scrollbarColor: `${UI.scrollbar} transparent` }}>
        {resolvedTab === 'listing' && listing && (
          <ListingTabContent listing={listing} cat={cat} vineyards={vineyards} parcelTopoStats={parcelTopoStats} onVineyardHover={onVineyardHover} onViewAllVineyards={onViewAllVineyards} />
        )}
        {resolvedTab === 'layer' && activeLayer && (
          <LayerTabContent activeLayer={activeLayer} topoStats={topoStats} />
        )}
      </div>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────── */
const LAYER_META = {
  tdmean:    { icon: '🌡️', label: 'Mean Temperature' },
  elevation: { icon: '⛰️',  label: 'Elevation' },
  slope:     { icon: '📐', label: 'Slope' },
  aspect:    { icon: '🧭', label: 'Aspect' },
};
function getLayerIcon(id)  { return LAYER_META[id]?.icon  ?? '🗺️'; }
function getLayerLabel(id) { return LAYER_META[id]?.label ?? id; }

/* ── Listing tab ──────────────────────────────────────────────────────── */
function ListingTabContent({ listing, cat, vineyards, parcelTopoStats, onVineyardHover, onViewAllVineyards }) {
  const CARD = { background: UI.cardBg, border: `1px solid ${UI.cardBorder}`, borderRadius: 10, padding: '12px 14px', marginBottom: 8 };
  const LBL  = { ...TYPE.uiLabel, color: UI.labelText, marginBottom: 4 };
  const VAL  = { fontSize: 'var(--type-body-size)', color: UI.valueText, lineHeight: 1.5 };

  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [expandedGroupKey, setExpandedGroupKey] = useState(null);

  // Phase 1 grouping: one modal card per vineyard name, combining all polygons
  // with that name for the selected winery.
  const vineyardGroups = Object.values((vineyards || []).reduce((acc, feature, index) => {
    const p = feature.properties || {};
    const rawName = (p.vineyard_name || p.Vineyard_Name || p.A1_VineyardName || '').trim();
    const key = rawName ? `name:${rawName.toLowerCase()}` : `block:${index}`;

    if (!acc[key]) {
      acc[key] = {
        key,
        name: rawName || `Vineyard Block Group ${index + 1}`,
        features: [],
        acresTotal: 0,
        acresCount: 0,
        avas: new Set(),
      };
    }

    const g = acc[key];
    g.features.push(feature);

    const acresRaw = p.acres ?? p.Acres ?? p.VA0_TotalVineAcres;
    const acresVal = Number(acresRaw);
    if (Number.isFinite(acresVal) && acresVal > 0) {
      g.acresTotal += acresVal;
      g.acresCount += 1;
    }

    const ava = p.nested_nested_ava || p.nested_ava || p.Nested_Nested_AVA || p.Nested_AVA || p.C3_NestNestAVA || p.C2_NestAVA || p.C1_AVA || null;
    if (ava) g.avas.add(ava);

    return acc;
  }, {})).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      {/* Hero image */}
      {listing.image_url && (
        <div style={{ height: 140, overflow: 'hidden', flexShrink: 0 }}>
          <img
            src={listing.image_url}
            alt={listing.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={e => { e.currentTarget.parentElement.style.display = 'none'; }}
          />
        </div>
      )}
      <div style={{ padding: '14px 16px 18px' }}>
        {/* Number + title */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          <span style={{
            width: 24, height: 24, borderRadius: '50%', background: cat.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--type-ui-label-size)', fontWeight: 700, color: UI.white, flexShrink: 0, marginTop: 2,
          }}>
            {listing.num}
          </span>
          <div style={{ fontSize: 'var(--type-body-size)', fontWeight: 700, color: UI.titleText, lineHeight: 1.3 }}>
            {listing.title}
          </div>
        </div>

        {listing.desc && (
          <p style={{ fontSize: 'var(--type-body-size)', color: UI.bodyText, lineHeight: 1.6, margin: '0 0 12px 0' }}>
            {listing.desc.slice(0, 300)}{listing.desc.length > 300 ? '…' : ''}
          </p>
        )}

        {listing.phone && (
          <a href={`tel:${listing.phone}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--type-body-size)', color: UI.phoneText, textDecoration: 'none', marginBottom: 10 }}>
            📞 {listing.phone}
          </a>
        )}

        {listing.url && (
          <a href={listing.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: '8px 14px', background: cat.color, color: UI.white, borderRadius: 8, fontSize: 'var(--type-body-size)', fontWeight: 600, textDecoration: 'none', textAlign: 'center', marginTop: 4 }}>
            Visit Website ↗
          </a>
        )}

        {/* ── Vineyard parcels ─────────────────────────────────────── */}
        {vineyards && vineyards.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ ...TYPE.uiLabel, color: UI.sectionLabel }}>
                🍇 Estate Vineyard{vineyards.length > 1 ? 's' : ''}
              </div>
              {vineyards.length > 1 && (
                <button
                  onClick={() => onViewAllVineyards?.(vineyards)}
                  style={{
                    background: UI.vineyardAccentSoft,
                    border: `1px solid ${UI.vineyardAccentBorder}`,
                    borderRadius: 6,
                    color: UI.vineyardAccent,
                    fontSize: 'var(--type-ui-label-size)',
                    fontWeight: 700,
                    fontFamily: 'var(--font-sans)',
                    letterSpacing: '0.04em',
                    padding: '3px 8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = UI.hoverAccentSoft;
                    e.currentTarget.style.borderColor = UI.hoverAccentBorder;
                    e.currentTarget.style.color = UI.hoverAccent;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = UI.vineyardAccentSoft;
                    e.currentTarget.style.borderColor = UI.vineyardAccentBorder;
                    e.currentTarget.style.color = UI.vineyardAccent;
                  }}
                  title="Fit map to all estate parcels"
                >
                  ⌖ View All
                </button>
              )}
            </div>
            {vineyardGroups.map((group, i) => {
              const blockMap = new Map();
              for (const f of group.features) {
                const blocks = Array.isArray(f.properties?.blocks) ? f.properties.blocks : [];
                for (const b of blocks) {
                  const blockName = (b.Block || '').trim();
                  if (!blockName) continue;

                  if (!blockMap.has(blockName)) {
                    blockMap.set(blockName, {
                      name: blockName,
                      varieties: new Set(),
                      clones: new Set(),
                      acres: [],
                    });
                  }

                  const row = blockMap.get(blockName);
                  if (b.Variety) row.varieties.add(String(b.Variety).trim());
                  if (b.Clone) row.clones.add(String(b.Clone).trim());
                  const acresNum = Number(b.Acres);
                  if (Number.isFinite(acresNum) && acresNum > 0) row.acres.push(acresNum);
                }
              }

              const blockRows = Array.from(blockMap.values()).sort((a, b) => a.name.localeCompare(b.name));

              const blockCount = blockRows.length > 0 ? blockRows.length : group.features.length;
              const acres = group.acresCount > 0 ? group.acresTotal.toFixed(1) : null;
              const ava = group.avas.size === 1
                ? Array.from(group.avas)[0]
                : (group.avas.size > 1 ? `Multiple AVAs (${group.avas.size})` : null);
              const isHovered = hoveredIdx === i;
              const isExpanded = expandedGroupKey === group.key;

              // Aggregate topo stats across all parcels in this group
              const groupTopoStats = (() => {
                const rows = group.features
                  .map(f => parcelTopoStats?.[f.properties?.id])
                  .filter(Boolean);
                if (!rows.length) return null;
                const avg = (key) => {
                  const vals = rows.map(r => r[key]).filter(v => v != null);
                  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
                };
                const min = (key) => {
                  const vals = rows.map(r => r[key]).filter(v => v != null);
                  return vals.length ? Math.min(...vals) : null;
                };
                const max = (key) => {
                  const vals = rows.map(r => r[key]).filter(v => v != null);
                  return vals.length ? Math.max(...vals) : null;
                };
                return {
                  elev_min: min('elevation_min_ft'),
                  elev_max: max('elevation_max_ft'),
                  slope_mean: avg('slope_mean_deg'),
                  slope_p10: min('slope_p10_deg'),
                  slope_p90: max('slope_p90_deg'),
                  aspect_label: rows[0]?.aspect_label ?? null,
                };
              })();
              return (
                <div
                  key={group.key}
                  style={{
                    ...CARD,
                    cursor: 'pointer',
                    border: isHovered
                      ? `1px solid ${UI.hoverAccentBorder}`
                      : `1px solid ${UI.cardBorder}`,
                    background: isHovered
                      ? UI.hoverAccentSoft
                      : UI.cardBg,
                    transition: 'border-color 0.15s, background 0.15s',
                    position: 'relative',
                  }}
                  onMouseEnter={() => {
                    setHoveredIdx(i);
                    onVineyardHover?.(group.features);
                  }}
                  onMouseLeave={() => {
                    setHoveredIdx(null);
                    onVineyardHover?.(null);
                  }}
                  onClick={() => {
                    setExpandedGroupKey(group.key);
                    onViewAllVineyards?.(group.features);
                  }}
                  title="Click to view vineyard details and zoom"
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isExpanded ? 8 : 0 }}>
                    <div style={{ fontSize: 'var(--type-body-size)', fontWeight: 700, color: isHovered ? UI.hoverAccent : UI.vineyardAccent, transition: 'color 0.15s', flex: 1, paddingRight: 8 }}>{group.name}</div>
                    <span style={{
                      fontSize: 'var(--type-ui-label-size)',
                      color: isHovered ? UI.hoverAccentMuted : UI.vineyardAccentMuted,
                      transition: 'color 0.15s, transform 0.15s',
                      transform: isHovered ? 'scale(1.15)' : 'scale(1)',
                      flexShrink: 0,
                      lineHeight: 1.6,
                    }} title={isExpanded ? 'Expanded' : 'Expand and zoom'}>{isExpanded ? '▾' : '▸'}</span>
                  </div>
                  {isExpanded && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${UI.cardBorder}` }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div><div style={LBL}>Blocks</div><div style={VAL}>{blockCount}</div></div>
                        {acres && <div><div style={LBL}>Acres</div><div style={VAL}>{acres} ac</div></div>}
                        {ava && <div><div style={LBL}>AVA</div><div style={VAL}>{ava}</div></div>}
                      </div>

                      {groupTopoStats && (
                        <div style={{ marginTop: 8, paddingTop: 7, borderTop: `1px solid ${UI.subtleDivider}`, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          {groupTopoStats.elev_min != null && groupTopoStats.elev_max != null && (
                            <span style={{ fontSize: 'var(--type-ui-label-size)', color: UI.faintText, display: 'flex', alignItems: 'center', gap: 3 }}>
                              <span style={{ opacity: 0.6 }}>↑</span>
                              {Math.round(groupTopoStats.elev_min)}–{Math.round(groupTopoStats.elev_max)} ft
                            </span>
                          )}
                          {(groupTopoStats.slope_p10 != null && groupTopoStats.slope_p90 != null
                            ? true
                            : groupTopoStats.slope_mean != null) && (
                            <span style={{ fontSize: 'var(--type-ui-label-size)', color: UI.faintText, display: 'flex', alignItems: 'center', gap: 3 }}>
                              <span style={{ opacity: 0.6 }}>⊿</span>
                              {groupTopoStats.slope_p10 != null && groupTopoStats.slope_p90 != null
                                ? `${groupTopoStats.slope_p10.toFixed(1)}–${groupTopoStats.slope_p90.toFixed(1)}° slope`
                                : `${groupTopoStats.slope_mean.toFixed(1)}° slope`}
                            </span>
                          )}
                          {groupTopoStats.aspect_label && groupTopoStats.aspect_label !== 'Flat' && (
                            <span style={{ fontSize: 'var(--type-ui-label-size)', color: UI.faintText, display: 'flex', alignItems: 'center', gap: 3 }}>
                              <span style={{ opacity: 0.6 }}>◎</span>
                              {groupTopoStats.aspect_label}
                            </span>
                          )}
                        </div>
                      )}

                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {blockRows.length > 0 ? (
                          blockRows.map((b, bi) => (
                            <div
                              key={`${b.name || 'block'}-${bi}`}
                              style={{
                                border: `1px solid ${UI.blockBorder}`,
                                borderRadius: 6,
                                padding: '7px 8px',
                                background: UI.blockBg,
                              }}
                            >
                              <div style={{ fontSize: 'var(--type-ui-label-size)', fontWeight: 700, color: UI.cardTextStrong }}>{b.name || `Block ${bi + 1}`}</div>
                              <div style={{ fontSize: 'var(--type-ui-label-size)', color: UI.bodyText, marginTop: 2 }}>
                                {[
                                  b.varieties.size > 0 ? Array.from(b.varieties).slice(0, 2).join(', ') : null,
                                  b.clones.size > 0 ? `Clones: ${Array.from(b.clones).slice(0, 2).join(', ')}` : null,
                                  b.acres.length > 0 ? `${Math.max(...b.acres).toFixed(2)} ac` : null,
                                ].filter(Boolean).join(' • ') || 'Block details available'}
                              </div>
                            </div>
                          ))
                        ) : (
                          group.features.map((feature, fi) => {
                            const p = feature.properties || {};
                            const fAcresRaw = p.Acres ?? p.VA0_TotalVineAcres;
                            const fAcres = Number.isFinite(Number(fAcresRaw)) ? `${Number(fAcresRaw).toFixed(1)} ac` : null;
                            return (
                              <button
                                key={`feature-${fi}`}
                                onMouseEnter={(e) => {
                                  e.stopPropagation();
                                  onVineyardHover?.(feature);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onViewAllVineyards?.([feature]);
                                }}
                                style={{
                                  textAlign: 'left',
                                  border: `1px solid ${UI.blockBorder}`,
                                  borderRadius: 6,
                                  padding: '7px 8px',
                                  background: UI.blockBg,
                                  color: UI.valueText,
                                  fontSize: 'var(--type-ui-label-size)',
                                  cursor: 'pointer',
                                }}
                                title="Zoom to this block footprint"
                              >
                                <div style={{ fontWeight: 700 }}>Block {fi + 1}</div>
                                <div style={{ marginTop: 2, fontSize: 'var(--type-ui-label-size)', color: UI.bodyText }}>{fAcres || 'No acreage'} • Click to zoom</div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Layer tab (imports from LayerDetailPanel's data) ─────────────────── */
const LAYER_INFO_FULL = {
  tdmean:    { why: 'Average daily mean temperature from PRISM 30-year normals (1991–2020). This helps understand the thermal character of each growing region across different months.', source: 'PRISM Climate Group, Oregon State University', period: '30-year normals (1991–2020)' },
  elevation: { why: 'Height above sea level. Higher-elevation vineyards experience cooler temperatures, more wind exposure, and often better drainage — all factors that influence grape quality.', source: 'USGS Digital Elevation Model', period: 'Static terrain data' },
  slope:     { why: 'Steepness of terrain in degrees. Slopes between 5–15° are generally ideal for viticulture, providing good drainage and sun exposure.', source: 'Derived from USGS DEM', period: 'Static terrain data' },
  aspect:    { why: 'The compass direction a slope faces. South- and southwest-facing slopes receive more sunlight in the Northern Hemisphere, producing warmer and more sun-exposed microclimates.', source: 'Derived from USGS DEM', period: 'Static terrain data' },
};

// audit-ignore-start centralized-colormap-gradients
const COLORMAP_GRADIENTS = {
  terrain:  'linear-gradient(to right, #0B6623, #90EE90, #F5F5DC, #D2B48C, #8B4513, #FFFFFF)',
  rdylgn_r: 'linear-gradient(to right, #1A9850, #91CF60, #D9EF8B, #FEE08B, #FC8D59, #D73027)',
  hsv:      'linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)',
  plasma:   'linear-gradient(to right, #0D0887, #7E03A8, #CC4778, #F89441, #F0F921)',
};
// audit-ignore-end centralized-colormap-gradients

function LayerTabContent({ activeLayer, topoStats }) {
  const info = LAYER_INFO_FULL[activeLayer];
  if (!info) return null;

  const topoConfig = TOPO_LAYER_TYPES[activeLayer];

  const CARD = { background: UI.cardBg, border: `1px solid ${UI.cardBorder}`, borderRadius: 10, padding: '12px 14px', marginBottom: 8 };
  const LBL  = { ...TYPE.uiLabel, color: UI.labelText, marginBottom: 4 };
  const VAL  = { ...TYPE.mono, color: UI.cardTextStrong, lineHeight: 1.55 };
  const fmt  = (v) => typeof v === 'number' ? v.toFixed(1) : '—';

  return (
    <div style={{ padding: '12px 12px 16px' }}>
      <div style={CARD}>
        <p style={{ ...TYPE.body, color: alpha(TOKENS.parchment, 0.55), lineHeight: 1.7, margin: 0 }}>{info.why}</p>
      </div>

      <div style={CARD}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><div style={LBL}>Period</div><div style={VAL}>{info.period}</div></div>
          <div><div style={LBL}>Source</div><div style={{ ...VAL, color: UI.faintText }}>{info.source}</div></div>
        </div>
      </div>

      {topoStats && topoConfig && (() => {
        const { min, max, mean, std } = topoStats;
        const unit = topoConfig.unit ?? '';
        const gradient = COLORMAP_GRADIENTS[topoConfig.colormap] ?? COLORMAP_GRADIENTS.terrain;
        return (
          <div style={CARD}>
            <div style={{ ...LBL, marginBottom: 8 }}>Data Range — Willamette Valley</div>
            <div style={{ height: 10, borderRadius: 6, background: gradient, marginBottom: 4, border: `1px solid ${alpha(TOKENS.parchment, 0.1)}` }} />
            <div style={{ ...TYPE.uiLabel, display: 'flex', justifyContent: 'space-between', color: UI.labelText, marginBottom: 12 }}>
              <span>{fmt(min)}{unit}</span><span>{fmt(max)}{unit}</span>
            </div>
            <TerroirDataChips variant="glass" chips={[
              { label: 'Min',     value: `${fmt(min)}${unit}`,   tone: 'blue',      glow: true  },
              { label: 'Max',     value: `${fmt(max)}${unit}`,   tone: 'amber',     glow: true  },
              { label: 'Mean',    value: `${fmt(mean)}${unit}`,  tone: 'green',     glow: true  },
              { label: 'Std Dev', value: `±${fmt(std)}${unit}`,   tone: 'parchment', glow: false },
            ]} />
          </div>
        );
      })()}

      {!topoStats && topoConfig && (
        <div style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${UI.spinnerBorder}`, borderTopColor: UI.spinnerTop, animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          <span style={{ ...TYPE.uiLabel, color: UI.labelText }}>Loading data range…</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </div>
  );
}

function DevLayerPanel({
  devPanelOpen,
  onTogglePanelOpen,
  devLayerToggles,
  onToggleLayer,
  onReset,
  listingSymbologyPreset,
  onListingSymbologyPresetChange,
}) {
  const panelRef = useRef(null);
  const dragRef = useRef({
    dragging: false,
    offsetX: 0,
    offsetY: 0,
  });
  const [position, setPosition] = useState({ top: 16, left: 16 });
  const [isDragging, setIsDragging] = useState(false);

  const beginDrag = useCallback((event) => {
    if (event.button !== 0) return;
    dragRef.current.dragging = true;
    dragRef.current.offsetX = event.clientX - position.left;
    dragRef.current.offsetY = event.clientY - position.top;
    setIsDragging(true);
    event.preventDefault();
  }, [position.left, position.top]);

  useEffect(() => {
    const onMove = (event) => {
      if (!dragRef.current.dragging) return;

      const panelWidth = panelRef.current?.offsetWidth ?? (devPanelOpen ? 250 : 136);
      const panelHeight = panelRef.current?.offsetHeight ?? 44;
      const nextLeft = event.clientX - dragRef.current.offsetX;
      const nextTop = event.clientY - dragRef.current.offsetY;

      const minLeft = 8;
      const minTop = 8;
      const maxLeft = Math.max(minLeft, window.innerWidth - panelWidth - 8);
      const maxTop = Math.max(minTop, window.innerHeight - panelHeight - 8);

      setPosition({
        left: Math.min(Math.max(nextLeft, minLeft), maxLeft),
        top: Math.min(Math.max(nextTop, minTop), maxTop),
      });
    };

    const endDrag = () => {
      if (!dragRef.current.dragging) return;
      dragRef.current.dragging = false;
      setIsDragging(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', endDrag);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', endDrag);
    };
  }, [devPanelOpen]);

  const groupStyle = {
    background: UI.devGroupBg,
    border: `1px solid ${UI.devGroupBorder}`,
    borderRadius: 10,
    padding: '8px 10px',
    marginBottom: 8,
  };

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    fontSize: 'var(--type-ui-label-size)',
    color: alpha(TOKENS.parchment, 0.88),
    gap: 10,
  };

  const ToggleRow = ({ label, keyName }) => (
    <label style={rowStyle}>
      <span>{label}</span>
      <input
        type="checkbox"
        checked={!!devLayerToggles[keyName]}
        onChange={() => onToggleLayer(keyName)}
        style={{ cursor: 'pointer' }}
      />
    </label>
  );

  return (
    <div ref={panelRef} style={{
      position: 'absolute',
      top: position.top,
      left: position.left,
      zIndex: 55,
      width: devPanelOpen ? 250 : 136,
      background: UI.devPanelBg,
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      border: `1px solid ${UI.devPanelBorder}`,
      borderRadius: 12,
      boxShadow: `0 10px 30px ${UI.devPanelShadow}`,
      color: UI.devPanelText,
      fontFamily: 'var(--font-sans)',
      overflow: 'hidden',
    }}>
      <div
        onMouseDown={beginDrag}
        style={{
        padding: '8px 10px',
        borderBottom: devPanelOpen ? `1px solid ${UI.devHeaderBorder}` : 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}>
        <span style={{ ...TYPE.uiLabel, fontWeight: 800 }}>DEV LAYERS {devPanelOpen ? ':: DRAG' : ''}</span>
        <button
          onClick={onTogglePanelOpen}
          onMouseDown={(event) => event.stopPropagation()}
          style={{
            background: 'transparent',
            border: `1px solid ${UI.devButtonBorder}`,
            color: UI.devButtonText,
            borderRadius: 6,
            cursor: 'pointer',
            ...TYPE.uiLabel,
            fontWeight: 700,
            padding: '3px 6px',
          }}
        >
          {devPanelOpen ? 'Minimize' : 'Expand'}
        </button>
      </div>

      {devPanelOpen && (
        <div style={{ padding: 10, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}>
          <div style={groupStyle}>
            <div style={{ ...TYPE.uiLabel, opacity: 0.75, marginBottom: 6 }}>BASE</div>
            <ToggleRow label="WV Mask" keyName="wvMask" />
            <ToggleRow label="WV Boundary" keyName="wvBoundary" />
            <ToggleRow label="AVA Boundaries + Labels" keyName="avaBoundaries" />
          </div>

          <div style={groupStyle}>
            <div style={{ ...TYPE.uiLabel, opacity: 0.75, marginBottom: 6 }}>VINEYARDS</div>
            <ToggleRow label="Dundee/Chehalem Ref" keyName="vineyardsDundeeChehalem" />
            <ToggleRow label="Yamhill-Carlton Ref" keyName="vineyardsYC" />
            <ToggleRow label="Adelsheim Ref (white)" keyName="vineyardsAdelsheimReference" />
            <ToggleRow label="Linked Wineries (green)" keyName="vineyardsLinked" />
            <ToggleRow label="Selection/Hover Highlights" keyName="vineyardHighlights" />
          </div>

          <div style={groupStyle}>
            <div style={{ ...TYPE.uiLabel, opacity: 0.75, marginBottom: 6 }}>OTHER</div>
            <ToggleRow label="Winery Markers" keyName="wineries" />
            <ToggleRow label="Climate Raster" keyName="climate" />
            <ToggleRow label="Topography Raster" keyName="topography" />
          </div>

          <button
            onClick={onReset}
            style={{
              width: '100%',
              background: UI.devResetBg,
              border: `1px solid ${UI.devPanelBorder}`,
              borderRadius: 8,
              color: UI.devResetText,
              ...TYPE.uiLabel,
              fontWeight: 700,
              cursor: 'pointer',
              padding: '7px 8px',
            }}
          >
            Reset All On
          </button>
        </div>
      )}
    </div>
  );
}

const WVWAMap = forwardRef(function WVWAMap({
  selectedAva, onSelectAva, onMarkerClick, panelHoveredAva, onPanelHoverAva,
  // Lifted / controlled state
  selectedListing:   selectedListingProp,
  onListingSelect,
  activeLayer:       activeLayerProp,
  onLayerChange:     onActiveLayerChangeProp,
  currentMonth:      currentMonthProp,
  onMonthChange,
  listingFilterMode: listingFilterModeProp,
  onListingFilterModeChange,
  listingSymbologyPreset: listingSymbologyPresetProp,
  onListingSymbologyPresetChange,
  // Push-only callbacks (WVWAMap notifies parent of derived state)
  onListingsLoaded,
  onTopoStatsChange,
  onParcelTopoStatsChange,
  onSelectedVineyardsChange,
  onInsideIdsChange,
  onVineyardRecidSetChange,
  onMapReady,
}, externalRef) {
  const mapContainerRef = useRef(null);
  const mapRef          = useRef(null);
  const popupRef        = useRef(null);
  const vineyardPopupRef = useRef(null);
  const avaDataRef      = useRef({});

  // Internal state — kept for backwards-compat when no props provided
  const [listings, setListings]         = useState([]);
  const [mapLoaded, setMapLoaded]       = useState(false);
  const [introComplete, setIntroComplete] = useState(false);
  const [markersVisible, setMarkersVisible] = useState(false);
  const [topoStats, setTopoStats]       = useState(null);
  const [hoveredAva, setHoveredAva]     = useState(null);
  const [hoveredVineyardOrganization, setHoveredVineyardOrganization] = useState(null);
  const [selectedListing, setSelectedListing] = useState(null);
  const [hoveredListing, setHoveredListing] = useState(null);
  const [selectedVineyards, setSelectedVineyards] = useState([]);
  const [parcelTopoStats, setParcelTopoStats] = useState({});
  const [vineyardFocusMode, setVineyardFocusMode] = useState(false);
  const [listingFilterMode, setListingFilterMode] = useState(LISTING_FILTER_MODES.allWineries);
  const [listingSymbologyPreset, setListingSymbologyPreset] = useState(DEFAULT_LISTING_SYMBOLOGY);
  const [vineyardRecidSet, setVineyardRecidSet] = useState(() => new Set());
  const [insideIds, setInsideIds] = useState(null);
  const [activeLayer, setActiveLayer]   = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [devPanelOpen, setDevPanelOpen] = useState(true);
  const [devLayerToggles, setDevLayerToggles] = useState(DEV_LAYER_DEFAULTS);

  // When controlled props are provided, sync internal state to them
  // so all existing useEffects continue to work unchanged.
  useEffect(() => { if (selectedListingProp !== undefined) setSelectedListing(selectedListingProp); }, [selectedListingProp]);
  useEffect(() => { if (activeLayerProp !== undefined) setActiveLayer(activeLayerProp); }, [activeLayerProp]);
  useEffect(() => { if (currentMonthProp !== undefined) setCurrentMonth(currentMonthProp); }, [currentMonthProp]);
  useEffect(() => { if (listingFilterModeProp !== undefined) setListingFilterMode(listingFilterModeProp); }, [listingFilterModeProp]);
  useEffect(() => { if (listingSymbologyPresetProp !== undefined) setListingSymbologyPreset(listingSymbologyPresetProp); }, [listingSymbologyPresetProp]);

  // Push derived state up to the parent whenever it changes
  useEffect(() => { onListingsLoaded?.(listings); }, [listings]);          // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onTopoStatsChange?.(topoStats); }, [topoStats]);       // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onParcelTopoStatsChange?.(parcelTopoStats); }, [parcelTopoStats]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onSelectedVineyardsChange?.(selectedVineyards); }, [selectedVineyards]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onInsideIdsChange?.(insideIds); }, [insideIds]);       // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onVineyardRecidSetChange?.(vineyardRecidSet); }, [vineyardRecidSet]); // eslint-disable-line react-hooks/exhaustive-deps

  const rotationAnimRef        = useRef(null);
  const listingsRef           = useRef([]);
  const missingParcelTopoStatsIdsRef = useRef(new Set());
  const selectedListingRef    = useRef(null);
  const setSelectedListingRef = useRef(null); // stable ref to the setter
  const setHoveredListingRef  = useRef(null); // stable ref for map closure hover
  const selectedAvaRef        = useRef(selectedAva);  // always-current read in imperative callbacks
  const panelHoveredAvaRef    = useRef(null);
  const basemapLabelLayerIdsRef = useRef([]);

  // Expose imperative methods for the SearchBar (and any external consumer)
  useImperativeHandle(externalRef, () => ({
    startEntranceAnimation() {
      // Stop globe rotation
      if (rotationAnimRef.current) {
        cancelAnimationFrame(rotationAnimRef.current);
        rotationAnimRef.current = null;
      }
      const map = mapRef.current;
      if (!map) return;

      // Fade out wine region callouts via paint opacity transition
      if (map.getLayer('wine-region-dots')) {
        map.setPaintProperty('wine-region-dots', 'circle-opacity-transition', { duration: 450 });
        map.setPaintProperty('wine-region-dots', 'circle-opacity', 0);
      }
      if (map.getLayer('wine-region-labels')) {
        map.setPaintProperty('wine-region-labels', 'text-opacity-transition', { duration: 450 });
        map.setPaintProperty('wine-region-labels', 'text-opacity', 0);
      }
      if (map.getLayer('wine-region-leader-lines')) {
        map.setPaintProperty('wine-region-leader-lines', 'line-opacity-transition', { duration: 450 });
        map.setPaintProperty('wine-region-leader-lines', 'line-opacity', 0);
      }

      // ── Two-leg cinematic entrance: globe → Oregon → Willamette Valley ──
      flyToIntro(map, {
        onComplete: () => { setIntroComplete(true); setMarkersVisible(true); },
      });
    },
    /**
     * Dev-only fast path: jump straight to the Willamette Valley camera
     * without playing the rotating-globe → Oregon → WV cinematic sequence.
     * Used when ?skipIntro=1 is in the URL or when sessionStorage indicates
     * the user has already seen the intro this tab session.
     */
    skipEntranceAnimation() {
      if (rotationAnimRef.current) {
        cancelAnimationFrame(rotationAnimRef.current);
        rotationAnimRef.current = null;
      }
      const map = mapRef.current;
      if (!map) return;
      // Hide entrance callouts immediately (no fade)
      for (const layerId of ['wine-region-dots', 'wine-region-labels', 'wine-region-leader-lines']) {
        if (map.getLayer(layerId)) {
          const prop = layerId === 'wine-region-labels' ? 'text-opacity' : (layerId === 'wine-region-leader-lines' ? 'line-opacity' : 'circle-opacity');
          map.setPaintProperty(layerId, prop, 0);
        }
      }
      map.jumpTo({
        center:  [WV_CAMERA.lng, WV_CAMERA.lat],
        zoom:    WV_CAMERA.zoom,
        pitch:   WV_CAMERA.pitch,
        bearing: WV_CAMERA.bearing,
      });
      setIntroComplete(true);
      setMarkersVisible(true);
    },
    clearSelectedListing() {
      setSelectedListingRef.current?.(null);
      setHoveredListingRef.current?.(null);
      // Imperatively reset soft focus now rather than waiting for a React effect cycle,
      // so the map never stays muted after returning to AVA detail.
      const map = mapRef.current;
      if (map && map.isStyleLoaded?.()) {
        setVineyardReferenceSoftFocus(map, false);
        setListingSoftFocus(map, false);
      }
    },
    flyToAva(slug) {
      flyToAva(mapRef.current, slug);
    },
    selectListingById(id) {
      const listing = listingsRef.current.find((l) => l.id === id);
      if (!listing) return;
      setSelectedListingRef.current?.(listing);
      const map = mapRef.current;
      if (!map) return;

      // Eagerly populate the vineyard source so it is ready before moveend fires,
      // regardless of when React's useEffect runs.
      const vineyardFeatures = VINEYARD_BY_RECID[listing.id] ?? [];
      const vineyardsSrc = map.getSource('vineyards-selected');
      if (vineyardsSrc) {
        vineyardsSrc.setData({ type: 'FeatureCollection', features: vineyardFeatures });
        normalizeOverlayAndLabelOrder(map, basemapLabelLayerIdsRef.current);
      }

      if (!flyToVineyardBounds(map, vineyardFeatures)) {
        flyToCoords(map, { lng: listing.lng, lat: listing.lat });
      }
      map.once('moveend', () => {
        const BLINK = [
          { delay:   0, value: 1.0 },
          { delay: 180, value: 0.08 },
          { delay: 340, value: 1.0 },
          { delay: 520, value: 0.08 },
          { delay: 680, value: 1.0 },
          { delay: 860, value: 0.5 },  // settle at normal
        ];
        // Marker dot blink
        blinkMapLayer(map, 'listings-selected-glow', 'circle-stroke-opacity', BLINK);
        blinkMapLayer(map, 'listings-selected-dot',  'circle-opacity', BLINK);
        // Vineyard polygon blink — always attempt; no-op if source is empty
        if (map.getLayer('vineyards-selected-fill'))
          map.setLayoutProperty('vineyards-selected-fill', 'visibility', 'visible');
        if (map.getLayer('vineyards-selected-line'))
          map.setLayoutProperty('vineyards-selected-line', 'visibility', 'visible');
        const VINE_FILL = [
          { delay:   0, value: 0.85 },
          { delay: 200, value: 0.04 },
          { delay: 380, value: 0.85 },
          { delay: 560, value: 0.04 },
          { delay: 740, value: 0.85 },
          { delay: 920, value: 0.2  },  // settle at layer default
        ];
        const VINE_LINE = [
          { delay:   0, value: 1.0 },
          { delay: 200, value: 0.06 },
          { delay: 380, value: 1.0 },
          { delay: 560, value: 0.06 },
          { delay: 740, value: 1.0 },
          { delay: 920, value: 0.9 },  // settle at layer default
        ];
        blinkMapLayer(map, 'vineyards-selected-fill', 'fill-opacity', VINE_FILL);
        blinkMapLayer(map, 'vineyards-selected-line', 'line-opacity', VINE_LINE);
      });
    },
    selectVineyardByName(name, { lng, lat }) {
      const map = mapRef.current;
      if (!map) return;
      const key = (name || '').trim().toLowerCase();
      const features = VINEYARD_ALL_BY_NAME[key] ?? [];
      // Linked = parcels with a winery association → green selected style
      // Unlinked = reference-only parcels → white passive-hover style
      const isLinked = features.some(f => f?.properties?.winery_recid != null);

      if (isLinked) {
        const src = map.getSource('vineyards-selected');
        if (src) {
          src.setData({ type: 'FeatureCollection', features });
          normalizeOverlayAndLabelOrder(map, basemapLabelLayerIdsRef.current);
        }
        if (!flyToVineyardBounds(map, features)) {
          flyToCoords(map, { lng, lat });
        }
        map.once('moveend', () => {
          if (map.getLayer('vineyards-selected-fill'))
            map.setLayoutProperty('vineyards-selected-fill', 'visibility', 'visible');
          if (map.getLayer('vineyards-selected-line'))
            map.setLayoutProperty('vineyards-selected-line', 'visibility', 'visible');
          const VINE_FILL = [
            { delay:   0, value: 0.85 },
            { delay: 200, value: 0.04 },
            { delay: 380, value: 0.85 },
            { delay: 560, value: 0.04 },
            { delay: 740, value: 0.85 },
            { delay: 920, value: 0.2  },
          ];
          const VINE_LINE = [
            { delay:   0, value: 1.0 },
            { delay: 200, value: 0.06 },
            { delay: 380, value: 1.0 },
            { delay: 560, value: 0.06 },
            { delay: 740, value: 1.0 },
            { delay: 920, value: 0.9 },
          ];
          blinkMapLayer(map, 'vineyards-selected-fill', 'fill-opacity', VINE_FILL);
          blinkMapLayer(map, 'vineyards-selected-line', 'line-opacity', VINE_LINE);
        });
      } else {
        // Non-selectable vineyard: white outline blink matching the passive hover style
        const src = map.getSource('vineyards-passive-hover');
        if (src) {
          src.setData({ type: 'FeatureCollection', features });
          normalizeOverlayAndLabelOrder(map, basemapLabelLayerIdsRef.current);
        }
        if (!flyToVineyardBounds(map, features)) {
          flyToCoords(map, { lng, lat });
        }
        map.once('moveend', () => {
          const WHITE_LINE = [
            { delay:   0, value: 1.0 },
            { delay: 200, value: 0.06 },
            { delay: 380, value: 1.0 },
            { delay: 560, value: 0.06 },
            { delay: 740, value: 1.0 },
            { delay: 920, value: 0.0 },  // fade out — no persistent selected state
          ];
          blinkMapLayer(map, 'vineyards-passive-hover-line', 'line-opacity', WHITE_LINE);
          // Clear the source after the blink finishes and restore default opacity
          setTimeout(() => {
            const passiveSrc = map.getSource('vineyards-passive-hover');
            if (passiveSrc) passiveSrc.setData({ type: 'FeatureCollection', features: [] });
            if (map.getLayer('vineyards-passive-hover-line'))
              map.setPaintProperty('vineyards-passive-hover-line', 'line-opacity', 0.7);
          }, 1050);
        });
      }
    },
    flyToCoords({ lng, lat, zoom = 14 }) {
      flyToCoords(mapRef.current, { lng, lat, zoom });
    },
    // Called by ExplorerSidebar's onVineyardHover to highlight parcels on map
    hoverVineyards(features) {
      const map = mapRef.current;
      if (!map) return;
      const src = map.getSource('vineyards-hovered');
      if (src) {
        src.setData({ type: 'FeatureCollection', features: features || [] });
        normalizeOverlayAndLabelOrder(map, basemapLabelLayerIdsRef.current);
      }
    },
    // Called by ExplorerSidebar's onViewAllVineyards to zoom to parcel bounds
    viewAllVineyards(features) {
      const map = mapRef.current;
      if (!map || !features?.length) return;
      setVineyardFocusMode(true);

      const bounds = getVineyardFeatureBounds(features);
      if (!bounds) return;

      const isSingle = features.length === 1;
      map.fitBounds(bounds, {
        padding: { top: 80, bottom: 80, left: 60, right: 60 },
        maxZoom: isSingle ? 16.2 : 14.8,
        pitch: 40,
        curve: 1.4,
        speed: 0.55,
        essential: true,
      });
    },
    hoverAva(slug) {
      const map = mapRef.current;
      if (!map) return;
      const src = map.getSource('ava-hover');
      if (!src) return;
      if (!slug) { src.setData({ type: 'FeatureCollection', features: [] }); return; }
      const data = avaDataRef.current[slug];
      if (data) src.setData(data);
    },
    hoverListing(listing) {
      setHoveredListingRef.current?.(listing);
    },
  }), []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Keep selectedListingRef in sync so map click handlers can update state.
  // Also notifies parent (sidebar) via onListingSelect when provided.
  const setSelectedListingBoth = useCallback((listing) => {
    selectedListingRef.current = listing;
    setSelectedListing(listing);
    onListingSelect?.(listing);
  }, [onListingSelect]); // eslint-disable-line react-hooks/exhaustive-deps

  // Store the setter in a ref so the map's [] effect closure can call it
  useEffect(() => { setSelectedListingRef.current = setSelectedListingBoth; }, [setSelectedListingBoth]);

  // Keep selectedAvaRef current so the imperative hover handler always reads the latest value
  useEffect(() => { selectedAvaRef.current = selectedAva; }, [selectedAva]);

  // ── Panel hover: swap dedicated highlight source — no moveLayer, no setPaintProperty ──
  const handleMapHoverAva = useCallback((slug) => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('ava-hover');
    if (!src) return;
    if (!slug) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const data = avaDataRef.current[slug];
    if (data) src.setData(data);
  }, []);

  // ── Vineyard card hover → highlight one or more parcels on the map ─────
  const onVineyardHover = useCallback((featureOrFeatures) => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('vineyards-hovered');
    if (!src) return;
    const features = Array.isArray(featureOrFeatures)
      ? featureOrFeatures
      : (featureOrFeatures ? [featureOrFeatures] : []);
    src.setData({
      type: 'FeatureCollection',
      features,
    });
  }, []);

  // ── "View All Vineyards" → fit map to combined bbox of every parcel ──
  const onViewAllVineyards = useCallback((features) => {
    const map = mapRef.current;
    if (!map || !features?.length) return;
    setVineyardFocusMode(true);

    const bounds = getVineyardFeatureBounds(features);
    if (!bounds) return;

    const isSingleFeature = features.length === 1;

    map.fitBounds(
      bounds,
      {
        padding: { top: 80, bottom: 80, left: 60, right: 60 },
        maxZoom: isSingleFeature ? 16.2 : 14.8,
        pitch: 40,
        curve: 1.4,
        speed: 0.55,
        essential: true,
      }
    );
  }, []);

  // Refs to share current filter state with map effects without stale closures
  const insideIdsRef = useRef(null);

  useEffect(() => {
    if (!selectedListing) setVineyardFocusMode(false);
  }, [selectedListing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (!map.getStyle?.() || !map.isStyleLoaded?.()) return;
    // Keep markers explorable in both modes; use soft-focus instead of full hide.
    setListingVisibilityForVineyardFocus(map, false);
    setListingVisibilityForIntro(map, markersVisible);
    setListingVisualizationVisibility(
      map,
      markersVisible && listingFilterMode !== LISTING_FILTER_MODES.noWineriesVisualized,
    );
    setListingSoftFocus(map, !!selectedListing);
    setVineyardVisualizationVisibility(map, listingFilterMode !== LISTING_FILTER_MODES.noVineyardsVisualized);
    setVineyardReferenceSoftFocus(map, !!selectedListing);
  }, [selectedListing, mapLoaded, introComplete, markersVisible, listingFilterMode]);
  const listingFilterModeRef = useRef(LISTING_FILTER_MODES.allWineries);
  const vineyardRecidSetRef = useRef(new Set());

  // Keep filter refs in sync with state
  useEffect(() => {
    listingFilterModeRef.current = listingFilterMode;
  }, [listingFilterMode]);

  useEffect(() => {
    vineyardRecidSetRef.current = vineyardRecidSet;
  }, [vineyardRecidSet]);

  // Keep listingsRef in sync so map event handler closures can access current listings
  useEffect(() => {
    listingsRef.current = listings;
    // If the map and listings source are ready, refresh the cluster source
    const map = mapRef.current;
    if (map && mapLoaded && map.getSource('listings')) {
      map.getSource('listings').setData(
        buildListingsGeoJSON(listings, listingFilterModeRef.current, vineyardRecidSetRef.current, insideIdsRef.current)
      );
    }
  }, [listings, mapLoaded]);

  // Fetch wineries from API on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/wineries`, { headers: API_HEADERS })
      .then(async (r) => {
        const text = await r.text();
        let parsed;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }

        if (!r.ok) {
          const serverMsg = parsed?.error || parsed?.message || text || `HTTP ${r.status}`;
          throw new Error(`Wineries API request failed (${r.status}): ${serverMsg}`);
        }

        if (!parsed || !Array.isArray(parsed.features)) {
          throw new Error('Wineries API returned an unexpected response shape');
        }

        return parsed;
      })
      .then(fc => {
        const loaded = fc.features.map((f, i) => ({
          id:        f.properties.recid,
          num:       i + 1,
          title:     f.properties.title,
          desc:      f.properties.description || '',
          phone:     f.properties.phone || '',
          url:       f.properties.url || '',
          image_url: f.properties.image_url || '',
          lng:       f.geometry.coordinates[0],
          lat:       f.geometry.coordinates[1],
          category:  f.properties.category || 'winery',
        }));
        setListings(loaded);
      })
      .catch(err => console.error('WVWAMap: failed to load wineries from API', err));
  }, []);

  const activeFilterLabel = useMemo(() => {
    if (listingFilterMode === LISTING_FILTER_MODES.withVineyardPolygons) {
      return 'Wineries with Vineyard Polygons';
    }
    if (listingFilterMode === LISTING_FILTER_MODES.withoutVineyardPolygons) {
      return 'Wineries without Vineyard Polygons';
    }
    if (listingFilterMode === LISTING_FILTER_MODES.noVineyardsVisualized) {
      return 'No Vineyards Visualized';
    }
    if (listingFilterMode === LISTING_FILTER_MODES.noWineriesVisualized) {
      return 'No Wineries Visualized';
    }
    return 'All Wineries & Vineyards';
  }, [listingFilterMode]);

  // ── Sync hovered-listing source with hoveredListing state ────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const src = map.getSource('hovered-listing');
    if (!src) return;
    if (!hoveredListing) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const presetColor = getListingSymbologyConfig(listingSymbologyPreset).markerFillColor;
    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [hoveredListing.lng, hoveredListing.lat] },
        properties: { color: presetColor, num: String(hoveredListing.num) },
      }],
    });
  }, [hoveredListing, mapLoaded, listingSymbologyPreset]);

  // ── Sync selected-listing source with selectedListing state ──────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const src = map.getSource('selected-listing');
    if (!src) return;
    if (!selectedListing) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const cat = LISTING_CATEGORIES[selectedListing.category];
    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [selectedListing.lng, selectedListing.lat] },
        properties: { color: cat.color, num: String(selectedListing.num) },
      }],
    });
  }, [selectedListing, mapLoaded]);

  // ── Sync vineyard highlight source with selectedListing state ─────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const src = map.getSource('vineyards-selected');
    if (!src) return;

    if (!selectedListing) {
      src.setData({ type: 'FeatureCollection', features: [] });
      setSelectedVineyards([]);
      return;
    }

    const features = VINEYARD_BY_RECID[selectedListing.id] ?? [];
    setSelectedVineyards(features);
    src.setData({ type: 'FeatureCollection', features });

    // Keep selected parcel layers on top
    normalizeOverlayAndLabelOrder(map, basemapLabelLayerIdsRef.current);
  }, [selectedListing, mapLoaded]);

  // ── Fetch 1m LiDAR topo stats for each selected parcel ───────────────
  useEffect(() => {
    if (!selectedVineyards.length) {
      setParcelTopoStats({});
      return;
    }
    const ids = [...new Set(selectedVineyards.map(f => f.properties?.id).filter(Boolean))]
      .filter((id) => !missingParcelTopoStatsIdsRef.current.has(id));
    if (!ids.length) return;

    Promise.all(
      ids.map(id =>
        fetch(`${API_BASE}/api/vineyards/parcels/${id}/topo-stats`, { headers: API_HEADERS })
          .then((r) => {
            if (r.status === 404) {
              missingParcelTopoStatsIdsRef.current.add(id);
              return null;
            }
            return r.ok ? r.json() : null;
          })
          .catch(() => null)
      )
    ).then(results => {
      const stats = {};
      results.forEach(r => { if (r?.parcel_id && r?.topo) stats[r.parcel_id] = r.topo; });
      setParcelTopoStats(stats);
    });
  }, [selectedVineyards]);

  const isClimateActive = activeLayer === 'tdmean';
  const isTopoActive    = ['elevation', 'slope', 'aspect'].includes(activeLayer);

  // ── Map initialization ────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [-90, 20],
      zoom: 1.8,
      pitch: 0,
      bearing: 0,
      minPitch: 0,
      maxPitch: 85,
      projection: { type: 'globe' },
    });

    // Compass is rendered by the custom MapControls component

    map.on('load', async () => {
      basemapLabelLayerIdsRef.current = (map.getStyle()?.layers || [])
        .filter((layer) => layer.type === 'symbol')
        .map((layer) => layer.id);

      // 3D terrain
      map.addSource('terrainSource', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
      });
      map.setTerrain({ source: 'terrainSource', exaggeration: 2.0 });
      map.setMaxPitch(71);

      // Space background + atmospheric halo for globe projection
      // setFog was removed in MapLibre GL JS v5 — guard to avoid TypeError
      if (typeof map.setFog === 'function') {
        try {
          // audit-ignore-start globe-fog-colors
          map.setFog({
            'space-color': '#000000',
            'star-intensity': 0.0,
            'color': 'rgba(30, 60, 120, 0.6)',
            'high-color': 'rgba(10, 30, 80, 0.8)',
            'horizon-blend': 0.08,
          });
          // audit-ignore-end
        } catch (e) {
          // ignore — unsupported in this MapLibre version
        }
      }

      // ── Globe rotation during entrance screen ──────────────────────────
      // Rotate around Earth's polar axis: keep bearing=0 (north-up) and
      // advance the center longitude westward — prograde (west-to-east) rotation.
      let rotateLng = -90;
      const rotateGlobe = () => {
        rotateLng = ((rotateLng + 0.3 + 180) % 360) - 180;
        map.setCenter([rotateLng, 20]);
        rotationAnimRef.current = requestAnimationFrame(rotateGlobe);
      };
      rotationAnimRef.current = requestAnimationFrame(rotateGlobe);
      onMapReady?.();

      // ── World wine region callouts (Option A — minimal cartographic) ───
      const wineGeoJSON = {
        type: 'FeatureCollection',
        features: WORLD_WINE_REGIONS.map(r => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
          properties: { name: r.name, country: r.country, offset: r.offset, anchor: r.anchor },
        })),
      };
      map.addSource('wine-regions', { type: 'geojson', data: wineGeoJSON });

      // Small white dot at each region
      map.addLayer({
        id: 'wine-region-dots',
        type: 'circle',
        source: 'wine-regions',
        paint: {
          'circle-radius': 3,
          'circle-color': MAP_PARCHMENT,
          'circle-opacity': 0.85,
          'circle-stroke-width': 0,
        },
      });

      // Region name label — per-feature offset and anchor via case expressions
      // so each label floats in a unique diagonal direction to avoid collisions.
      const textOffsetExpr = ['case',
        ...WORLD_WINE_REGIONS.flatMap(r => [['==', ['get', 'id'], r.id], ['literal', r.offset]]),
        ['literal', [1.4, 0]],
      ];
      const textAnchorExpr = ['case',
        ...WORLD_WINE_REGIONS.flatMap(r => [['==', ['get', 'id'], r.id], r.anchor]),
        'left',
      ];
      map.addLayer({
        id: 'wine-region-labels',
        type: 'symbol',
        source: 'wine-regions',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-size': 11,
          'text-anchor': textAnchorExpr,
          'text-offset': textOffsetExpr,
          'text-justify': 'auto',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'symbol-placement': 'point',
        },
        paint: {
          'text-color': MAP_PARCHMENT,
          'text-opacity': 0.9,
          'text-halo-color': 'rgba(0,0,0,0.5)',
          'text-halo-width': 1,
        },
      });

      // Diagonal leader lines — endpoint computed from each region's 2D offset
      const degPerEmX = 2.2; // approximate degrees per em at globe zoom ~1.8
      const degPerEmY = 1.8;
      const lineFeatures = WORLD_WINE_REGIONS.map(r => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [r.lng, r.lat],
            [r.lng + r.offset[0] * degPerEmX * 0.6, r.lat + r.offset[1] * degPerEmY * 0.6],
          ],
        },
        properties: {},
      }));
      map.addSource('wine-region-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: lineFeatures } });
      map.addLayer({
        id: 'wine-region-leader-lines',
        type: 'line',
        source: 'wine-region-lines',
        paint: {
          'line-color': MAP_PARCHMENT,
          'line-opacity': 0.35,
          'line-width': 1,
        },
      }, 'wine-region-dots'); // insert below dots so dots render on top

      // ── Load WV parent boundary ───────────────────────────────────────
      const wvRes = await fetch('/data/willamette_valley.geojson');
      const wvData = await wvRes.json();

      // Build an inverted mask: world bbox with WV polygon cut out as a hole.
      // This darkens everything outside the Willamette Valley.
      const collectRingsForMask = (geojson) => {
        const rings = [];
        const add = (geom) => {
          if (!geom) return;
          if (geom.type === 'Polygon') rings.push(...geom.coordinates);
          else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(p => rings.push(...p));
        };
        if (geojson.type === 'Feature') add(geojson.geometry);
        else if (geojson.type === 'FeatureCollection') geojson.features.forEach(f => add(f.geometry));
        else add(geojson);
        return rings;
      };
      const wvRings = collectRingsForMask(wvData);
      const worldBbox = [[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]];
      const maskData = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            // First ring = world bbox (outer), subsequent rings = WV holes
            coordinates: [worldBbox, ...wvRings],
          },
          properties: {},
        }],
      };
      map.addSource('wv-mask', { type: 'geojson', data: maskData });
      map.addLayer({
        id: 'wv-mask-fill',
        type: 'fill',
        source: 'wv-mask',
        layout: { visibility: 'none' }, // hidden until intro flyTo completes
        paint: {
          'fill-color': '#1a1a1a',
          'fill-opacity': 0.38,
        },
      });

      map.addSource('wv-boundary', { type: 'geojson', data: wvData });
      // Solid gold border around the entire WV region
      map.addLayer({
        id: 'wv-boundary-line',
        type: 'line',
        source: 'wv-boundary',
        paint: {
          'line-color': '#EDE2D4',
          'line-width': 2.5,
          'line-opacity': 1.0,
        },
      });

      // ── Load vineyard parcels ─────────────────────────────────────────
      try {
        // Fetch Adelsheim parcels from API (replaces the 3.7MB public GeoJSON file)
        const vineyardRes = await fetch(`${API_BASE}/api/vineyards/parcels?dataset=adelsheim`, { headers: API_HEADERS });
        const vineyardRaw = vineyardRes.ok ? await vineyardRes.json() : { features: [] };
        const vineyardFeatures = vineyardRaw?.features || [];

        // Build winery → parcel lookup from the full parcel dataset so selection,
        // grouping, and relinking work consistently across all datasets.
        const parcelLookupRes = await fetch(`${API_BASE}/api/vineyards/parcels`, { headers: API_HEADERS });
        const parcelLookupGeoJSON = parcelLookupRes.ok
          ? await parcelLookupRes.json()
          : { type: 'FeatureCollection', features: [] };

        VINEYARD_BY_RECID = {};
        VINEYARD_ALL_BY_NAME = {};
        for (const feature of parcelLookupGeoJSON.features || []) {
          const recid = feature?.properties?.winery_recid;
          if (recid != null) {
            if (!VINEYARD_BY_RECID[recid]) VINEYARD_BY_RECID[recid] = [];
            VINEYARD_BY_RECID[recid].push(feature);
          }
          const vname = (feature?.properties?.vineyard_name || '').trim().toLowerCase();
          if (vname) {
            if (!VINEYARD_ALL_BY_NAME[vname]) VINEYARD_ALL_BY_NAME[vname] = [];
            VINEYARD_ALL_BY_NAME[vname].push(feature);
          }
        }
        setVineyardRecidSet(new Map(
          Object.entries(VINEYARD_BY_RECID)
            .map(([id, features]) => {
              const numId = Number(id);
              if (!Number.isFinite(numId)) return null;
              // Count unique vineyard groups by name (mirrors WineryDetailView grouping)
              const keys = new Set(features.map((f, i) => {
                const p = f.properties || {};
                const name = (p.vineyard_name || p.Vineyard_Name || p.A1_VineyardName || '').trim();
                return name ? `name:${name.toLowerCase()}` : `block:${i}`;
              }));
              return [numId, keys.size];
            })
            .filter(Boolean)
        ));

        LINKED_VINEYARD_BY_RECID = {};
        for (const feature of vineyardFeatures) {
          const recid = feature?.properties?.winery_recid;
          if (recid != null) {
            if (!LINKED_VINEYARD_BY_RECID[recid]) LINKED_VINEYARD_BY_RECID[recid] = [];
            LINKED_VINEYARD_BY_RECID[recid].push(feature);
          }
        }

        VINEYARD_FEATURES_BY_NAME = {};
        for (const feature of vineyardFeatures) {
          const name = (feature?.properties?.vineyard_name || '').trim().toLowerCase();
          if (name) {
            if (!VINEYARD_FEATURES_BY_NAME[name]) VINEYARD_FEATURES_BY_NAME[name] = [];
            VINEYARD_FEATURES_BY_NAME[name].push(feature);
          }
        }

        // White reference polygons — all three datasets.
        // Production: PMTiles vector tiles via VITE_PMTILES_URL (set in Vercel).
        // Local dev: GeoJSON from the API (no file needed).
        ensureVineyardHatchPattern(map);
        if (PMTILES_URL) {
          map.addSource('vineyards-reference', {
            type: 'vector',
            url: PMTILES_URL,
          });
          map.addLayer({
            id: 'vineyards-reference-fill',
            type: 'fill',
            source: 'vineyards-reference',
            'source-layer': 'vineyard_parcels',
            paint: { 'fill-color': '#EEF5FF', 'fill-opacity': 0.06 },
          });
          map.addLayer({
            id: 'vineyards-reference-line',
            type: 'line',
            source: 'vineyards-reference',
            'source-layer': 'vineyard_parcels',
            paint: { 'line-color': '#C7D6E8', 'line-width': 1.1, 'line-opacity': 0.5 },
          });
          map.addLayer({
            id: 'vineyards-reference-passive-fill',
            type: 'fill',
            source: 'vineyards-reference',
            'source-layer': 'vineyard_parcels',
            paint: { 'fill-color': '#DCE7F3', 'fill-opacity': 0.18 },
          });
          map.addLayer({
            id: 'vineyards-reference-passive-hatch',
            type: 'fill',
            source: 'vineyards-reference',
            'source-layer': 'vineyard_parcels',
            paint: {
              'fill-pattern': VINEYARD_HATCH_PATTERN_ID,
              'fill-opacity': 0.2,
            },
          });
          map.addLayer({
            id: 'vineyards-reference-passive-line',
            type: 'line',
            source: 'vineyards-reference',
            'source-layer': 'vineyard_parcels',
            paint: { 'line-color': '#FFFFFF', 'line-width': 0.85, 'line-opacity': 0.34 },
          });
        } else {
          // GeoJSON fallback: fetch all parcels from the API
          const refRes = await fetch(`${API_BASE}/api/vineyards/parcels`, { headers: API_HEADERS });
          const refGeoJSON = refRes.ok ? await refRes.json() : { type: 'FeatureCollection', features: [] };

          map.addSource('vineyards-reference', {
            type: 'geojson',
            data: refGeoJSON,
          });
          map.addLayer({
            id: 'vineyards-reference-fill',
            type: 'fill',
            source: 'vineyards-reference',
            paint: { 'fill-color': '#EEF5FF', 'fill-opacity': 0.06 },
          });
          map.addLayer({
            id: 'vineyards-reference-line',
            type: 'line',
            source: 'vineyards-reference',
            paint: { 'line-color': '#C7D6E8', 'line-width': 1.1, 'line-opacity': 0.5 },
          });
          map.addLayer({
            id: 'vineyards-reference-passive-fill',
            type: 'fill',
            source: 'vineyards-reference',
            paint: { 'fill-color': '#DCE7F3', 'fill-opacity': 0.18 },
          });
          map.addLayer({
            id: 'vineyards-reference-passive-hatch',
            type: 'fill',
            source: 'vineyards-reference',
            paint: {
              'fill-pattern': VINEYARD_HATCH_PATTERN_ID,
              'fill-opacity': 0.2,
            },
          });
          map.addLayer({
            id: 'vineyards-reference-passive-line',
            type: 'line',
            source: 'vineyards-reference',
            paint: { 'line-color': '#FFFFFF', 'line-width': 0.85, 'line-opacity': 0.34 },
          });
        }

        // Linked Adelsheim polygons rendered in green above the white base.
        // Loaded from API (replaces the nested vineyard_polygons in the public GeoJSON).
        map.addSource('vineyards-linked', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: vineyardFeatures,
          },
        });
        map.addLayer({
          id: 'vineyards-linked-fill',
          type: 'fill',
          source: 'vineyards-linked',
          paint: {
            // Transparent hit-target for pointer interactions on linked parcels only.
            'fill-color': '#22C55E',
            'fill-opacity': 0.03,
          },
        });
        map.addLayer({
          id: 'vineyards-linked-line',
          type: 'line',
          source: 'vineyards-linked',
          paint: {
            'line-color': '#3FAF79',
            'line-width': 1.4,
            'line-opacity': 0.86,
          },
        });

        map.addSource('vineyards-reference-hover', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'vineyards-reference-hover-line',
          type: 'line',
          source: 'vineyards-reference-hover',
          paint: {
            'line-color': '#38BDF8',
            'line-width': 3.0,
            'line-opacity': 1,
          },
        });
        map.addSource('vineyards-passive-hover', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'vineyards-passive-hover-line',
          type: 'line',
          source: 'vineyards-passive-hover',
          paint: {
            'line-color': '#FFFFFF',
            'line-width': 1.8,
            'line-opacity': 0.7,
          },
        });

        // Hover on linked vineyard parcels only.
        map.on('mouseenter', 'vineyards-linked-fill', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mousemove', 'vineyards-linked-fill', (e) => {
          if (!e.features?.length) return;
          const passiveHoverSrc = map.getSource('vineyards-passive-hover');
          if (passiveHoverSrc) {
            passiveHoverSrc.setData({ type: 'FeatureCollection', features: [] });
          }
          const hoveredFeature = e.features[0];
          const hoveredProps = hoveredFeature?.properties || {};
          const wineryRecid = hoveredProps.winery_recid != null
            ? Number(hoveredProps.winery_recid)
            : null;
          const normalizedName = normalizeVineyardName(getVineyardNameFromProperties(hoveredProps));
          const linkedListing = wineryRecid != null
            ? (listingsRef.current.find((l) => l.id === wineryRecid) || null)
            : null;
          // Always highlight all parcels in the same vineyard-name group
          const groupFeatures = normalizedName && VINEYARD_FEATURES_BY_NAME[normalizedName]
            ? VINEYARD_FEATURES_BY_NAME[normalizedName]
            : [{ type: 'Feature', geometry: hoveredFeature.geometry, properties: hoveredProps }];
          onVineyardHover(groupFeatures);
          const org = hoveredProps.vineyard_org || hoveredProps.winery_title || 'Unknown Organization';
          setHoveredVineyardOrganization(linkedListing ? null : org);

          const wineryName = hoveredProps.winery_title || hoveredProps.vineyard_org || 'Unknown Winery';
          const vineyardName = hoveredProps.vineyard_name || hoveredProps.Vineyard_Name || hoveredProps.A1_VineyardName || '';
          const popupHtml = `<div style="
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 8px 12px;
            line-height: 1.4;
            font-size: 13px;
          ">
            <div style="font-weight: 600; color: ${UI.popupLabelColor};">Winery: <span style="font-weight: 400;">${wineryName}</span></div>
            ${vineyardName ? `<div style="font-weight: 600; color: ${UI.popupLabelColor}; margin-top: 2px;">Vineyard: <span style="font-weight: 400;">${vineyardName}</span></div>` : ''}
          </div>`;
          if (!vineyardPopupRef.current) {
            vineyardPopupRef.current = new maplibregl.Popup({
              closeButton: false, closeOnClick: false, offset: 15,
              className: 'vineyard-hover-popup',
            });
          }
          vineyardPopupRef.current.setLngLat(e.lngLat).setHTML(popupHtml).addTo(map);
        });
        map.on('click', 'vineyards-linked-fill', (e) => {
          if (!e.features?.length) return;
          // Remove hover popup on click
          if (vineyardPopupRef.current) { vineyardPopupRef.current.remove(); vineyardPopupRef.current = null; }
          const clickedFeature = e.features[0];
          const clickedProps = clickedFeature?.properties || {};
          const wineryRecid = clickedProps.winery_recid != null
            ? Number(clickedProps.winery_recid)
            : null;
          if (wineryRecid == null) return;
          const linkedListing = listingsRef.current.find((l) => l.id === wineryRecid);
          if (linkedListing) {
            setSelectedListingRef.current?.(linkedListing);
          }
          // Zoom to the clicked parcel's geometry bounds
          const geom = clickedFeature.geometry;
          if (geom) {
            const coords = geom.type === 'Polygon' ? geom.coordinates.flat()
              : geom.type === 'MultiPolygon' ? geom.coordinates.flat(2)
              : [];
            if (coords.length) {
              let [minLng, minLat, maxLng, maxLat] = [Infinity, Infinity, -Infinity, -Infinity];
              for (const [lng, lat] of coords) {
                if (lng < minLng) minLng = lng;
                if (lat < minLat) minLat = lat;
                if (lng > maxLng) maxLng = lng;
                if (lat > maxLat) maxLat = lat;
              }
              map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
                padding: { top: 80, bottom: 80, left: 60, right: 60 }, maxZoom: 17, pitch: 40, curve: 1.4, speed: 0.55, essential: true,
              });
            }
          }
        });
        map.on('mouseleave', 'vineyards-linked-fill', () => {
          map.getCanvas().style.cursor = '';
          const hoverSrc = map.getSource('vineyards-reference-hover');
          if (hoverSrc) {
            hoverSrc.setData({ type: 'FeatureCollection', features: [] });
          }
          const passiveHoverSrc = map.getSource('vineyards-passive-hover');
          if (passiveHoverSrc) {
            passiveHoverSrc.setData({ type: 'FeatureCollection', features: [] });
          }
          onVineyardHover(null);
          setHoveredVineyardOrganization(null);
          if (vineyardPopupRef.current) {
            vineyardPopupRef.current.remove();
            vineyardPopupRef.current = null;
          }
        });

        // Hover on non-selectable vineyard parcels.
        map.on('mouseenter', 'vineyards-reference-passive-fill', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mousemove', 'vineyards-reference-passive-fill', (e) => {
          if (!e.features?.length) return;
          const hoveredFeature = e.features[0];
          const hoveredProps = hoveredFeature?.properties || {};
          const vineyardName = getVineyardNameFromProperties(hoveredProps) || 'Unknown Vineyard';
          const normalizedName = normalizeVineyardName(vineyardName);
          const sameNameFeatures = normalizedName
            ? map.queryRenderedFeatures({ layers: ['vineyards-reference-passive-fill'] })
              .filter((feature) => {
                const name = getVineyardNameFromProperties(feature?.properties || {});
                return normalizeVineyardName(name) === normalizedName;
              })
              .map((feature) => ({
                type: 'Feature',
                geometry: feature.geometry,
                properties: feature.properties || {},
              }))
            : [];
          const passiveHoverSrc = map.getSource('vineyards-passive-hover');
          if (passiveHoverSrc) {
            passiveHoverSrc.setData({
              type: 'FeatureCollection',
              features: sameNameFeatures.length
                ? sameNameFeatures
                : [{ type: 'Feature', geometry: hoveredFeature.geometry, properties: hoveredProps }],
            });
          }

          // Non-member parcels should not trigger vineyard highlight geometry.
          onVineyardHover(null);
          setHoveredVineyardOrganization(null);

          const popupHtml = `<div style="
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 8px 12px;
            line-height: 1.4;
            font-size: 13px;
          ">
            <div style="font-weight: 600; color: ${UI.popupLabelColor};">Winery: <span style="font-weight: 400;">Non-member winery</span></div>
            <div style="font-weight: 600; color: ${UI.popupLabelColor}; margin-top: 2px;">Vineyard: <span style="font-weight: 400;">${vineyardName}</span></div>
          </div>`;

          if (!vineyardPopupRef.current) {
            vineyardPopupRef.current = new maplibregl.Popup({
              closeButton: false, closeOnClick: false, offset: 15,
              className: 'vineyard-hover-popup',
            });
          }
          vineyardPopupRef.current.setLngLat(e.lngLat).setHTML(popupHtml).addTo(map);
        });
        map.on('mouseleave', 'vineyards-reference-passive-fill', () => {
          map.getCanvas().style.cursor = '';
          const passiveHoverSrc = map.getSource('vineyards-passive-hover');
          if (passiveHoverSrc) {
            passiveHoverSrc.setData({ type: 'FeatureCollection', features: [] });
          }
          if (vineyardPopupRef.current) {
            vineyardPopupRef.current.remove();
            vineyardPopupRef.current = null;
          }
        });

        // Selected parcel highlight — updated dynamically when a listing is chosen
        map.addSource('vineyards-selected', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'vineyards-selected-fill',
          type: 'fill',
          source: 'vineyards-selected',
          paint: {
            'fill-color': '#6DBF8A',
            'fill-opacity': 0.2,
          },
        });
        map.addLayer({
          id: 'vineyards-selected-line',
          type: 'line',
          source: 'vineyards-selected',
          paint: {
            'line-color': '#8FD3B0',
            'line-width': 1.8,
            'line-opacity': 0.9,
          },
        });

        // Hovered-parcel highlight — single feature swapped in on card hover
        map.addSource('vineyards-hovered', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'vineyards-hovered-fill',
          type: 'fill',
          source: 'vineyards-hovered',
          paint: {
            'fill-color': '#38BDF8',
            'fill-opacity': 0.22,
          },
        });
        map.addLayer({
          id: 'vineyards-hovered-line',
          type: 'line',
          source: 'vineyards-hovered',
          paint: {
            'line-color': '#38BDF8',
            'line-width': 3.0,
            'line-opacity': 1,
          },
        });

      } catch (e) {
        console.warn('WVWAMap: failed to load Adelsheim vineyard polygons', e);
      }

      // ── Load each sub-AVA — DASHED lines ──────────────────────────────
      for (const ava of WV_SUB_AVAS) {
        try {
          const res = await fetch(ava.file);
          const data = await res.json();
          avaDataRef.current[ava.slug] = data;   // ← store for later filtering
          map.addSource(`ava-${ava.slug}`, { type: 'geojson', data });

          map.addLayer({
            id: `ava-${ava.slug}-fill`,
            type: 'fill',
            source: `ava-${ava.slug}`,
            paint: {
              'fill-color': toMapLibreColor(ava.color, MAP_AMBER),
              'fill-opacity': 0,
            },
          });
          map.addLayer({
            id: `ava-${ava.slug}-line`,
            type: 'line',
            source: `ava-${ava.slug}`,
            paint: {
              'line-color': '#EDE2D4',
              'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3.5, 2.5],
              'line-opacity': 1.0,
            },
          });

          // Hover
          map.on('mouseenter', `ava-${ava.slug}-fill`, () => {
            setHoveredAva(ava.slug);
          });
          map.on('mouseleave', `ava-${ava.slug}-fill`, () => {
            setHoveredAva(null);
          });

          // Click removed — AVA selection is panel-only now
        } catch (e) {
          console.warn(`WVWAMap: failed to load ${ava.slug}`, e);
        }
      }



      // ── Dedicated AVA hover highlight layer (always on top of AVA boundaries) ──
      map.addSource('ava-hover', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      // audit-ignore-start ava-hover-layer-paint
      map.addLayer({
        id: 'ava-hover-line',
        type: 'line',
        source: 'ava-hover',
        paint: {
          'line-color': '#38BDF8',
          'line-width': 3,
          'line-opacity': 1,
        },
      });
      // audit-ignore-end

      // ── GeoJSON source for clustered markers ─────────────────────────
      addListingsSourceAndBaseLayers(
        map,
        buildListingsGeoJSON(listingsRef.current, listingFilterModeRef.current, vineyardRecidSetRef.current),
        DEFAULT_LISTING_SYMBOLOGY,
        false,
      );

      // ── Selected listing highlight layers ─────────────────────────
      // A separate single-feature source so we never re-filter the cluster source.
      map.addSource('selected-listing', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      // audit-ignore-start listing-highlight-layer-paint
      // Outer glow / halo ring
      map.addLayer({
        id: 'listings-selected-glow',
        type: 'circle',
        source: 'selected-listing',
        paint: {
          'circle-color': 'transparent',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 14],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': LISTING_HOVER_COLOR,
          'circle-stroke-opacity': 0.25,
          'circle-opacity': 0,
          'circle-blur': 0.5,
        },
      });
      // Selected dot (accent-coloured circle)
      map.addLayer({
        id: 'listings-selected-dot',
        type: 'circle',
        source: 'selected-listing',
        paint: {
          'circle-color': LISTING_HOVER_COLOR,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 6],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.35,
        },
      });

      // ── Hovered listing highlight (from Wineries panel row hover) ─────
      map.addSource('hovered-listing', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      // Hovered glow ring
      map.addLayer({
        id: 'listings-hovered-glow',
        type: 'circle',
        source: 'hovered-listing',
        paint: {
          'circle-color': 'transparent',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 14],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': LISTING_HOVER_COLOR,
          'circle-stroke-opacity': 0.22,
          'circle-opacity': 0,
          'circle-blur': 0.4,
        },
      });
      // Hovered dot (accent-coloured circle)
      map.addLayer({
        id: 'listings-hovered-dot',
        type: 'circle',
        source: 'hovered-listing',
        paint: {
          'circle-color': '#38BDF8',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 6],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.3,
        },
      });
      // audit-ignore-end

      applyListingFocusAccent(map, DEFAULT_LISTING_SYMBOLOGY);

      // ── Ensure highlight layers always render above everything else ──
      // AVA layers load asynchronously and can end up above the highlight
      // layers. Move all highlight layers to the top of the stack now that
      // all sources/layers have been added.
      normalizeOverlayAndLabelOrder(map, basemapLabelLayerIdsRef.current);

      // ── Cluster click → zoom in ───────────────────────────────────
      map.on('click', 'listings-clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['listings-clusters'] });
        if (!features.length) return;
        const clusterId = features[0].properties.cluster_id;
        map.getSource('listings').getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          map.flyTo({ center: features[0].geometry.coordinates, zoom, curve: 1.4, speed: 0.55, essential: true });
        });
      });

      // ── Unclustered dot click → right-side detail panel ──────────
      map.on('click', 'listings-unclustered', (e) => {
        if (!e.features?.length) return;
        const props = e.features[0].properties;
        const listing = listingsRef.current.find(l => l.id === props.id);
        if (!listing) return;
        setSelectedListingRef.current?.(listing);
        const vineyardFeatures = VINEYARD_BY_RECID[listing.id] ?? [];
        if (!flyToVineyardBounds(map, vineyardFeatures)) {
          map.flyTo({ center: [listing.lng, listing.lat], zoom: 14, curve: 1.4, speed: 0.55, essential: true });
        }
      });

      // Cursor changes + map-dot hover highlight
      map.on('mouseenter', 'listings-clusters',    () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'listings-clusters',    () => { map.getCanvas().style.cursor = ''; });
      map.on('mouseenter', 'listings-unclustered', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (!e.features?.length) return;
        const props = e.features[0].properties;
        const listing = listingsRef.current.find(l => l.id === props.id);
        if (listing) setHoveredListingRef.current?.(listing);
      });
      map.on('mouseleave', 'listings-unclustered', () => {
        map.getCanvas().style.cursor = '';
        setHoveredListingRef.current?.(null);
      });

      setMapLoaded(true);
    });

    mapRef.current = map;

    return () => {
      if (popupRef.current) popupRef.current.remove();
      if (vineyardPopupRef.current) vineyardPopupRef.current.remove();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        setMapLoaded(false);
      }
    };
  }, []);

  // ── Fly to selected AVA or back to valley ─────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Close any open popup when switching AVAs
    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    if (vineyardPopupRef.current) { vineyardPopupRef.current.remove(); vineyardPopupRef.current = null; }

    // Clear any selected listing when changing AVA context
    setSelectedListingBoth(null);

    if (selectedAva) {
      // ── Style layers: highlight selected, hide others ─────────────
      for (const ava of WV_SUB_AVAS) {
        const isSelected = ava.slug === selectedAva;
        try {
          if (map.getLayer(`ava-${ava.slug}-fill`)) {
            map.setPaintProperty(`ava-${ava.slug}-fill`, 'fill-opacity', 0);
          }
          if (map.getLayer(`ava-${ava.slug}-line`)) {
            map.setPaintProperty(`ava-${ava.slug}-line`, 'line-color',   '#EDE2D4');
            map.setPaintProperty(`ava-${ava.slug}-line`, 'line-opacity', isSelected ? 1.0 : 0);
            map.setPaintProperty(`ava-${ava.slug}-line`, 'line-width',   isSelected ? 3.5 : 2.5);
          }

        } catch (e) { /* ignore */ }
      }

      // ── Filter listings to those inside the selected AVA polygon ──
      const avaGeoJSON = avaDataRef.current[selectedAva];
      if (avaGeoJSON) {
        // Collect all polygon rings from the GeoJSON
        const rings = [];
        const collectRings = (geom) => {
          if (!geom) return;
          if (geom.type === 'Polygon') rings.push(...geom.coordinates);
          else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(p => rings.push(...p));
        };
        if (avaGeoJSON.type === 'Feature') collectRings(avaGeoJSON.geometry);
        else if (avaGeoJSON.type === 'FeatureCollection') avaGeoJSON.features.forEach(f => collectRings(f.geometry));
        else collectRings(avaGeoJSON);

        // Ray-casting point-in-polygon
        const pointInRing = (px, py, ring) => {
          let inside = false;
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i], [xj, yj] = ring[j];
            if (((yi > py) !== (yj > py)) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
          }
          return inside;
        };
        const pointInPolygon = (lng, lat) => rings.some(ring => pointInRing(lng, lat, ring));

        // Build list of IDs inside the AVA
        const insideIds = listingsRef.current
          .filter(l => pointInPolygon(l.lng, l.lat))
          .map(l => l.id);
        insideIdsRef.current = insideIds;
        setInsideIds(insideIds);
        // Update source data so clusters re-compute with only the AVA's points
        const src = map.getSource('listings');
        if (src) src.setData(buildListingsGeoJSON(listingsRef.current, listingFilterModeRef.current, vineyardRecidSetRef.current, insideIds));
      }

      // ── Fly to selected AVA — use curated camera from avaCameraConfig ──
      const cam = AVA_CAMERA[selectedAva];
      const _avaSlugForBlink = selectedAva;
      const _onAvaMoveEnd = () => {
        const BLINK = [
          { delay:   0, value: 0.45 },
          { delay: 200, value: 0.03 },
          { delay: 400, value: 0.45 },
          { delay: 600, value: 0.03 },
          { delay: 800, value: 0.45 },
          { delay: 1000, value: 0 },  // settle at transparent
        ];
        blinkMapLayer(map, `ava-${_avaSlugForBlink}-fill`, 'fill-opacity', BLINK);
      };
      if (cam) {
        flyToAva(map, selectedAva, { onMoveEnd: _onAvaMoveEnd });
      } else {
        // Fallback: fit the AVA's own bounding box
        const avaSource = map.getSource(`ava-${selectedAva}`);
        if (avaSource && avaSource._data) {
          try {
            const bounds = new maplibregl.LngLatBounds();
            const addCoords = (coords) => {
              if (typeof coords[0] === 'number') bounds.extend(coords);
              else coords.forEach(addCoords);
            };
            const features = avaSource._data.features || [avaSource._data];
            features.forEach(f => addCoords(f.geometry.coordinates));
            map.fitBounds(bounds, FLY_PRESETS.avaBounds);
            map.once('moveend', _onAvaMoveEnd);
          } catch (e) { /* ignore */ }
        }
      }
    } else {
      // ── Reset everything ──────────────────────────────────────────
      insideIdsRef.current = null;
      setInsideIds(null);
      // Restore source to current listing filter (no AVA restriction)
      const src = map.getSource('listings');
      if (src) src.setData(buildListingsGeoJSON(listingsRef.current, listingFilterModeRef.current, vineyardRecidSetRef.current, null));
      for (const ava of WV_SUB_AVAS) {
        try {
          if (map.getLayer(`ava-${ava.slug}-fill`)) {
            map.setPaintProperty(`ava-${ava.slug}-fill`, 'fill-opacity', 0);
          }
          if (map.getLayer(`ava-${ava.slug}-line`)) {
            map.setPaintProperty(`ava-${ava.slug}-line`, 'line-opacity', 1.0);
            map.setPaintProperty(`ava-${ava.slug}-line`, 'line-width',
              ['case', ['boolean', ['feature-state', 'hover'], false], 3.5, 2.5]);
          }

        } catch (e) { /* ignore */ }
      }

      // ── Restore all listings layers — handled by listing filter effect ──

      flyToWillamette(map);
    }
  }, [selectedAva, mapLoaded]);

  // ── Re-feed the GeoJSON source whenever listing filter or AVA changes ────
  // Updating source data (not just layer filters) is the only way to make
  // the cluster engine re-cluster with the correct subset of points.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const source = map.getSource('listings');
    if (!source) return;
    source.setData(buildListingsGeoJSON(listings, listingFilterMode, vineyardRecidSet, insideIdsRef.current));
  }, [listings, listingFilterMode, vineyardRecidSet, mapLoaded, selectedAva]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const shouldShowWineries =
      markersVisible &&
      devLayerToggles.wineries &&
      listingFilterMode !== LISTING_FILTER_MODES.noWineriesVisualized;
    const data = buildListingsGeoJSON(
      listings,
      listingFilterMode,
      vineyardRecidSet,
      insideIdsRef.current,
    );

    const rebuildListingsLayers = () => {
      if (!map || !map.getStyle?.() || !map.isStyleLoaded?.() || !map.loaded?.()) return;

      try {
        removeListingsBaseLayersAndSource(map);
        const didAdd = addListingsSourceAndBaseLayers(map, data, listingSymbologyPreset, shouldShowWineries);
        if (!didAdd) return;
        applyListingFocusAccent(map, listingSymbologyPreset);
        setListingSoftFocus(map, !!selectedListing);
        normalizeOverlayAndLabelOrder(map, basemapLabelLayerIdsRef.current);
      } catch (error) {
        // Style transitions can briefly make addSource/addLayer unavailable.
        // Swallow and let the next style event retry.
        console.warn('WVWAMap: deferred listings symbology rebuild', error);
      }
    };

    if (!map.getStyle?.() || !map.isStyleLoaded?.() || !map.loaded?.()) {
      const onStyleData = () => {
        if (!map.getStyle?.() || !map.isStyleLoaded?.() || !map.loaded?.()) return;
        rebuildListingsLayers();
        map.off('styledata', onStyleData);
      };
      map.on('styledata', onStyleData);
      return () => map.off('styledata', onStyleData);
    }

    rebuildListingsLayers();
  }, [
    listingSymbologyPreset,
    mapLoaded,
    introComplete,
    markersVisible,
    devLayerToggles.wineries,
    listingFilterMode,
    listings,
    vineyardRecidSet,
    selectedListing,
    vineyardFocusMode,
  ]);

  const handleLayerChange = useCallback((layer) => {
    setActiveLayer(layer);
    setTopoStats(null); // clear stale stats when switching layers
    onActiveLayerChangeProp?.(layer);
  }, [onActiveLayerChangeProp]);

  const handleListingFilterModeChange = useCallback((mode) => {
    setListingFilterMode(mode);
    onListingFilterModeChange?.(mode);
  }, [onListingFilterModeChange]);

  const handleListingSymbologyPresetChange = useCallback((preset) => {
    setListingSymbologyPreset(preset);
    onListingSymbologyPresetChange?.(preset);
  }, [onListingSymbologyPresetChange]);

  const handleListingClick = useCallback((listing) => {
    setSelectedListingBoth(listing);
    const map = mapRef.current;
    if (map) {
      const vineyardFeatures = VINEYARD_BY_RECID[listing.id] ?? [];
      if (!flyToVineyardBounds(map, vineyardFeatures)) {
        flyToCoords(map, { lng: listing.lng, lat: listing.lat });
      }
    }
  }, [setSelectedListingBoth]);

  const handleHoverListing = useCallback((listing) => {
    setHoveredListing(listing); // null to clear
    setHoveredVineyardOrganization(null);
    onVineyardHover(listing ? (VINEYARD_BY_RECID[listing.id] || []) : null);
  }, [onVineyardHover]);

  // Keep setHoveredListingRef in sync so the map's [] closure can call it
  useEffect(() => { setHoveredListingRef.current = handleHoverListing; }, [handleHoverListing]);

  // Reveal the WV mask only once the entrance flyTo has landed
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !introComplete) return;
    if (devLayerToggles.wvMask) {
      setLayerVisibility(map, 'wv-mask-fill', true);
    }
  }, [introComplete, mapLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Only toggle the mask if intro is already done; otherwise leave it hidden
    if (introComplete) {
      setLayerVisibility(map, 'wv-mask-fill', devLayerToggles.wvMask);
    }
    setLayerVisibility(map, 'wv-boundary-line', devLayerToggles.wvBoundary);

    for (const ava of WV_SUB_AVAS) {
      setLayerVisibility(map, `ava-${ava.slug}-fill`, devLayerToggles.avaBoundaries);
      setLayerVisibility(map, `ava-${ava.slug}-line`, devLayerToggles.avaBoundaries);

    }

    const interactiveReferenceFilter = buildInteractiveReferenceVineyardFilter(devLayerToggles);
    const passiveReferenceFilter = buildPassiveReferenceVineyardFilter(devLayerToggles);
    const showInteractiveReferenceVineyards = !!interactiveReferenceFilter;
    const showPassiveReferenceVineyards = !!passiveReferenceFilter;
    if (map.getLayer('vineyards-reference-fill')) {
      map.setFilter('vineyards-reference-fill', interactiveReferenceFilter);
      setLayerVisibility(map, 'vineyards-reference-fill', showInteractiveReferenceVineyards);
    }
    if (map.getLayer('vineyards-reference-line')) {
      map.setFilter('vineyards-reference-line', interactiveReferenceFilter);
      setLayerVisibility(map, 'vineyards-reference-line', showInteractiveReferenceVineyards);
    }
    if (map.getLayer('vineyards-reference-passive-fill')) {
      map.setFilter('vineyards-reference-passive-fill', passiveReferenceFilter);
      setLayerVisibility(map, 'vineyards-reference-passive-fill', showPassiveReferenceVineyards);
    }
    if (map.getLayer('vineyards-reference-passive-hatch')) {
      map.setFilter('vineyards-reference-passive-hatch', passiveReferenceFilter);
      setLayerVisibility(map, 'vineyards-reference-passive-hatch', showPassiveReferenceVineyards);
    }
    if (map.getLayer('vineyards-reference-passive-line')) {
      map.setFilter('vineyards-reference-passive-line', passiveReferenceFilter);
      setLayerVisibility(map, 'vineyards-reference-passive-line', showPassiveReferenceVineyards);
    }

    setLayerVisibility(map, 'vineyards-linked-fill', devLayerToggles.vineyardsLinked);
    setLayerVisibility(map, 'vineyards-linked-line', devLayerToggles.vineyardsLinked);
    // Re-apply soft focus so linked layer doesn't flash at full green when toggled on during winery detail
    if (selectedListing) setVineyardReferenceSoftFocus(map, true);

    const vineyardHighlightLayerIds = [
      'vineyards-reference-hover-line',
      'vineyards-passive-hover-line',
      'vineyards-selected-fill',
      'vineyards-selected-line',
      'vineyards-hovered-fill',
      'vineyards-hovered-line',
    ];
    for (const layerId of vineyardHighlightLayerIds) {
      setLayerVisibility(map, layerId, devLayerToggles.vineyardHighlights);
    }

    for (const layerId of LISTING_MARKER_LAYERS) {
      setLayerVisibility(map, layerId, devLayerToggles.wineries);
    }
  }, [
    devLayerToggles,
    mapLoaded,
    selectedAva,
    selectedListing,
    vineyardFocusMode,
    introComplete,
    listingFilterMode,
  ]);

  const toggleDevLayer = useCallback((keyName) => {
    setDevLayerToggles((prev) => ({
      ...prev,
      [keyName]: !prev[keyName],
    }));
  }, []);

  const handleResetView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (selectedListing?.lat != null && selectedListing?.lng != null) {
      const vineyardFeatures = VINEYARD_BY_RECID[selectedListing.id] ?? [];
      if (!flyToVineyardBounds(map, vineyardFeatures)) {
        flyToCoords(map, { lng: selectedListing.lng, lat: selectedListing.lat });
      }
    } else if (selectedAva) {
      flyToAva(map, selectedAva);
    } else {
      flyToWillamette(map);
    }
  }, [selectedAva, selectedListing]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%', background: UI.mapContainerBg }} />

      {/* Dev layer panel — hidden; re-enable by uncommenting
      {introComplete && (
        <DevLayerPanel
          devPanelOpen={devPanelOpen}
          onTogglePanelOpen={() => setDevPanelOpen((prev) => !prev)}
          devLayerToggles={devLayerToggles}
          onToggleLayer={toggleDevLayer}
          onReset={() => setDevLayerToggles(DEV_LAYER_DEFAULTS)}
          listingSymbologyPreset={listingSymbologyPreset}
          onListingSymbologyPresetChange={handleListingSymbologyPresetChange}
        />
      )}
      */}

      {/* Winery marker hover label — light glass pill, dot color matches the on-map hover dot */}
      {introComplete && hoveredListing && (
        <HoverPill dotColor={LISTING_HOVER_COLOR}>{hoveredListing.title}</HoverPill>
      )}

      {/* Vineyard organization hover label — light glass pill, green dot */}
      {!hoveredListing && hoveredVineyardOrganization && (
        <HoverPill dotColor={TOKENS.vividGreen}>{hoveredVineyardOrganization}</HoverPill>
      )}

      {/* Selected AVA badge — top center focal point when an AVA is selected */}
      {introComplete && selectedAva && (() => {
        const ava = WV_SUB_AVAS.find(a => a.slug === selectedAva);
        return ava ? (
          <div style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
            background: MAP_GLASS.bgStrong,
            borderRadius: MAP_GLASS.radiusCard,
            padding: '10px 20px',
            fontFamily: 'var(--font-sans)',
            boxShadow: MAP_GLASS.shadow,
            border: `1px solid ${MAP_GLASS.border}`,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            whiteSpace: 'nowrap',
          }}>
            <span style={{ fontSize: 'var(--type-body-size)', fontWeight: 700, color: MAP_GLASS.text, letterSpacing: '0.01em' }}>
              {ava.name}
            </span>
          </div>
        ) : null;
      })()}

      {/* Climate raster layer */}
      {introComplete && mapLoaded && mapRef.current && devLayerToggles.climate && (
        <ClimateLayer
          map={mapRef.current}
          isVisible={isClimateActive}
          currentMonth={currentMonth}
          prismVar="tdmean"
          colormap="plasma"
        />
      )}

      {/* Topography raster layers (all sub-AVAs) */}
      {introComplete && mapLoaded && mapRef.current && devLayerToggles.topography && (
        <TopographyLayer
          map={mapRef.current}
          activeLayer={isTopoActive ? activeLayer : null}
          onStats={setTopoStats}
        />
      )}

      // ...Show Wineries button removed...

      {/* Map controls — floating left-center */}
      {introComplete && mapLoaded && (
        <MapControls
          map={mapRef.current}
          mapLoaded={mapLoaded}
          selectedAva={selectedAva}
          onSelectAva={onSelectAva}
          onResetView={handleResetView}
        />
      )}

      {/* Dev camera debug overlay — only rendered in development */}
      <CameraDebug map={mapRef.current} mapLoaded={mapLoaded} />
    </div>
  );
});

export default WVWAMap;
