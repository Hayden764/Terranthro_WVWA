/**
 * PortalVineyardMap — lightweight MapLibre map for the winery portal.
 *
 * Props:
 *   parcels       {Array}    Array of parcel objects with a `.geometry` GeoJSON field
 *                            and `.id`, `.vineyard_name` properties.
 *   highlightId   {number}   Optional parcel id to emphasise (fill is brighter).
 *   height        {number}   CSS height in px (default 340).
 *   onParcelClick {fn}       Called with the parcel object when a user clicks a polygon.
 *   editParcelId  {number}   When set, activates draw-edit mode for that parcel.
 *   onGeometrySave {fn}      Called with (parcelId, geoJSONGeometry) when user saves edits.
 *   onEditCancel  {fn}       Called when user cancels edit mode.
 *   style         {Object}   Extra style overrides on the wrapper div.
 */
import { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;

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
        return {
          type: 'Feature',
          geometry: p.geometry,
          properties: {
            id: p.id,
            name: p.vineyard_name || 'Unnamed Parcel',
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
          'fill-color': '#4CAF50',
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
          'fill-color': '#8E1537',
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
            ['==', ['get', 'highlighted'], 1], '#8E1537',
            '#2d6a2e',
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
          'text-color': '#FFFFFF',
          'text-halo-color': 'rgba(0,0,0,0.65)',
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
            <div style="font-family:'Inter',sans-serif;min-width:160px;">
              <div style="font-weight:600;font-size:13px;color:#2E221A;margin-bottom:2px;">${name}</div>
              ${showSub ? `<div style="font-size:11px;color:#6B5344;margin-bottom:4px;">${parcelLabel}</div>` : ''}
              ${acres ? `<div style="font-size:12px;color:#8A7968;">${acres} acres</div>` : ''}
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

  // Update highlight without re-mounting the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const geojson = buildGeoJSON();
    const src = map.getSource('parcels');
    if (src) src.setData(geojson);
  }, [highlightId, buildGeoJSON]);

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
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParcelId]);

  const hasData = parcels.some((p) => p.geometry);

  if (!hasData) {
    return (
      <div style={{
        height,
        background: '#F0EBE3',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#8A7968',
        fontSize: 13,
        border: '1px solid #E0D8CE',
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
          borderRadius: editParcelId ? 0 : 8,
          overflow: 'hidden',
          border: '1px solid #E0D8CE',
        }}
      />

      {/* Edit mode overlay bar */}
      {editParcelId && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'rgba(30, 20, 14, 0.88)',
          backdropFilter: 'blur(4px)',
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          zIndex: 10,
        }}>
          <span style={{ color: '#e8d8c4', fontSize: 12, lineHeight: 1.4 }}>
            <strong style={{ color: '#fff' }}>Editing geometry</strong> — drag vertices to reshape the parcel boundary
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
    </div>
  );
}

const editCancelBtnStyle = {
  padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.25)',
  background: 'transparent', color: '#e8d8c4', fontSize: 12, cursor: 'pointer',
  fontFamily: "'Inter', sans-serif",
};

const editSaveBtnStyle = {
  padding: '6px 16px', borderRadius: 6, border: 'none',
  background: '#8E1537', color: '#fff', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: "'Inter', sans-serif",
};
