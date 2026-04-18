/**
 * AdminGeometryDiffMap — small inline map showing old vs. new geometry.
 * Used in the admin review panel for geometry_update requests.
 *
 * Props:
 *   oldGeometry  {GeoJSON geometry}  Current parcel geometry (shown in amber)
 *   newGeometry  {GeoJSON geometry}  Proposed geometry (shown in teal/blue)
 *   height       {number}            CSS height in px (default 260)
 */
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;

const MAP_STYLE = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/019d98dc-0865-7ac5-a184-a072f37b9509/style.json?key=${MAPTILER_KEY}`
  : {
      version: 8,
      sources: {
        esri: {
          type: 'raster',
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Esri',
        },
      },
      layers: [{ id: 'esri-bg', type: 'raster', source: 'esri' }],
    };

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

export default function AdminGeometryDiffMap({ oldGeometry, newGeometry, height = 260 }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [-123.05, 45.2],
      zoom: 10,
      attributionControl: false,
      interactive: true,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      if (oldGeometry) {
        map.addSource('old-geom', {
          type: 'geojson',
          data: { type: 'Feature', geometry: oldGeometry, properties: {} },
        });
        map.addLayer({
          id: 'old-fill',
          type: 'fill',
          source: 'old-geom',
          paint: { 'fill-color': '#e8a020', 'fill-opacity': 0.25 },
        });
        map.addLayer({
          id: 'old-line',
          type: 'line',
          source: 'old-geom',
          paint: { 'line-color': '#e8a020', 'line-width': 2.5, 'line-opacity': 0.9 },
        });
      }

      if (newGeometry) {
        map.addSource('new-geom', {
          type: 'geojson',
          data: { type: 'Feature', geometry: newGeometry, properties: {} },
        });
        map.addLayer({
          id: 'new-fill',
          type: 'fill',
          source: 'new-geom',
          paint: { 'fill-color': '#2196f3', 'fill-opacity': 0.2 },
        });
        map.addLayer({
          id: 'new-line',
          type: 'line',
          source: 'new-geom',
          paint: { 'line-color': '#2196f3', 'line-width': 2.5, 'line-dasharray': ['literal', [3, 2]], 'line-opacity': 0.95 },
        });
      }

      // Fit to combined bbox
      const validGeoms = [oldGeometry, newGeometry].filter(Boolean);
      if (validGeoms.length > 0) {
        const bbox = bboxFromGeometries(validGeoms);
        if (isFinite(bbox[0][0])) {
          map.fitBounds(bbox, { padding: 48, maxZoom: 18 });
        }
      }
    });

    return () => { map.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div ref={containerRef} style={{ height }} />
      {/* Legend */}
      <div style={{
        position: 'absolute', top: 8, left: 8,
        background: 'rgba(10,10,18,0.80)', backdropFilter: 'blur(4px)',
        borderRadius: 5, padding: '6px 10px',
        display: 'flex', flexDirection: 'column', gap: 4,
        fontSize: 11, fontFamily: "'Inter', sans-serif",
      }}>
        {oldGeometry && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#e8a020' }}>
            <span style={{ display: 'inline-block', width: 22, height: 2, background: '#e8a020', borderRadius: 1 }} />
            Current boundary
          </span>
        )}
        {newGeometry && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64b5f6' }}>
            <span style={{ display: 'inline-block', width: 22, height: 2, background: '#64b5f6', borderRadius: 1, borderTop: '2px dashed #64b5f6' }} />
            Proposed boundary
          </span>
        )}
      </div>
    </div>
  );
}
