/**
 * PortalVineyardMap — lightweight MapLibre map for the winery portal.
 *
 * Props:
 *   parcels        {Array}    Array of parcel objects with a `.geometry` GeoJSON field
 *                             and `.id`, `.vineyard_name` properties.
 *   highlightId    {number}   Optional parcel id to emphasise (fill is brighter).
 *   height         {number}   CSS height in px (default 340).
 *   onParcelClick  {fn}       Called with the parcel object when a user clicks a polygon.
 *   editParcelId   {number}   When set, activates vertex-edit mode for that parcel.
 *   onGeometrySave {fn}       Called with (parcelId, geoJSONGeometry) when user saves edits.
 *   onEditCancel   {fn}       Called when user cancels edit mode.
 *   splitPreview     {Array}    Optional [featureA, featureB] GeoJSON Features to
 *                             overlay as a split preview (coloured A/B polygons).
 *   splitParcelId   {number}   When set, activates draw-line mode for that parcel.
 *   onSplitLineSave {fn}      Called with (parcelId, lineGeoJSON) when user saves split line.
 *   onSplitCancel  {fn}       Called when user cancels split mode.
 *   addMode        {boolean}  When true, activates draw-polygon mode for a new parcel.
 *   onAddSave      {fn}       Called with (geoJSONGeometry) when user saves new polygon.
 *   onAddCancel    {fn}       Called when user cancels add mode.
 *   style          {Object}   Extra style overrides on the wrapper div.
 */
import { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { alpha, border, crimson, ink, mix, muted, parchment, TOKENS } from '../styles/tokens';

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;

// MapLibre's color parser does not understand CSS variables (var(--…)) or
// color-mix(), so we use literal hex/rgba values for everything actually
// passed into MapLibre paint properties. These mirror the tokens.css palette.
const HEX = {
  ink:        '#080A0F',
  parchment:  '#E8E2D6',
  success:    '#00C44F',
  danger:     '#E03040',
  successDark:'#062a1a', // mix(success 60%, ink) — used for stroke
};

// UI constants for map layer styling
const UI = {
  parcelFill: HEX.success,
  parcelHighlight: HEX.danger,
  parcelStrokeBase: HEX.successDark,
  parcelLabelText: HEX.parchment,
  parcelLabelHalo: 'rgba(0,0,0,0.65)',
  popupTitle: TOKENS.ink,
  popupSub: muted,
  popupMeta: ink,
  editOverlayBg: alpha(TOKENS.ink, 0.88),
  editOverlayText: alpha(TOKENS.parchment, 0.88),
  splitOverlayBg: mix(TOKENS.electricBlue, 18, TOKENS.ink),
  splitOverlayText: alpha(TOKENS.parchment, 0.88),
  addOverlayBg: mix(TOKENS.success, 18, TOKENS.ink),
  addOverlayText: alpha(TOKENS.parchment, 0.88),
  overlayTitle: parchment,
  cancelBorder: alpha(parchment, 0.25),
  cancelText: alpha(TOKENS.parchment, 0.88),
};

// MapLibre v4+ requires ["literal", [...]] for array values inside expressions.
// @mapbox/mapbox-gl-draw's default theme uses bare arrays in line-dasharray match
// expressions, which MapLibre rejects. We override those two layers with fixed syntax.
const DRAW_STYLES = [
  // Polygon fill — inactive
  { id: 'gl-draw-polygon-fill-inactive', type: 'fill', filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']], paint: { 'fill-color': '#3bb2d0', 'fill-outline-color': '#3bb2d0', 'fill-opacity': 0.1 } },
  // Polygon fill — active
  { id: 'gl-draw-polygon-fill-active', type: 'fill', filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']], paint: { 'fill-color': '#fbb03b', 'fill-outline-color': '#fbb03b', 'fill-opacity': 0.1 } },
  // Polygon midpoints
  { id: 'gl-draw-polygon-midpoint', type: 'circle', source: 'mapbox-gl-draw-hot', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']], paint: { 'circle-radius': 3, 'circle-color': '#fbb03b' } },
  // Polygon stroke — inactive (solid line, no dasharray needed)
  { id: 'gl-draw-polygon-stroke-inactive', type: 'line', filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#3bb2d0', 'line-width': 2 } },
  // Polygon stroke — active
  { id: 'gl-draw-polygon-stroke-active', type: 'line', filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fbb03b', 'line-dasharray': ['literal', [0.5, 2]], 'line-width': 2 } },
  // Line — inactive
  { id: 'gl-draw-line-inactive', type: 'line', filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'LineString'], ['!=', 'mode', 'static']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#3bb2d0', 'line-width': 2 } },
  // Line — active (fixed dasharray)
  { id: 'gl-draw-line-active', type: 'line', filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'true']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fbb03b', 'line-dasharray': ['literal', [0.5, 2]], 'line-width': 2 } },
  // Vertex point halo
  { id: 'gl-draw-polygon-and-line-vertex-halo-active', type: 'circle', filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']], paint: { 'circle-radius': 7, 'circle-color': '#fff' } },
  // Vertex point
  { id: 'gl-draw-polygon-and-line-vertex-active', type: 'circle', filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']], paint: { 'circle-radius': 5, 'circle-color': '#fbb03b' } },
  // Static polygon fill
  { id: 'gl-draw-polygon-fill-static', type: 'fill', filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'Polygon']], paint: { 'fill-color': '#404040', 'fill-outline-color': '#404040', 'fill-opacity': 0.1 } },
  // Static polygon stroke
  { id: 'gl-draw-polygon-stroke-static', type: 'line', filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'Polygon']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#404040', 'line-width': 2 } },
  // Static line
  { id: 'gl-draw-line-static', type: 'line', filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'LineString']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#404040', 'line-width': 2 } },
  // Static point
  { id: 'gl-draw-point-static', type: 'circle', filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'Point']], paint: { 'circle-radius': 5, 'circle-color': '#404040' } },
];

const MAP_STYLE = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/019d98dc-0865-7ac5-a184-a072f37b9509/style.json?key=${MAPTILER_KEY}`
  : {
      version: 8,
      sources: {
        esri: {
          type: 'raster',
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Sources: Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [{ id: 'esri-bg', type: 'raster', source: 'esri' }],
    };

// Compute bounding box [[minLng, minLat], [maxLng, maxLat]] from an array of GeoJSON geometries.
function bboxFromGeometries(geometries) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  function processCoords(coords) {
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else {
      coords.forEach(processCoords);
    }
  }
  geometries.forEach((g) => g && processCoords(g.coordinates));
  return [[minLng, minLat], [maxLng, maxLat]];
}

export default function PortalVineyardMap({
  parcels = [],
  highlightId = null,
  height = 340,
  onParcelClick,
  editParcelId = null,
  onGeometrySave,
  onEditCancel,
  splitParcelId = null,
  onSplitLineSave,
  onSplitCancel,
  splitPreview = null,
  addMode = false,
  onAddSave,
  onAddCancel,
  style: wrapperStyle,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const drawRef = useRef(null);

  const buildGeoJSON = useCallback(() => {
    const features = parcels
      .filter((p) => p.geometry)
      .map((p) => {
        // Build a specific label: address if available, otherwise "Parcel #id"
        const address = [p.situs_address, p.situs_city].filter(Boolean).join(', ');
        const parcelLabel = address || `Parcel #${p.id}`;
        // Display name: prefer per-parcel label, then vineyard name, then fallback
        const displayName =
          (p.parcel_label && p.parcel_label.trim()) ||
          p.vineyard_name ||
          'Unnamed Parcel';
        return {
          type: 'Feature',
          geometry: p.geometry,
          properties: {
            id: p.id,
            name: displayName,
            parcelLabel,
            acres: p.acres ? Number(p.acres).toFixed(1) : null,
            highlighted: p.id === highlightId ? 1 : 0,
          },
        };
      });
    return { type: 'FeatureCollection', features };
  }, [parcels, highlightId]);

  useEffect(() => {
    if (!containerRef.current) return;

    const validParcels = parcels.filter((p) => p.geometry);
    if (validParcels.length === 0) return;

    const geojson = buildGeoJSON();

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [-123.05, 45.2],
      zoom: 10,
      attributionControl: false,
      interactive: true,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      // ── Source ────────────────────────────────────────────────────────
      map.addSource('parcels', { type: 'geojson', data: geojson });

      // ── Fill (base) ───────────────────────────────────────────────────
      map.addLayer({
        id: 'parcels-fill',
        type: 'fill',
        source: 'parcels',
        filter: ['==', ['get', 'highlighted'], 0],
        paint: {
          'fill-color': UI.parcelFill,
          'fill-opacity': 0.25,
        },
      });

      // ── Fill (highlighted) ────────────────────────────────────────────
      map.addLayer({
        id: 'parcels-fill-highlight',
        type: 'fill',
        source: 'parcels',
        filter: ['==', ['get', 'highlighted'], 1],
        paint: {
          'fill-color': UI.parcelHighlight,
          'fill-opacity': 0.45,
        },
      });

      // ── Stroke ────────────────────────────────────────────────────────
      map.addLayer({
        id: 'parcels-line',
        type: 'line',
        source: 'parcels',
        paint: {
          'line-color': [
            'case',
            ['==', ['get', 'highlighted'], 1], UI.parcelHighlight,
            UI.parcelStrokeBase,
          ],
          'line-width': [
            'case',
            ['==', ['get', 'highlighted'], 1], 2.5,
            1.5,
          ],
          'line-opacity': 0.9,
        },
      });

      // ── Label ─────────────────────────────────────────────────────────
      map.addLayer({
        id: 'parcels-label',
        type: 'symbol',
        source: 'parcels',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-size': 11,
          'text-anchor': 'center',
        },
        paint: {
          'text-color': UI.parcelLabelText,
          'text-halo-color': UI.parcelLabelHalo,
          'text-halo-width': 1.5,
        },
      });

      // ── Fit bounds ────────────────────────────────────────────────────
      const bbox = bboxFromGeometries(validParcels.map((p) => p.geometry));
      if (isFinite(bbox[0][0])) {
        map.fitBounds(bbox, { padding: 60, maxZoom: 16 });
      }

      // ── Hover cursor ──────────────────────────────────────────────────
      if (onParcelClick) {
        map.on('mouseenter', 'parcels-fill', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'parcels-fill', () => {
          map.getCanvas().style.cursor = '';
        });
        map.on('mouseenter', 'parcels-fill-highlight', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'parcels-fill-highlight', () => {
          map.getCanvas().style.cursor = '';
        });
      }

      // ── Click handler ─────────────────────────────────────────────────
      const handleClick = (e) => {
        const feature = e.features && e.features[0];
        if (!feature) return;

        const { id, name, parcelLabel, acres } = feature.properties;

        // If a click handler is provided, fire it directly — no popup
        if (onParcelClick) {
          const parcel = parcels.find((p) => String(p.id) === String(id));
          if (parcel) onParcelClick(parcel);
          return;
        }

        // Otherwise show an info popup (read-only context, no handler)
        const showSub = parcelLabel && parcelLabel !== name;
        if (popupRef.current) popupRef.current.remove();
        const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:var(--font-sans);min-width:160px;">
              <div style="font-weight:500;font-size:13px;color:${UI.popupTitle};margin-bottom:2px;">${name}</div>
              ${showSub ? `<div style="font-size:11px;color:${UI.popupSub};margin-bottom:4px;">${parcelLabel}</div>` : ''}
              ${acres ? `<div style="font-size:12px;color:${UI.popupMeta};">${acres} acres</div>` : ''}
            </div>
          `)
          .addTo(map);
        popupRef.current = popup;
      };

      map.on('click', 'parcels-fill', handleClick);
      map.on('click', 'parcels-fill-highlight', handleClick);
    });

    return () => {
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcels]);

  // ── Split preview polygons ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      // Remove existing preview layers/source
      ['split-preview-fill-a', 'split-preview-fill-b',
       'split-preview-line-a', 'split-preview-line-b'].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource('split-preview')) map.removeSource('split-preview');

      if (!splitPreview || splitPreview.length < 2) return;

      const [fA, fB] = splitPreview;
      const fc = {
        type: 'FeatureCollection',
        features: [
          { ...fA, properties: { piece: 'a' } },
          { ...fB, properties: { piece: 'b' } },
        ],
      };

      map.addSource('split-preview', { type: 'geojson', data: fc });

      map.addLayer({
        id: 'split-preview-fill-a', type: 'fill', source: 'split-preview',
        filter: ['==', ['get', 'piece'], 'a'],
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.35 },
      });
      map.addLayer({
        id: 'split-preview-fill-b', type: 'fill', source: 'split-preview',
        filter: ['==', ['get', 'piece'], 'b'],
        paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.35 },
      });
      map.addLayer({
        id: 'split-preview-line-a', type: 'line', source: 'split-preview',
        filter: ['==', ['get', 'piece'], 'a'],
        paint: { 'line-color': '#2563eb', 'line-width': 2 },
      });
      map.addLayer({
        id: 'split-preview-line-b', type: 'line', source: 'split-preview',
        filter: ['==', ['get', 'piece'], 'b'],
        paint: { 'line-color': '#d97706', 'line-width': 2 },
      });
    };

    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.once('load', apply);
    }
    return () => { map.off('load', apply); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitPreview]);

  // Update highlight without re-mounting the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const geojson = buildGeoJSON();
    const src = map.getSource('parcels');
    if (src) src.setData(geojson);
  }, [highlightId, buildGeoJSON]);

  // Helper: purge any stale MapboxDraw layers/sources that survived a prior
  // mount. Needed because in React StrictMode + maplibre's deferred style.load,
  // MapboxDraw's `onRemove` does not always clear its polling interval, so a
  // subsequent `onAdd` can race and try to add layers that already exist.
  const purgeDrawArtifacts = (map) => {
    if (!map) return;
    try {
      const style = map.getStyle && map.getStyle();
      const layers = style?.layers || [];
      layers.forEach((l) => {
        if (l.id && l.id.startsWith('gl-draw-') && map.getLayer(l.id)) {
          try { map.removeLayer(l.id); } catch (_) {}
        }
      });
      ['mapbox-gl-draw-cold', 'mapbox-gl-draw-hot'].forEach((sid) => {
        if (map.getSource(sid)) {
          try { map.removeSource(sid); } catch (_) {}
        }
      });
    } catch (_) { /* ignore */ }
  };

  // ── Draw / edit mode ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const activate = () => {
      if (!editParcelId) return;
      const parcel = parcels.find((p) => p.id === editParcelId);
      if (!parcel?.geometry) return;

      // Tear down any existing draw instance
      if (drawRef.current) {
        try { map.removeControl(drawRef.current); } catch (_) {}
        drawRef.current = null;
      }
      purgeDrawArtifacts(map);

      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
        defaultMode: 'simple_select',
        styles: DRAW_STYLES,
      });
      map.addControl(draw, 'top-left');
      drawRef.current = draw;

      // Load the parcel geometry as the editable feature
      const added = draw.add({
        type: 'Feature',
        id: String(editParcelId),
        geometry: parcel.geometry,
        properties: {},
      });
      // Enter direct-select mode on the feature so vertices are immediately visible
      if (added && added[0]) {
        draw.changeMode('direct_select', { featureId: added[0] });
      }

      // Fit map to the parcel
      const { bboxFromGeometries: _ } = {};
      map.fitBounds(bboxFromGeometries([parcel.geometry]), { padding: 80, maxZoom: 17 });
    };

    const deactivate = () => {
      if (drawRef.current) {
        try { map.removeControl(drawRef.current); } catch (_) {}
        drawRef.current = null;
      }
      purgeDrawArtifacts(map);
    };

    if (editParcelId) {
      // Map may still be loading when editParcelId first appears
      if (map.isStyleLoaded()) {
        activate();
      } else {
        map.once('load', activate);
      }
    } else {
      deactivate();
    }

    return () => {
      map.off('load', activate);
      // Always tear down any draw control on cleanup so React StrictMode
      // (and dep changes) cannot leave stale layers behind.
      deactivate();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParcelId]);

  // ── Split line draw mode ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const activate = () => {
      if (!splitParcelId) return;
      const parcel = parcels.find((p) => p.id === splitParcelId);
      if (!parcel?.geometry) return;

      if (drawRef.current) {
        try { map.removeControl(drawRef.current); } catch (_) {}
        drawRef.current = null;
      }
      purgeDrawArtifacts(map);

      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: { line_string: true, trash: true },
        defaultMode: 'draw_line_string',
        styles: DRAW_STYLES,
      });
      map.addControl(draw, 'top-left');
      drawRef.current = draw;

      map.fitBounds(bboxFromGeometries([parcel.geometry]), { padding: 80, maxZoom: 17 });
    };

    const deactivate = () => {
      if (drawRef.current) {
        try { map.removeControl(drawRef.current); } catch (_) {}
        drawRef.current = null;
      }
      purgeDrawArtifacts(map);
    };

    if (splitParcelId) {
      if (map.isStyleLoaded()) {
        activate();
      } else {
        map.once('load', activate);
      }
    } else {
      deactivate();
    }

    return () => {
      map.off('load', activate);
      deactivate();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitParcelId]);

  // ── Add parcel draw mode ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const activate = () => {
      if (drawRef.current) {
        try { map.removeControl(drawRef.current); } catch (_) {}
        drawRef.current = null;
      }
      purgeDrawArtifacts(map);

      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
        defaultMode: 'draw_polygon',
        styles: DRAW_STYLES,
      });
      map.addControl(draw, 'top-left');
      drawRef.current = draw;
    };

    const deactivate = () => {
      if (drawRef.current) {
        try { map.removeControl(drawRef.current); } catch (_) {}
        drawRef.current = null;
      }
      purgeDrawArtifacts(map);
    };

    if (addMode) {
      if (map.isStyleLoaded()) {
        activate();
      } else {
        map.once('load', activate);
      }
    } else {
      deactivate();
    }

    return () => {
      map.off('load', activate);
      deactivate();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addMode]);

  const hasData = parcels.some((p) => p.geometry);

  if (!hasData) {
    return (
      <div style={{
        height,
        background: parchment,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: muted,
        fontSize: 'var(--type-mono-size)',
        border: `1px solid ${border}`,
        ...wrapperStyle,
      }}>
        No geometry available for map display.
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height, ...wrapperStyle }}>
      <div
        ref={containerRef}
        style={{
          height: '100%',
          borderRadius: (editParcelId || splitParcelId || addMode) ? 0 : 8,
          overflow: 'hidden',
          border: `1px solid ${border}`,
        }}
      />

      {/* Edit mode overlay bar */}
      {editParcelId && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: UI.editOverlayBg,
          backdropFilter: 'blur(4px)',
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          zIndex: 10,
        }}>
          <span style={{ color: UI.editOverlayText, fontSize: 'var(--type-body-size)', lineHeight: 1.4 }}>
            <strong style={{ color: UI.overlayTitle }}>Editing geometry</strong> — drag vertices to reshape the parcel boundary
          </span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => {
                if (onEditCancel) onEditCancel();
              }}
              style={editCancelBtnStyle}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const draw = drawRef.current;
                if (!draw || !onGeometrySave) return;
                const fc = draw.getAll();
                const feature = fc.features[0];
                if (feature) onGeometrySave(editParcelId, feature.geometry);
              }}
              style={editSaveBtnStyle}
            >
              Save for Review →
            </button>
          </div>
        </div>
      )}

      {/* Split mode overlay bar */}
      {splitParcelId && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: UI.splitOverlayBg,
          backdropFilter: 'blur(4px)',
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          zIndex: 10,
        }}>
          <span style={{ color: UI.splitOverlayText, fontSize: 'var(--type-body-size)', lineHeight: 1.4 }}>
            <strong style={{ color: UI.overlayTitle }}>Step 1 of 2 — Draw split line</strong> — click to draw a line across the parcel, double-click to finish
          </span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => { if (onSplitCancel) onSplitCancel(); }}
              style={editCancelBtnStyle}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const draw = drawRef.current;
                if (!draw || !onSplitLineSave) return;
                const fc = draw.getAll();
                const line = fc.features.find((f) => f.geometry.type === 'LineString');
                if (line) onSplitLineSave(splitParcelId, line.geometry);
              }}
              style={editSaveBtnStyle}
            >
              Use This Line →
            </button>
          </div>
        </div>
      )}

      {/* Add parcel overlay bar */}
      {addMode && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: UI.addOverlayBg,
          backdropFilter: 'blur(4px)',
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          zIndex: 10,
        }}>
          <span style={{ color: UI.addOverlayText, fontSize: 'var(--type-body-size)', lineHeight: 1.4 }}>
            <strong style={{ color: UI.overlayTitle }}>Draw new parcel</strong> — click to place corners, double-click to close the polygon
          </span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => { if (onAddCancel) onAddCancel(); }}
              style={editCancelBtnStyle}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const draw = drawRef.current;
                if (!draw || !onAddSave) return;
                const fc = draw.getAll();
                const polygon = fc.features.find((f) => f.geometry.type === 'Polygon');
                if (polygon) onAddSave(polygon.geometry);
              }}
              style={editSaveBtnStyle}
            >
              Save for Review →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const editCancelBtnStyle = {
  padding: '6px 14px', borderRadius: 6, border: `1px solid ${UI.cancelBorder}`,
  background: 'transparent', color: UI.cancelText, fontSize: 'var(--type-body-size)', cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};

const editSaveBtnStyle = {
  padding: '6px 16px', borderRadius: 6, border: 'none',
  background: crimson, color: 'white', fontSize: 'var(--type-body-size)', fontWeight: 500,
  cursor: 'pointer', fontFamily: 'var(--font-sans)',
};
