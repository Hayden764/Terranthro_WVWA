import { useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';

// Register pmtiles:// protocol with MapLibre (must happen before any map is created)
const pmtilesProtocol = new Protocol();
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile.bind(pmtilesProtocol));
import ClimateLayer from './ClimateLayer';
import TopographyLayer from './TopographyLayer';
import DesktopDock from './dock/DesktopDock';
import { WV_SUB_AVAS, TOPO_LAYER_TYPES } from '../config/topographyConfig';
import { AVA_CAMERA, WV_CAMERA } from '../config/avaCameraConfig';
import { BRAND } from '../config/brandColors';

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
  ? (import.meta.env.DEV
    ? FALLBACK_STYLE
    : `https://api.maptiler.com/maps/hybrid-v4/style.json?key=${MAPTILER_KEY}`)
  : FALLBACK_STYLE;

// ── Vineyard parcel data (fetched at map load, indexed here at runtime) ──
// Keyed by winery_recid (integer) → array of GeoJSON Feature objects
// so a single winery can map to multiple parcels.
// Populated from /api/vineyards/parcels?dataset=adelsheim during map load.
let VINEYARD_BY_RECID = {};
let LINKED_VINEYARD_BY_RECID = {};
let VINEYARD_FEATURES_BY_NAME = {}; // keyed by normalized vineyard_name → [feature, ...]

function getVineyardNameFromProperties(properties = {}) {
  return properties.vineyard_name || properties.Vineyard_Name || properties.A1_VineyardName || '';
}

function normalizeVineyardName(name) {
  return (typeof name === 'string' ? name : '').trim().toLowerCase();
}

// ── Listing categories ────────────────────────────────────────────────────
export const LISTING_CATEGORIES = {
  hotel:      { label: 'Hotel / Inn',        color: '#C47C2B', icon: '🏨', emoji: '🏨' },
  restaurant: { label: 'Restaurant / Dining', color: '#2B7A4B', icon: '🍽️', emoji: '🍽️' },
  tasting:    { label: 'Tasting Room',        color: '#6B3A8E', icon: '🍷', emoji: '🍷' },
  winery:     { label: 'Winery / Vineyard',   color: BRAND.burgundy, icon: '🍇', emoji: '🍇' },
  other:      { label: 'Other',               color: BRAND.brownLight, icon: '📍', emoji: '📍' },
};

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

const LISTING_SYMBOLOGY_OPTIONS = [
  { id: LISTING_SYMBOLOGY_PRESETS.estateMinimal, label: 'Estate Minimal' },
  { id: LISTING_SYMBOLOGY_PRESETS.topoModern, label: 'Topo Modern' },
  { id: LISTING_SYMBOLOGY_PRESETS.heritagePremium, label: 'Heritage Premium' },
];

const LISTING_SYMBOLOGY_CONFIG = {
  [LISTING_SYMBOLOGY_PRESETS.estateMinimal]: {
    clusterMaxZoom: 11,
    clusterRadius: 34,
    clusterMinPoints: 3,
    clusterCircleColor: [
      'step', ['get', 'point_count'],
      'rgba(234, 236, 233, 0.82)', 10,
      'rgba(218, 223, 217, 0.84)', 30,
      'rgba(196, 204, 198, 0.88)',
    ],
    clusterCircleRadius: ['step', ['get', 'point_count'], 14, 10, 19, 30, 24],
    clusterStrokeColor: 'rgba(41, 49, 42, 0.52)',
    clusterStrokeWidth: 1.3,
    clusterCountColor: '#1F2A22',
    clusterCountHaloColor: 'rgba(250,247,242,0.72)',
    markerFillColor: '#304437',
    markerRadius: ['interpolate', ['linear'], ['zoom'], 10, 5.8, 14, 8.4],
    markerStrokeColor: 'rgba(250,247,242,0.82)',
    markerStrokeWidth: 1.6,
    markerTextColor: '#F5EFE3',
    markerTextHaloColor: 'rgba(16,22,18,0.42)',
    focusAccentColor: '#6FB78D',
  },
  [LISTING_SYMBOLOGY_PRESETS.topoModern]: {
    clusterMaxZoom: 12,
    clusterRadius: 31,
    clusterMinPoints: 3,
    clusterCircleColor: [
      'step', ['get', 'point_count'],
      'rgba(226, 238, 244, 0.82)', 10,
      'rgba(204, 227, 236, 0.84)', 30,
      'rgba(177, 210, 224, 0.88)',
    ],
    clusterCircleRadius: ['step', ['get', 'point_count'], 13, 10, 18, 30, 23],
    clusterStrokeColor: 'rgba(44, 72, 88, 0.46)',
    clusterStrokeWidth: 1.4,
    clusterCountColor: '#203744',
    clusterCountHaloColor: 'rgba(239,247,250,0.78)',
    markerFillColor: '#255A73',
    markerRadius: ['interpolate', ['linear'], ['zoom'], 10, 5.7, 14, 8.2],
    markerStrokeColor: 'rgba(235,246,252,0.86)',
    markerStrokeWidth: 1.6,
    markerTextColor: '#EDF8FF',
    markerTextHaloColor: 'rgba(16,38,49,0.44)',
    focusAccentColor: '#38BDF8',
  },
  [LISTING_SYMBOLOGY_PRESETS.heritagePremium]: {
    clusterMaxZoom: 12,
    clusterRadius: 37,
    clusterMinPoints: 2,
    clusterCircleColor: [
      'step', ['get', 'point_count'],
      'rgba(228, 213, 188, 0.82)', 10,
      'rgba(214, 193, 161, 0.84)', 30,
      'rgba(190, 163, 124, 0.88)',
    ],
    clusterCircleRadius: ['step', ['get', 'point_count'], 15, 10, 20, 30, 25],
    clusterStrokeColor: 'rgba(74, 52, 30, 0.55)',
    clusterStrokeWidth: 1.45,
    clusterCountColor: '#3B2613',
    clusterCountHaloColor: 'rgba(246,235,214,0.76)',
    markerFillColor: '#6A4C2D',
    markerRadius: ['interpolate', ['linear'], ['zoom'], 10, 6.2, 14, 8.9],
    markerStrokeColor: 'rgba(245,229,203,0.86)',
    markerStrokeWidth: 1.7,
    markerTextColor: '#FFF6E8',
    markerTextHaloColor: 'rgba(40,26,14,0.44)',
    focusAccentColor: '#B88A4A',
  },
};

const DEFAULT_LISTING_SYMBOLOGY = LISTING_SYMBOLOGY_PRESETS.estateMinimal;
const LISTING_BASE_LAYER_IDS = [
  'listings-clusters',
  'listings-cluster-count',
  'listings-unclustered',
  'listings-unclustered-num',
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
      'circle-radius': config.markerRadius,
      'circle-stroke-width': config.markerStrokeWidth,
      'circle-stroke-color': config.markerStrokeColor,
      'circle-opacity': 0.92,
    },
  });

  map.addLayer({
    id: 'listings-unclustered-num',
    type: 'symbol',
    source: 'listings',
    filter: ['!', ['has', 'point_count']],
    minzoom: 12,
    layout: {
      visibility: isVisible ? 'visible' : 'none',
      'text-field': ['to-string', ['get', 'num']],
      'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
      'text-size': 8.5,
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': config.markerTextColor,
      'text-halo-color': config.markerTextHaloColor,
      'text-halo-width': 0.45,
    },
  });

  return true;
}

function applyListingFocusAccent(map, preset) {
  const accent = getListingSymbologyConfig(preset).focusAccentColor;

  if (map.getLayer('listings-selected-glow')) {
    map.setPaintProperty('listings-selected-glow', 'circle-stroke-color', accent);
  }
  if (map.getLayer('listings-selected-dot')) {
    map.setPaintProperty('listings-selected-dot', 'circle-stroke-color', accent);
  }
  if (map.getLayer('listings-hovered-glow')) {
    map.setPaintProperty('listings-hovered-glow', 'circle-stroke-color', accent);
  }
  if (map.getLayer('listings-hovered-dot')) {
    map.setPaintProperty('listings-hovered-dot', 'circle-stroke-color', accent);
  }
}


// Willamette Valley approximate bounding box
const WV_BOUNDS = [[-123.8, 44.0], [-122.0, 45.9]];

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
  'listings-unclustered-num',
  'listings-hovered-glow',
  'listings-hovered-dot',
  'listings-hovered-num',
  'listings-selected-glow',
  'listings-selected-dot',
  'listings-selected-num',
];

const LISTING_LAYERS_HIDDEN_IN_VINEYARD_FOCUS = [
  'listings-clusters',
  'listings-cluster-count',
  'listings-unclustered',
  'listings-unclustered-num',
  'listings-hovered-glow',
  'listings-hovered-dot',
  'listings-hovered-num',
];

const LISTING_MARKER_LAYERS = [
  'listings-clusters',
  'listings-cluster-count',
  'listings-unclustered',
  'listings-unclustered-num',
  'listings-hovered-glow',
  'listings-hovered-dot',
  'listings-hovered-num',
  'listings-selected-glow',
  'listings-selected-dot',
  'listings-selected-num',
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

function setLayerVisibility(map, layerId, isVisible) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
}

function buildDatasetFilter(datasets) {
  if (!datasets.length) return null;
  return ['in', ['get', 'source_dataset'], ['literal', datasets]];
}

function buildInteractiveReferenceVineyardFilter(devLayerToggles) {
  const enabledDatasets = [];
  if (devLayerToggles.vineyardsAdelsheimReference) enabledDatasets.push('adelsheim');
  return buildDatasetFilter(enabledDatasets);
}

function buildPassiveReferenceVineyardFilter(devLayerToggles) {
  const enabledDatasets = [];
  if (devLayerToggles.vineyardsDundeeChehalem) enabledDatasets.push('chehalem-dundee');
  if (devLayerToggles.vineyardsYC) enabledDatasets.push('yamhill-carlton');
  return buildDatasetFilter(enabledDatasets);
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
  const hoveredGlowOpacity = isSoftFocused ? 0.3 : 0.45;
  const hoveredDotOpacity = isSoftFocused ? 0.35 : 1;
  const hoveredNumOpacity = isSoftFocused ? 0.38 : 1;
  const hoveredGlowRadius = isSoftFocused
    ? ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 13]
    : ['interpolate', ['linear'], ['zoom'], 10, 18, 14, 25];
  const hoveredGlowStrokeWidth = isSoftFocused ? 1.5 : 2.5;
  const hoveredDotRadius = isSoftFocused
    ? ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 8]
    : ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 15];
  const hoveredDotStrokeWidth = isSoftFocused ? 1.8 : 3;

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
  const referenceLineOpacity = isSoftFocused ? 0.14 : 0.5;
  const passiveFillOpacity = isSoftFocused ? 0.1 : 0.18;
  const passivePatternOpacity = isSoftFocused ? 0.08 : 0.2;
  const passiveLineOpacity = isSoftFocused ? 0.18 : 0.34;
  const passiveLineWidth = isSoftFocused ? 0.6 : 0.85;
  const linkedLineOpacity = isSoftFocused ? 0.24 : 0.86;
  const linkedFillOpacity = isSoftFocused ? 0.008 : 0.03;
  const hoverLineOpacity = isSoftFocused ? 0.6 : 1;
  const passiveHoverLineOpacity = isSoftFocused ? 0.4 : 0.7;
  const referenceLineWidth = isSoftFocused ? 0.9 : 1.1;
  const linkedLineWidth = isSoftFocused ? 1.05 : 1.4;
  const hoverLineWidth = isSoftFocused ? 2.6 : 3.0;
  const passiveHoverLineWidth = isSoftFocused ? 1.2 : 1.8;
  const referenceLineColor = isSoftFocused ? '#D8E3F0' : '#C7D6E8';
  const passiveLineColor = '#FFFFFF';
  const linkedLineColor = isSoftFocused ? '#73BC94' : '#3FAF79';

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
      background: 'rgba(46,34,26,0.92)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(250,247,242,0.12)',
      borderRadius: 14,
      boxShadow: '0 8px 40px rgba(46,34,26,0.45)',
      fontFamily: 'Inter, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 40,
    }}>

      {/* ── Header / tab bar ─────────────────────────────────────────── */}
      <div style={{
        padding: hasBoth ? '0' : '12px 14px 0',
        borderBottom: '1px solid rgba(250,247,242,0.08)',
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
                    background: isActive ? 'rgba(250,247,242,0.06)' : 'transparent',
                    border: 'none',
                    borderBottom: isActive ? `2px solid ${BRAND.burgundy}` : '2px solid transparent',
                    color: isActive ? 'rgba(250,247,242,0.95)' : 'rgba(250,247,242,0.4)',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: 'Inter, sans-serif',
                    letterSpacing: '0.04em',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    transition: 'color 0.15s, border-color 0.15s, background 0.15s',
                  }}
                >
                  <span style={{ fontSize: 13 }}>{t.icon}</span>
                  {t.label}
                  {/* Per-tab close × */}
                  <span
                    role="button"
                    title={`Close ${t.label}`}
                    onClick={e => { e.stopPropagation(); t.id === 'listing' ? onCloseListing() : onCloseLayer(); }}
                    style={{
                      marginLeft: 4,
                      fontSize: 10,
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
              <span style={{ fontSize: 16 }}>
                {resolvedTab === 'listing' ? (cat?.icon ?? '📍') : getLayerIcon(activeLayer)}
              </span>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(250,247,242,0.4)', lineHeight: 1, marginBottom: 2 }}>
                  {resolvedTab === 'listing' ? cat?.label : 'Active Layer'}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(250,247,242,0.95)', lineHeight: 1.2 }}>
                  {resolvedTab === 'listing' ? listing.title : getLayerLabel(activeLayer)}
                </div>
              </div>
            </div>
            <button
              onClick={resolvedTab === 'listing' ? onCloseListing : onCloseLayer}
              style={{
                background: 'rgba(46,34,26,0.7)',
                border: '1px solid rgba(250,247,242,0.15)',
                borderRadius: 8,
                color: 'rgba(250,247,242,0.7)',
                width: 28, height: 28,
                cursor: 'pointer', fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1, flexShrink: 0,
              }}
            >✕</button>
          </div>
        )}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div style={{ overflowY: 'auto', flex: 1, scrollbarWidth: 'thin', scrollbarColor: 'rgba(250,247,242,0.15) transparent' }}>
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
  const CARD = { background: 'rgba(250,247,242,0.06)', border: '1px solid rgba(250,247,242,0.08)', borderRadius: 10, padding: '12px 14px', marginBottom: 8 };
  const LBL  = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(250,247,242,0.4)', marginBottom: 4 };
  const VAL  = { fontSize: 12, color: 'rgba(250,247,242,0.85)', lineHeight: 1.5 };

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
            fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0, marginTop: 2,
          }}>
            {listing.num}
          </span>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(250,247,242,0.95)', lineHeight: 1.3 }}>
            {listing.title}
          </div>
        </div>

        {listing.desc && (
          <p style={{ fontSize: 12, color: 'rgba(250,247,242,0.6)', lineHeight: 1.6, margin: '0 0 12px 0' }}>
            {listing.desc.slice(0, 300)}{listing.desc.length > 300 ? '…' : ''}
          </p>
        )}

        {listing.phone && (
          <a href={`tel:${listing.phone}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(250,247,242,0.7)', textDecoration: 'none', marginBottom: 10 }}>
            📞 {listing.phone}
          </a>
        )}

        {listing.url && (
          <a href={listing.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: '8px 14px', background: cat.color, color: '#fff', borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: 'none', textAlign: 'center', marginTop: 4 }}>
            Visit Website ↗
          </a>
        )}

        {/* ── Vineyard parcels ─────────────────────────────────────── */}
        {vineyards && vineyards.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(250,247,242,0.35)' }}>
                🍇 Estate Vineyard{vineyards.length > 1 ? 's' : ''}
              </div>
              {vineyards.length > 1 && (
                <button
                  onClick={() => onViewAllVineyards?.(vineyards)}
                  style={{
                    background: 'rgba(109,191,138,0.12)',
                    border: '1px solid rgba(109,191,138,0.35)',
                    borderRadius: 6,
                    color: '#6DBF8A',
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: 'Inter, sans-serif',
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
                    e.currentTarget.style.background = 'rgba(56,189,248,0.12)';
                    e.currentTarget.style.borderColor = 'rgba(56,189,248,0.45)';
                    e.currentTarget.style.color = '#38BDF8';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(109,191,138,0.12)';
                    e.currentTarget.style.borderColor = 'rgba(109,191,138,0.35)';
                    e.currentTarget.style.color = '#6DBF8A';
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
                      ? '1px solid rgba(56,189,248,0.55)'
                      : '1px solid rgba(250,247,242,0.08)',
                    background: isHovered
                      ? 'rgba(56,189,248,0.10)'
                      : 'rgba(250,247,242,0.06)',
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
                    <div style={{ fontSize: 12, fontWeight: 700, color: isHovered ? '#38BDF8' : '#6DBF8A', transition: 'color 0.15s', flex: 1, paddingRight: 8 }}>{group.name}</div>
                    <span style={{
                      fontSize: 10,
                      color: isHovered ? 'rgba(56,189,248,0.9)' : 'rgba(109,191,138,0.5)',
                      transition: 'color 0.15s, transform 0.15s',
                      transform: isHovered ? 'scale(1.15)' : 'scale(1)',
                      flexShrink: 0,
                      lineHeight: 1.6,
                    }} title={isExpanded ? 'Expanded' : 'Expand and zoom'}>{isExpanded ? '▾' : '▸'}</span>
                  </div>
                  {isExpanded && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(250,247,242,0.08)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div><div style={LBL}>Blocks</div><div style={VAL}>{blockCount}</div></div>
                        {acres && <div><div style={LBL}>Acres</div><div style={VAL}>{acres} ac</div></div>}
                        {ava && <div><div style={LBL}>AVA</div><div style={VAL}>{ava}</div></div>}
                      </div>

                      {groupTopoStats && (
                        <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid rgba(250,247,242,0.06)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          {groupTopoStats.elev_min != null && groupTopoStats.elev_max != null && (
                            <span style={{ fontSize: 10, color: 'rgba(250,247,242,0.45)', display: 'flex', alignItems: 'center', gap: 3 }}>
                              <span style={{ opacity: 0.6 }}>↑</span>
                              {Math.round(groupTopoStats.elev_min)}–{Math.round(groupTopoStats.elev_max)} ft
                            </span>
                          )}
                          {groupTopoStats.slope_mean != null && (
                            <span style={{ fontSize: 10, color: 'rgba(250,247,242,0.45)', display: 'flex', alignItems: 'center', gap: 3 }}>
                              <span style={{ opacity: 0.6 }}>⊿</span>
                              {groupTopoStats.slope_mean.toFixed(1)}° slope
                            </span>
                          )}
                          {groupTopoStats.aspect_label && groupTopoStats.aspect_label !== 'Flat' && (
                            <span style={{ fontSize: 10, color: 'rgba(250,247,242,0.45)', display: 'flex', alignItems: 'center', gap: 3 }}>
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
                                border: '1px solid rgba(250,247,242,0.1)',
                                borderRadius: 6,
                                padding: '7px 8px',
                                background: 'rgba(250,247,242,0.03)',
                              }}
                            >
                              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(250,247,242,0.9)' }}>{b.name || `Block ${bi + 1}`}</div>
                              <div style={{ fontSize: 10, color: 'rgba(250,247,242,0.6)', marginTop: 2 }}>
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
                                  border: '1px solid rgba(250,247,242,0.1)',
                                  borderRadius: 6,
                                  padding: '7px 8px',
                                  background: 'rgba(250,247,242,0.03)',
                                  color: 'rgba(250,247,242,0.84)',
                                  fontSize: 11,
                                  cursor: 'pointer',
                                }}
                                title="Zoom to this block footprint"
                              >
                                <div style={{ fontWeight: 700 }}>Block {fi + 1}</div>
                                <div style={{ marginTop: 2, fontSize: 10, color: 'rgba(250,247,242,0.6)' }}>{fAcres || 'No acreage'} • Click to zoom</div>
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

const COLORMAP_GRADIENTS = {
  terrain:  'linear-gradient(to right, #0B6623, #90EE90, #F5F5DC, #D2B48C, #8B4513, #FFFFFF)',
  rdylgn_r: 'linear-gradient(to right, #1A9850, #91CF60, #D9EF8B, #FEE08B, #FC8D59, #D73027)',
  hsv:      'linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)',
  plasma:   'linear-gradient(to right, #0D0887, #7E03A8, #CC4778, #F89441, #F0F921)',
};

function LayerTabContent({ activeLayer, topoStats }) {
  const info = LAYER_INFO_FULL[activeLayer];
  if (!info) return null;

  const topoConfig = TOPO_LAYER_TYPES[activeLayer];

  const CARD = { background: 'rgba(250,247,242,0.06)', border: '1px solid rgba(250,247,242,0.08)', borderRadius: 10, padding: '12px 14px', marginBottom: 8 };
  const LBL  = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(250,247,242,0.4)', marginBottom: 4 };
  const VAL  = { fontSize: 13, color: 'rgba(250,247,242,0.9)', lineHeight: 1.55 };
  const fmt  = (v) => typeof v === 'number' ? v.toFixed(1) : '—';

  return (
    <div style={{ padding: '12px 12px 16px' }}>
      <div style={CARD}>
        <p style={{ fontSize: 12, color: 'rgba(250,247,242,0.55)', lineHeight: 1.7, margin: 0 }}>{info.why}</p>
      </div>

      <div style={CARD}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><div style={LBL}>Period</div><div style={VAL}>{info.period}</div></div>
          <div><div style={LBL}>Source</div><div style={{ ...VAL, fontSize: 11, color: 'rgba(250,247,242,0.45)' }}>{info.source}</div></div>
        </div>
      </div>

      {topoStats && topoConfig && (() => {
        const { min, max, mean, std } = topoStats;
        const unit = topoConfig.unit ?? '';
        const gradient = COLORMAP_GRADIENTS[topoConfig.colormap] ?? COLORMAP_GRADIENTS.terrain;
        return (
          <div style={CARD}>
            <div style={{ ...LBL, marginBottom: 8 }}>Data Range — Willamette Valley</div>
            <div style={{ height: 10, borderRadius: 6, background: gradient, marginBottom: 4, border: '1px solid rgba(250,247,242,0.1)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(250,247,242,0.4)', marginBottom: 12 }}>
              <span>{fmt(min)}{unit}</span><span>{fmt(max)}{unit}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><div style={LBL}>Min</div><div style={VAL}>{fmt(min)}{unit}</div></div>
              <div><div style={LBL}>Max</div><div style={VAL}>{fmt(max)}{unit}</div></div>
              <div><div style={LBL}>Mean</div><div style={VAL}>{fmt(mean)}{unit}</div></div>
              <div><div style={LBL}>Std Dev</div><div style={VAL}>±{fmt(std)}{unit}</div></div>
            </div>
          </div>
        );
      })()}

      {!topoStats && topoConfig && (
        <div style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(250,247,242,0.15)', borderTopColor: 'rgba(250,247,242,0.9)', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'rgba(250,247,242,0.4)' }}>Loading data range…</span>
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
    background: 'rgba(46,34,26,0.8)',
    border: '1px solid rgba(250,247,242,0.14)',
    borderRadius: 10,
    padding: '8px 10px',
    marginBottom: 8,
  };

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    fontSize: 11,
    color: 'rgba(250,247,242,0.88)',
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
      background: 'rgba(24,20,16,0.84)',
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      border: '1px solid rgba(250,247,242,0.2)',
      borderRadius: 12,
      boxShadow: '0 10px 30px rgba(0,0,0,0.34)',
      color: 'rgba(250,247,242,0.96)',
      fontFamily: 'Inter, sans-serif',
      overflow: 'hidden',
    }}>
      <div
        onMouseDown={beginDrag}
        style={{
        padding: '8px 10px',
        borderBottom: devPanelOpen ? '1px solid rgba(250,247,242,0.14)' : 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.09em' }}>DEV LAYERS {devPanelOpen ? ':: DRAG' : ''}</span>
        <button
          onClick={onTogglePanelOpen}
          onMouseDown={(event) => event.stopPropagation()}
          style={{
            background: 'transparent',
            border: '1px solid rgba(250,247,242,0.2)',
            color: 'rgba(250,247,242,0.84)',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 10,
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
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', opacity: 0.75, marginBottom: 6 }}>BASE</div>
            <ToggleRow label="WV Mask" keyName="wvMask" />
            <ToggleRow label="WV Boundary" keyName="wvBoundary" />
            <ToggleRow label="AVA Boundaries + Labels" keyName="avaBoundaries" />
          </div>

          <div style={groupStyle}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', opacity: 0.75, marginBottom: 6 }}>VINEYARDS</div>
            <ToggleRow label="Dundee/Chehalem Ref" keyName="vineyardsDundeeChehalem" />
            <ToggleRow label="Yamhill-Carlton Ref" keyName="vineyardsYC" />
            <ToggleRow label="Adelsheim Ref (white)" keyName="vineyardsAdelsheimReference" />
            <ToggleRow label="Linked Wineries (green)" keyName="vineyardsLinked" />
            <ToggleRow label="Selection/Hover Highlights" keyName="vineyardHighlights" />
          </div>

          <div style={groupStyle}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', opacity: 0.75, marginBottom: 6 }}>OTHER</div>
            <ToggleRow label="Winery Markers" keyName="wineries" />
            <ToggleRow label="Climate Raster" keyName="climate" />
            <ToggleRow label="Topography Raster" keyName="topography" />
          </div>

          <div style={groupStyle}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', opacity: 0.75, marginBottom: 6 }}>WINERY SYMBOLOGY</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {LISTING_SYMBOLOGY_OPTIONS.map((option) => {
                const isActive = listingSymbologyPreset === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => onListingSymbologyPresetChange(option.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: isActive ? 'rgba(142,21,55,0.2)' : 'rgba(250,247,242,0.06)',
                      border: isActive ? '1px solid rgba(142,21,55,0.55)' : '1px solid rgba(250,247,242,0.2)',
                      borderRadius: 8,
                      color: isActive ? 'rgba(250,247,242,0.96)' : 'rgba(250,247,242,0.74)',
                      fontSize: 11,
                      fontWeight: isActive ? 700 : 600,
                      cursor: 'pointer',
                      padding: '7px 8px',
                      letterSpacing: '0.02em',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{option.label}</span>
                    <span style={{ fontSize: 10, opacity: isActive ? 0.95 : 0.45 }}>
                      {isActive ? 'ACTIVE' : 'APPLY'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={onReset}
            style={{
              width: '100%',
              background: 'rgba(250,247,242,0.08)',
              border: '1px solid rgba(250,247,242,0.2)',
              borderRadius: 8,
              color: 'rgba(250,247,242,0.92)',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              padding: '7px 8px',
              letterSpacing: '0.03em',
            }}
          >
            Reset All On
          </button>
        </div>
      )}
    </div>
  );
}

const WVWAMap = forwardRef(function WVWAMap({ selectedAva, onSelectAva, onMarkerClick, panelHoveredAva, onPanelHoverAva }, externalRef) {
  const mapContainerRef = useRef(null);
  const mapRef          = useRef(null);
  const popupRef        = useRef(null);
  const vineyardPopupRef = useRef(null);
  const avaDataRef      = useRef({});
  const [listings, setListings]         = useState([]);
  const [mapLoaded, setMapLoaded]       = useState(false);
  const [introComplete, setIntroComplete] = useState(false);
  const [activeLayer, setActiveLayer]   = useState(null);
  const [topoStats, setTopoStats]       = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [hoveredAva, setHoveredAva]     = useState(null);
  const [hoveredVineyardOrganization, setHoveredVineyardOrganization] = useState(null);
  const [selectedListing, setSelectedListing] = useState(null);
  const [hoveredListing, setHoveredListing] = useState(null);
  const [selectedVineyards, setSelectedVineyards] = useState([]); // GeoJSON features for selected listing's parcels
  const [parcelTopoStats, setParcelTopoStats] = useState({});     // { [parcelId]: topo stats }
  const [vineyardFocusMode, setVineyardFocusMode] = useState(false);
  const [listingFilterMode, setListingFilterMode] = useState(LISTING_FILTER_MODES.allWineries);
  const [listingSymbologyPreset, setListingSymbologyPreset] = useState(DEFAULT_LISTING_SYMBOLOGY);
  const [vineyardRecidSet, setVineyardRecidSet] = useState(() => new Set());
  const [insideIds, setInsideIds] = useState(null); // IDs inside the selected AVA, null = all
  const [devPanelOpen, setDevPanelOpen] = useState(true);
  const [devLayerToggles, setDevLayerToggles] = useState(DEV_LAYER_DEFAULTS);

  const listingsRef           = useRef([]);
  const missingParcelTopoStatsIdsRef = useRef(new Set());
  const selectedListingRef    = useRef(null);
  const setSelectedListingRef = useRef(null); // stable ref to the setter
  const setHoveredListingRef  = useRef(null); // stable ref for map closure hover
  const selectedAvaRef        = useRef(selectedAva);  // always-current read in imperative callbacks
  const panelHoveredAvaRef    = useRef(null);

  // Expose imperative methods for the SearchBar (and any external consumer)
  useImperativeHandle(externalRef, () => ({
    selectListingById(id) {
      const listing = listingsRef.current.find((l) => l.id === id);
      if (!listing) return;
      setSelectedListingRef.current?.(listing);
      if (mapRef.current) {
        mapRef.current.easeTo({ center: [listing.lng, listing.lat], zoom: 15, duration: 1900 });
      }
    },
    flyToCoords({ lng, lat, zoom = 14 }) {
      if (mapRef.current) {
        mapRef.current.easeTo({ center: [lng, lat], zoom, duration: 1600 });
      }
    },
  }), []);

  // Keep selectedListingRef in sync so map click handlers can update state
  const setSelectedListingBoth = useCallback((listing) => {
    selectedListingRef.current = listing;
    setSelectedListing(listing);
  }, []);

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

    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const leftDockPadding = Math.round(Math.min(360, Math.max(220, viewportWidth * 0.22)));
    const rightPanelVisible = !!(selectedListing || activeLayer);
    const rightPanelPadding = rightPanelVisible
      ? Math.round(Math.min(400, Math.max(250, viewportWidth * 0.26)))
      : 120;

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

    if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return;

    const isSingleFeature = features.length === 1;
    const cameraPadding = isSingleFeature
      ? { top: 90, bottom: 90, left: leftDockPadding, right: rightPanelPadding }
      : { top: 120, bottom: 120, left: leftDockPadding, right: rightPanelPadding };

    map.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      {
        padding: cameraPadding,
        duration: isSingleFeature ? 1350 : 1500,
        maxZoom: isSingleFeature ? 16.2 : 14.8,
      }
    );
  }, [selectedListing, activeLayer]);

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
    setListingVisibilityForIntro(map, introComplete);
    setListingVisualizationVisibility(
      map,
      introComplete && listingFilterMode !== LISTING_FILTER_MODES.noWineriesVisualized,
    );
    setListingSoftFocus(map, !!selectedListing || vineyardFocusMode);
    setVineyardVisualizationVisibility(map, listingFilterMode !== LISTING_FILTER_MODES.noVineyardsVisualized);
    setVineyardReferenceSoftFocus(map, !!selectedListing);
  }, [selectedListing, vineyardFocusMode, mapLoaded, introComplete, listingFilterMode]);
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
    const cat = LISTING_CATEGORIES[hoveredListing.category];
    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [hoveredListing.lng, hoveredListing.lat] },
        properties: { color: cat.color, num: String(hoveredListing.num) },
      }],
    });
  }, [hoveredListing, mapLoaded]);

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
    raiseListingLayers(map);
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
      center: [-98.5795, 39.8283], // geographic center of the contiguous US
      zoom: 3.5,
      pitch: 0,
      bearing: 0,
      minPitch: 0,
      maxPitch: 85,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: false }), 'bottom-right');

    map.on('load', async () => {
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
        const vineyardRaw = await vineyardRes.json();
        const vineyardFeatures = vineyardRaw?.features || [];

        // Build winery → parcel lookup from the full parcel dataset so selection,
        // grouping, and relinking work consistently across all datasets.
        const parcelLookupRes = await fetch(`${API_BASE}/api/vineyards/parcels`, { headers: API_HEADERS });
        const parcelLookupGeoJSON = parcelLookupRes.ok
          ? await parcelLookupRes.json()
          : { type: 'FeatureCollection', features: [] };

        VINEYARD_BY_RECID = {};
        for (const feature of parcelLookupGeoJSON.features || []) {
          const recid = feature?.properties?.winery_recid;
          if (recid != null) {
            if (!VINEYARD_BY_RECID[recid]) VINEYARD_BY_RECID[recid] = [];
            VINEYARD_BY_RECID[recid].push(feature);
          }
        }
        setVineyardRecidSet(new Set(Object.keys(VINEYARD_BY_RECID).map((id) => Number(id)).filter(Number.isFinite)));

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
            <div style="font-weight: 600; color: #1e293b;">Winery: <span style="font-weight: 400;">${wineryName}</span></div>
            ${vineyardName ? `<div style="font-weight: 600; color: #1e293b; margin-top: 2px;">Vineyard: <span style="font-weight: 400;">${vineyardName}</span></div>` : ''}
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
                padding: 80, duration: 1900, maxZoom: 17,
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
            <div style="font-weight: 600; color: #1e293b;">Winery: <span style="font-weight: 400;">Non-member winery</span></div>
            <div style="font-weight: 600; color: #1e293b; margin-top: 2px;">Vineyard: <span style="font-weight: 400;">${vineyardName}</span></div>
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
              'fill-color': ava.color,
              'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.18, 0.05],
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

      // ── Sub-AVA name labels ──────────────────────────────────────────
      for (const ava of WV_SUB_AVAS) {
        try {
          const src = map.getSource(`ava-${ava.slug}`);
          if (!src) continue;
          map.addLayer({
            id: `ava-${ava.slug}-label`,
            type: 'symbol',
            source: `ava-${ava.slug}`,
            layout: {
              'text-field': ava.name,
              'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
              'text-size': 11,
              'text-max-width': 8,
              'text-anchor': 'center',
            },
            paint: {
              'text-color': BRAND.eggshell,
              'text-halo-color': 'rgba(46,34,26,0.7)',
              'text-halo-width': 1.5,
              'text-opacity': 0.9,
            },
            minzoom: 9,
          });
        } catch (e) { /* ignore */ }
      }

      // ── Dedicated AVA hover highlight layer (always on top of AVA boundaries) ──
      map.addSource('ava-hover', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
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
      // Outer glow / halo ring
      map.addLayer({
        id: 'listings-selected-glow',
        type: 'circle',
        source: 'selected-listing',
        paint: {
          'circle-color': 'transparent',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 13, 14, 18],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#38BDF8',
          'circle-stroke-opacity': 0.5,
          'circle-opacity': 0,
          'circle-blur': 0.6,
        },
      });
      // Inner highlighted dot — same color as category, compact footprint
      map.addLayer({
        id: 'listings-selected-dot',
        type: 'circle',
        source: 'selected-listing',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 8.5],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#38BDF8',
          'circle-stroke-opacity': 1,
          'circle-opacity': 1,
        },
      });
      // Number label on top of the selected dot
      map.addLayer({
        id: 'listings-selected-num',
        type: 'symbol',
        source: 'selected-listing',
        layout: {
          'text-field': ['get', 'num'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 8,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#fff',
          'text-halo-color': 'rgba(0,0,0,0.25)',
          'text-halo-width': 0.5,
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 18, 14, 25],
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#38BDF8',
          'circle-stroke-opacity': 0.45,
          'circle-opacity': 0,
          'circle-blur': 0.5,
        },
      });
      // Hovered dot
      map.addLayer({
        id: 'listings-hovered-dot',
        type: 'circle',
        source: 'hovered-listing',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 15],
          'circle-stroke-width': 3,
          'circle-stroke-color': '#38BDF8',
          'circle-stroke-opacity': 0.85,
          'circle-opacity': 1,
        },
      });
      // Number label on hovered dot
      map.addLayer({
        id: 'listings-hovered-num',
        type: 'symbol',
        source: 'hovered-listing',
        layout: {
          'text-field': ['get', 'num'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 10,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#fff',
          'text-halo-color': 'rgba(0,0,0,0.25)',
          'text-halo-width': 0.5,
        },
      });

      applyListingFocusAccent(map, DEFAULT_LISTING_SYMBOLOGY);

      // ── Ensure highlight layers always render above everything else ──
      // AVA layers load asynchronously and can end up above the highlight
      // layers. Move all highlight layers to the top of the stack now that
      // all sources/layers have been added.
      raiseListingLayers(map);

      // ── Cluster click → zoom in ───────────────────────────────────
      map.on('click', 'listings-clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['listings-clusters'] });
        if (!features.length) return;
        const clusterId = features[0].properties.cluster_id;
        map.getSource('listings').getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          map.easeTo({ center: features[0].geometry.coordinates, zoom, duration: 1200 });
        });
      });

      // ── Unclustered dot click → right-side detail panel ──────────
      map.on('click', 'listings-unclustered', (e) => {
        if (!e.features?.length) return;
        const props = e.features[0].properties;
        const listing = listingsRef.current.find(l => l.id === props.id);
        if (!listing) return;
        setSelectedListingRef.current?.(listing);
        map.easeTo({ center: [listing.lng, listing.lat], zoom: 15, duration: 1900 });
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

      // ── Intro fly-in: single smooth arc from the US into the Willamette Valley ──
      setTimeout(() => {
        map.flyTo({
          center:   [WV_CAMERA.lng, WV_CAMERA.lat],
          zoom:     WV_CAMERA.zoom,
          pitch:    WV_CAMERA.pitch,
          bearing:  WV_CAMERA.bearing,
          duration: 3600,
          curve:    1.1,
          speed:    0.5,
          easing:   t => t * (2 - t),
        });
        map.once('moveend', () => setIntroComplete(true));
      }, 300);

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
            map.setPaintProperty(`ava-${ava.slug}-fill`, 'fill-opacity', isSelected ? 0.14 : 0);
          }
          if (map.getLayer(`ava-${ava.slug}-line`)) {
            map.setPaintProperty(`ava-${ava.slug}-line`, 'line-color',   '#EDE2D4');
            map.setPaintProperty(`ava-${ava.slug}-line`, 'line-opacity', isSelected ? 1.0 : 0);
            map.setPaintProperty(`ava-${ava.slug}-line`, 'line-width',   isSelected ? 3.5 : 2.5);
          }
          if (map.getLayer(`ava-${ava.slug}-label`)) {
            map.setPaintProperty(`ava-${ava.slug}-label`, 'text-opacity', isSelected ? 1 : 0);
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
      if (cam) {
        map.flyTo({
          center:   [cam.lng, cam.lat],
          zoom:     cam.zoom,
          pitch:    cam.pitch   ?? 40,
          bearing:  cam.bearing ?? 0,
          duration: 1800,
          essential: true,
        });
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
            map.fitBounds(bounds, { padding: 80, pitch: 40, duration: 1800 });
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
            map.setPaintProperty(`ava-${ava.slug}-fill`, 'fill-opacity',
              ['case', ['boolean', ['feature-state', 'hover'], false], 0.18, 0.05]);
          }
          if (map.getLayer(`ava-${ava.slug}-line`)) {
            map.setPaintProperty(`ava-${ava.slug}-line`, 'line-opacity', 1.0);
            map.setPaintProperty(`ava-${ava.slug}-line`, 'line-width',
              ['case', ['boolean', ['feature-state', 'hover'], false], 3.5, 2.5]);
          }
          if (map.getLayer(`ava-${ava.slug}-label`)) {
            map.setPaintProperty(`ava-${ava.slug}-label`, 'text-opacity', 0.9);
          }
        } catch (e) { /* ignore */ }
      }

      // ── Restore all listings layers — handled by listing filter effect ──

      map.flyTo({
        center:   [WV_CAMERA.lng, WV_CAMERA.lat],
        zoom:     WV_CAMERA.zoom,
        pitch:    WV_CAMERA.pitch   ?? 35,
        bearing:  WV_CAMERA.bearing ?? 0,
        duration: 1500,
        essential: true,
      });
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
      introComplete &&
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
        setListingSoftFocus(map, !!selectedListing || vineyardFocusMode);
        raiseListingLayers(map);
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
  }, []);

  const handleListingFilterModeChange = useCallback((mode) => {
    setListingFilterMode(mode);
  }, []);

  const handleListingSymbologyPresetChange = useCallback((preset) => {
    setListingSymbologyPreset(preset);
  }, []);

  const handleListingClick = useCallback((listing) => {
    setSelectedListingBoth(listing);
    if (mapRef.current) {
      mapRef.current.easeTo({ center: [listing.lng, listing.lat], zoom: 15, duration: 1900 });
    }
  }, [setSelectedListingBoth]);

  const handleHoverListing = useCallback((listing) => {
    setHoveredListing(listing); // null to clear
    setHoveredVineyardOrganization(null);
    onVineyardHover(listing ? (VINEYARD_BY_RECID[listing.id] || []) : null);
  }, [onVineyardHover]);

  // Keep setHoveredListingRef in sync so the map's [] closure can call it
  useEffect(() => { setHoveredListingRef.current = handleHoverListing; }, [handleHoverListing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    setLayerVisibility(map, 'wv-mask-fill', devLayerToggles.wvMask);
    setLayerVisibility(map, 'wv-boundary-line', devLayerToggles.wvBoundary);

    for (const ava of WV_SUB_AVAS) {
      setLayerVisibility(map, `ava-${ava.slug}-fill`, devLayerToggles.avaBoundaries);
      setLayerVisibility(map, `ava-${ava.slug}-line`, devLayerToggles.avaBoundaries);
      setLayerVisibility(map, `ava-${ava.slug}-label`, devLayerToggles.avaBoundaries);
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

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

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

      {/* Winery marker hover label */}
      {introComplete && hoveredListing && (
        <div style={{
          position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(72,55,41,0.82)', backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1.5px solid #87CEEB`, borderRadius: 8,
          padding: '5px 14px', fontSize: 13, fontWeight: 600, color: BRAND.eggshell,
          pointerEvents: 'none', zIndex: 5, fontFamily: 'Inter, sans-serif',
          boxShadow: '0 4px 20px rgba(46,34,26,0.25)',
        }}>
          {hoveredListing.title}
        </div>
      )}

      {/* Vineyard organization hover label */}
      {!hoveredListing && hoveredVineyardOrganization && (
        <div style={{
          position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(32,47,59,0.82)', backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1.5px solid #38BDF8', borderRadius: 8,
          padding: '5px 14px', fontSize: 13, fontWeight: 600, color: BRAND.eggshell,
          pointerEvents: 'none', zIndex: 5, fontFamily: 'Inter, sans-serif',
          boxShadow: '0 4px 20px rgba(15,23,42,0.25)',
        }}>
          {hoveredVineyardOrganization}
        </div>
      )}

      {/* Willamette logo — top-left map overlay */}
      {introComplete && (
      <div style={{
        position: 'absolute', top: 16, left: 72, zIndex: 10,
        pointerEvents: 'none',
      }}>
        <img
          src="/willamette-logo.svg"
          alt="Willamette Valley Wine Country"
          style={{ height: 40, width: 'auto', display: 'block', filter: 'drop-shadow(0 2px 6px rgba(46,34,26,0.5))' }}
        />
      </div>
      )}

      {/* Selected AVA badge — top center focal point when an AVA is selected */}
      {introComplete && selectedAva && (() => {
        const ava = WV_SUB_AVAS.find(a => a.slug === selectedAva);
        return ava ? (
          <div style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(46,34,26,0.88)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderRadius: 12,
            padding: '10px 20px',
            fontFamily: 'Inter, sans-serif',
            boxShadow: '0 4px 24px rgba(46,34,26,0.35)',
            border: `1.5px solid ${ava.color}55`,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            whiteSpace: 'nowrap',
          }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: ava.color,
              border: '1.5px solid rgba(250,247,242,0.4)',
              flexShrink: 0,
              boxShadow: `0 0 6px ${ava.color}88`,
            }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: BRAND.eggshell, letterSpacing: '0.01em' }}>
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

      {/* Desktop Dock — always visible */}
      {introComplete && mapLoaded && (
        <DesktopDock
          map={mapRef.current}
          mapLoaded={mapLoaded}
          listings={listings}
          selectedAva={selectedAva}
          onSelectAva={onSelectAva}
          activeLayer={activeLayer}
          onLayerChange={handleLayerChange}
          currentMonth={currentMonth}
          onMonthChange={setCurrentMonth}
          onHoverAva={handleMapHoverAva}
          topoStats={topoStats}
          listingFilterMode={listingFilterMode}
          onListingFilterModeChange={handleListingFilterModeChange}
          activeFilterLabel={activeFilterLabel}
          vineyardRecidSet={vineyardRecidSet}
          onListingClick={handleListingClick}
          onHoverListing={handleHoverListing}
          insideIds={insideIds}
          listingSymbologyPreset={listingSymbologyPreset}
          onListingSymbologyPresetChange={handleListingSymbologyPresetChange}
          listingSymbologyOptions={LISTING_SYMBOLOGY_OPTIONS}
        />
      )}

      {/* Category legend / filter — bottom center */}

      {/* ── Right-side context panel (tabbed when both listing + layer active) ── */}
      {introComplete && (selectedListing || activeLayer) && (
        <RightContextPanel
          listing={selectedListing}
          activeLayer={activeLayer}
          topoStats={topoStats}
          selectedAva={selectedAva}
          vineyards={selectedVineyards}
          parcelTopoStats={parcelTopoStats}
          onCloseListing={() => setSelectedListingBoth(null)}
          onCloseLayer={() => handleLayerChange(null)}
          onVineyardHover={onVineyardHover}
          onViewAllVineyards={onViewAllVineyards}
        />
      )}
    </div>
  );
});

export default WVWAMap;
