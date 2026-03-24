import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import ClimateLayer from './ClimateLayer';
import TopographyLayer from './TopographyLayer';
import LayerPanel from './LayerPanel';
import wineries from '../data/wineries.json';
import { WV_SUB_AVAS } from '../config/topographyConfig';

// Convert flat winery array to GeoJSON FeatureCollection
const wineriesGeoJSON = {
  type: 'FeatureCollection',
  features: wineries
    .filter(w => w.loc?.coordinates?.length === 2)
    .map(w => ({
      type: 'Feature',
      geometry: w.loc,
      properties: {
        id:          w.recid,
        title:       w.title,
        description: w.description || '',
        phone:       w.phone || '',
        url:         w.url?.url || '',
        image_url:   w.image_url || '',
      }
    }))
};

// Willamette Valley approximate bounding box
const WV_BOUNDS = [[-123.65, 44.85], [-122.20, 45.85]];

export default function WVWAMap() {
  const mapContainerRef = useRef(null);
  const mapRef          = useRef(null);
  const popupRef        = useRef(null);
  const [mapLoaded, setMapLoaded]       = useState(false);
  const [activeLayer, setActiveLayer]   = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [hoveredAva, setHoveredAva]     = useState(null);

  const isClimateActive = activeLayer === 'tdmean';
  const isTopoActive    = ['elevation', 'slope', 'aspect'].includes(activeLayer);

  // ── Map initialization ────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://api.maptiler.com/maps/hybrid-v4/style.json?key=${import.meta.env.VITE_MAPTILER_KEY}`,
      bounds: WV_BOUNDS,
      fitBoundsOptions: { padding: 40 },
      pitch: 30,
      bearing: 0,
      minPitch: 0,
      maxPitch: 85,
    });

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

    map.on('load', async () => {
      // 3D terrain
      map.addSource('terrainSource', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
      });
      map.setTerrain({ source: 'terrainSource', exaggeration: 1.5 });

      // ── Load WV parent boundary ──────────────────────────────────────
      const wvRes = await fetch('/data/willamette_valley.geojson');
      const wvData = await wvRes.json();
      map.addSource('wv-boundary', { type: 'geojson', data: wvData });
      map.addLayer({
        id: 'wv-boundary-fill',
        type: 'fill',
        source: 'wv-boundary',
        paint: { 'fill-color': '#FFFFFF', 'fill-opacity': 0.03 },
      });
      map.addLayer({
        id: 'wv-boundary-line',
        type: 'line',
        source: 'wv-boundary',
        paint: { 'line-color': '#FFFFFF', 'line-width': 2, 'line-opacity': 0.5, 'line-dasharray': [4, 3] },
      });

      // ── Load each sub-AVA ────────────────────────────────────────────
      for (const ava of WV_SUB_AVAS) {
        try {
          const res = await fetch(ava.file);
          const data = await res.json();
          map.addSource(`ava-${ava.slug}`, { type: 'geojson', data });

          map.addLayer({
            id: `ava-${ava.slug}-fill`,
            type: 'fill',
            source: `ava-${ava.slug}`,
            paint: {
              'fill-color': ava.color,
              'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.30, 0.12],
            },
          });
          map.addLayer({
            id: `ava-${ava.slug}-line`,
            type: 'line',
            source: `ava-${ava.slug}`,
            paint: {
              'line-color': ava.color,
              'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1.5],
              'line-opacity': 0.85,
            },
          });

          // Hover cursor on sub-AVA fills
          map.on('mouseenter', `ava-${ava.slug}-fill`, () => {
            map.getCanvas().style.cursor = 'pointer';
            setHoveredAva(ava.slug);
          });
          map.on('mouseleave', `ava-${ava.slug}-fill`, () => {
            map.getCanvas().style.cursor = '';
            setHoveredAva(null);
          });
        } catch (e) {
          console.warn(`WVWAMap: failed to load ${ava.slug}`, e);
        }
      }

      // ── Sub-AVA name labels ──────────────────────────────────────────
      for (const ava of WV_SUB_AVAS) {
        // Approximate label centers (centroid-ish)
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
              'text-color': '#ffffff',
              'text-halo-color': 'rgba(0,0,0,0.65)',
              'text-halo-width': 1.5,
              'text-opacity': 0.85,
            },
            minzoom: 9,
          });
        } catch (e) { /* ignore */ }
      }

      // ── Winery markers ───────────────────────────────────────────────
      map.addSource('wineries', { type: 'geojson', data: wineriesGeoJSON });

      map.addLayer({
        id: 'winery-shadow',
        type: 'circle',
        source: 'wineries',
        paint: {
          'circle-radius': 7,
          'circle-color': 'rgba(0,0,0,0.25)',
          'circle-blur': 1,
          'circle-translate': [0, 2],
        },
      });

      map.addLayer({
        id: 'winery-circles',
        type: 'circle',
        source: 'wineries',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 12, 7, 15, 9],
          'circle-color': '#6B1E1E',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.92,
        },
      });

      // Winery hover cursor
      map.on('mouseenter', 'winery-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'winery-circles', () => { map.getCanvas().style.cursor = ''; });

      // Winery click → popup
      map.on('click', 'winery-circles', (e) => {
        const props = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates.slice();

        if (popupRef.current) popupRef.current.remove();

        const descSnippet = props.description
          ? props.description.slice(0, 180) + (props.description.length > 180 ? '…' : '')
          : '';

        const html = `
          <div style="font-family:Inter,sans-serif;width:240px;overflow:hidden;">
            ${props.image_url ? `<img src="${props.image_url}" alt="${props.title}" style="width:100%;height:120px;object-fit:cover;border-radius:6px 6px 0 0;display:block;" onerror="this.style.display='none'" />` : ''}
            <div style="padding:10px 12px 12px;">
              <div style="font-weight:700;font-size:14px;color:#111827;margin-bottom:4px;">${props.title}</div>
              ${descSnippet ? `<div style="font-size:11px;color:#6b7280;line-height:1.5;margin-bottom:8px;">${descSnippet}</div>` : ''}
              <div style="display:flex;flex-direction:column;gap:4px;">
                ${props.phone ? `<a href="tel:${props.phone}" style="font-size:12px;color:#1B4332;text-decoration:none;">📞 ${props.phone}</a>` : ''}
                ${props.url ? `<a href="${props.url}" target="_blank" rel="noopener" style="display:inline-block;margin-top:4px;padding:5px 10px;background:#1B4332;color:#fff;border-radius:5px;font-size:11px;font-weight:600;text-decoration:none;text-align:center;">Visit Website</a>` : ''}
              </div>
            </div>
          </div>`;

        popupRef.current = new maplibregl.Popup({ maxWidth: '260px', offset: 12 })
          .setLngLat(coords)
          .setHTML(html)
          .addTo(map);
      });

      setMapLoaded(true);
    });

    mapRef.current = map;

    return () => {
      if (popupRef.current) popupRef.current.remove();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        setMapLoaded(false);
      }
    };
  }, []);

  const handleLayerChange = useCallback((layer) => {
    setActiveLayer(layer);
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* AVA hover label */}
      {hoveredAva && (() => {
        const ava = WV_SUB_AVAS.find(a => a.slug === hoveredAva);
        return ava ? (
          <div style={{
            position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)',
            border: `2px solid ${ava.color}`, borderRadius: 8,
            padding: '5px 14px', fontSize: 13, fontWeight: 600, color: '#111827',
            pointerEvents: 'none', zIndex: 5, fontFamily: 'Inter, sans-serif',
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
          }}>
            {ava.name}
          </div>
        ) : null;
      })()}

      {/* Climate raster layer */}
      {mapLoaded && mapRef.current && (
        <ClimateLayer
          map={mapRef.current}
          isVisible={isClimateActive}
          currentMonth={currentMonth}
          prismVar="tdmean"
          colormap="plasma"
        />
      )}

      {/* Topography raster layers (all 8 sub-AVAs) */}
      {mapLoaded && mapRef.current && (
        <TopographyLayer
          map={mapRef.current}
          activeLayer={isTopoActive ? activeLayer : null}
        />
      )}

      {/* Layer panel */}
      <LayerPanel
        activeLayer={activeLayer}
        onLayerChange={handleLayerChange}
        currentMonth={currentMonth}
        onMonthChange={setCurrentMonth}
      />
    </div>
  );
}
