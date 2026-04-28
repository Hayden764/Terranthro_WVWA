/**
 * AdminBatchMap — shared map for reviewing an admin_batch_edit request.
 *
 * Renders all geometry ops on one map:
 *   - Old boundaries  (amber solid fill/line)
 *   - New boundaries  (blue dashed fill/line)
 *
 * Props:
 *   ops         {Array}   Full ops array from the batch payload
 *   activeIndex {number|null}  Index into geomOps (null = all visible, full opacity)
 *   showOld     {boolean}
 *   showNew     {boolean}
 *   height      {number}  px (default 520)
 */
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { TOKENS, alpha } from '../../styles/tokens';
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
  geometries.forEach((g) => g && g.coordinates && processCoords(g.coordinates));
  return [[minLng, minLat], [maxLng, maxLat]];
}

export default function AdminBatchMap({ ops = [], activeIndex = null, showOld = true, showNew = true, height = 520 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // geometry + add ops (both have spatial extents to display)
  const geomOps = ops.reduce((acc, op, i) => {
    if (op.op === 'geometry' || op.op === 'add') acc.push({ ...op, opsIndex: i });
    return acc;
  }, []);

  // ── Create map once ────────────────────────────────────────────────────────
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
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      // audit-ignore-start map-style-colors
      geomOps.forEach((op, gi) => {
        if (op.before_geom) {
          map.addSource(`old-src-${gi}`, {
            type: 'geojson',
            data: { type: 'Feature', geometry: op.before_geom, properties: {} },
          });
          map.addLayer({
            id: `old-fill-${gi}`,
            type: 'fill',
            source: `old-src-${gi}`,
            paint: { 'fill-color': '#e8a020', 'fill-opacity': 0.25 },
          });
          map.addLayer({
            id: `old-line-${gi}`,
            type: 'line',
            source: `old-src-${gi}`,
            paint: { 'line-color': '#e8a020', 'line-width': 2.5, 'line-opacity': 0.9 },
          });
        }

        if (op.geometry) {
          const isAdd = op.op === 'add';
          const fillColor = isAdd ? '#22c55e' : '#2196f3';
          const lineColor = isAdd ? '#22c55e' : '#2196f3';
          map.addSource(`new-src-${gi}`, {
            type: 'geojson',
            data: { type: 'Feature', geometry: op.geometry, properties: {} },
          });
          map.addLayer({
            id: `new-fill-${gi}`,
            type: 'fill',
            source: `new-src-${gi}`,
            paint: { 'fill-color': fillColor, 'fill-opacity': 0.25 },
          });
          map.addLayer({
            id: `new-line-${gi}`,
            type: 'line',
            source: `new-src-${gi}`,
            paint: {
              'line-color': lineColor,
              'line-width': 2.5,
              'line-dasharray': isAdd ? undefined : ['literal', [3, 2]],
              'line-opacity': 0.95,
            },
          });
        }
      });
      // audit-ignore-end

      // Initial fit to all ops combined
      const allGeoms = geomOps.flatMap((op) => [op.before_geom, op.geometry].filter(Boolean));
      if (allGeoms.length > 0) {
        const bbox = bboxFromGeometries(allGeoms);
        if (isFinite(bbox[0][0])) map.fitBounds(bbox, { padding: 56, maxZoom: 18 });
      }

      setMapLoaded(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── React to activeIndex changes: opacity + fitBounds ─────────────────────
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    geomOps.forEach((op, gi) => {
      const isActive = activeIndex === null || activeIndex === gi;
      const fillOpacityOld = isActive ? 0.25 : 0.05;
      const lineOpacityOld = isActive ? 0.9  : 0.15;
      const fillOpacityNew = isActive ? 0.20 : 0.05;
      const lineOpacityNew = isActive ? 0.95 : 0.15;

      if (map.getLayer(`old-fill-${gi}`)) map.setPaintProperty(`old-fill-${gi}`, 'fill-opacity', fillOpacityOld);
      if (map.getLayer(`old-line-${gi}`)) map.setPaintProperty(`old-line-${gi}`, 'line-opacity', lineOpacityOld);
      if (map.getLayer(`new-fill-${gi}`)) map.setPaintProperty(`new-fill-${gi}`, 'fill-opacity', fillOpacityNew);
      if (map.getLayer(`new-line-${gi}`)) map.setPaintProperty(`new-line-${gi}`, 'line-opacity', lineOpacityNew);
    });

    if (activeIndex !== null && geomOps[activeIndex]) {
      const op = geomOps[activeIndex];
      const geoms = [op.before_geom, op.geometry].filter(Boolean);
      if (geoms.length > 0) {
        const bbox = bboxFromGeometries(geoms);
        if (isFinite(bbox[0][0])) map.fitBounds(bbox, { padding: 72, maxZoom: 18, duration: 600 });
      }
    } else if (activeIndex === null) {
      // Zoom back out to all
      const allGeoms = geomOps.flatMap((op) => [op.before_geom, op.geometry].filter(Boolean));
      if (allGeoms.length > 0) {
        const bbox = bboxFromGeometries(allGeoms);
        if (isFinite(bbox[0][0])) map.fitBounds(bbox, { padding: 56, maxZoom: 18, duration: 600 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, activeIndex]);

  // ── React to showOld / showNew toggle ─────────────────────────────────────
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    geomOps.forEach((op, gi) => {
      const oldVis = showOld ? 'visible' : 'none';
      // add ops have no "old" — always show their new polygon
      const newVis = (showNew || op.op === 'add') ? 'visible' : 'none';
      if (map.getLayer(`old-fill-${gi}`)) map.setLayoutProperty(`old-fill-${gi}`, 'visibility', oldVis);
      if (map.getLayer(`old-line-${gi}`)) map.setLayoutProperty(`old-line-${gi}`, 'visibility', oldVis);
      if (map.getLayer(`new-fill-${gi}`)) map.setLayoutProperty(`new-fill-${gi}`, 'visibility', newVis);
      if (map.getLayer(`new-line-${gi}`)) map.setLayoutProperty(`new-line-${gi}`, 'visibility', newVis);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, showOld, showNew]);

  return (
    <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: `1px solid ${alpha(TOKENS.parchment, 0.08)}` }}>
      <div ref={containerRef} style={{ height }} />

      {/* Legend */}
      <div style={{
        position: 'absolute', top: 8, left: 8,
        background: alpha(TOKENS.ink, 0.82), backdropFilter: 'blur(4px)',
        borderRadius: 6, padding: '7px 11px',
        display: 'flex', flexDirection: 'column', gap: 5,
        fontSize: 11, fontFamily: "'Inter', sans-serif",
        pointerEvents: 'none',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: showOld ? TOKENS.warning : alpha(TOKENS.parchment, 0.35) }}>
          <span style={{ display: 'inline-block', width: 20, height: 2, background: showOld ? TOKENS.warning : alpha(TOKENS.parchment, 0.35), borderRadius: 1 }} />
          Old boundary
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: showNew ? TOKENS.electricBlue : alpha(TOKENS.parchment, 0.35) }}>
          <span style={{ display: 'inline-block', width: 20, height: 2, background: showNew ? TOKENS.electricBlue : alpha(TOKENS.parchment, 0.35), borderRadius: 1, borderTop: showNew ? `2px dashed ${TOKENS.electricBlue}` : 'none' }} />
          Proposed boundary
        </span>
      </div>

      {geomOps.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', color: alpha(TOKENS.parchment, 0.35), fontSize: 13, fontStyle: 'italic',
        }}>
          No geometry ops in this batch
        </div>
      )}
    </div>
  );
}
