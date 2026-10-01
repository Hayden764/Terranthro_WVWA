/**
 * SiteVineyardMap — read-only satellite map for the public winery site.
 *
 * Blocks are filled by variety (fixed colours, see siteTheme.varietyColor) so a
 * reader can match the map to the legend. Deliberately separate from
 * PortalVineyardMap: no draw/edit code, so the public bundle stays small.
 *
 * Props:
 *   vineyards      {Array}   site payload vineyards (each with .key, .name, .blocks[])
 *   selectedKey    {string}  vineyard key to emphasise (others dimmed)
 *   focusKey       {string}  vineyard key to fit the camera to (default: all)
 *   onSelect       {fn}      called with a vineyard key when a block is clicked
 *   selectedBlockId {number} block to outline
 *   onBlockSelect  {fn}      called with a block id (only when selectedKey is set)
 *   height         {number}
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_STYLE } from '../../config/baseMapStyle';
import { varietyColor, UNKNOWN_VARIETY_COLOR } from '../../lib/siteTheme';

function toFeatureCollection(vineyards) {
  const features = [];
  for (const v of vineyards) {
    for (const b of v.blocks) {
      if (!b.geometry) continue;
      features.push({
        type: 'Feature',
        id: b.id,
        geometry: b.geometry,
        properties: { blockId: b.id, vineyardKey: v.key, color: varietyColor(b.variety) },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

function boundsOf(features) {
  const b = new maplibregl.LngLatBounds();
  const walk = (c) => (typeof c[0] === 'number' ? b.extend(c) : c.forEach(walk));
  features.forEach((f) => walk(f.geometry.coordinates));
  return b.isEmpty() ? null : b;
}

export default function SiteVineyardMap({
  vineyards, selectedKey = null, focusKey = null, onSelect, selectedBlockId = null, onBlockSelect, height = 420,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [ready, setReady] = useState(false);
  const fc = useMemo(() => toFeatureCollection(vineyards), [vineyards]);
  const handlers = useRef({});
  handlers.current = { onSelect, onBlockSelect, selectedKey };

  // Create the map once.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [-123.1, 45.2],
      zoom: 10,
      attributionControl: { compact: true },
      cooperativeGestures: true, // embedded in a scrolling page — don't hijack the wheel
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      map.addSource('blocks', { type: 'geojson', data: toFeatureCollection([]) });
      map.addLayer({
        id: 'blocks-fill', type: 'fill', source: 'blocks',
        paint: {
          'fill-color': ['get', 'color'],
          // Blocks without a recorded variety read as a light wash, not a colour.
          'fill-opacity': ['case',
            ['boolean', ['feature-state', 'dim'], false], 0.12,
            ['==', ['get', 'color'], UNKNOWN_VARIETY_COLOR], 0.22,
            0.72],
        },
      });
      map.addLayer({
        id: 'blocks-line', type: 'line', source: 'blocks',
        paint: {
          'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#FFFFFF', 'rgba(255,255,255,0.7)'],
          'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 1],
        },
      });
      map.on('click', 'blocks-fill', (e) => {
        const p = e.features[0]?.properties;
        if (!p) return;
        const h = handlers.current;
        if (h.selectedKey && p.vineyardKey === h.selectedKey) h.onBlockSelect?.(p.blockId);
        else h.onSelect?.(p.vineyardKey);
      });
      map.on('mouseenter', 'blocks-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'blocks-fill', () => { map.getCanvas().style.cursor = ''; });
      mapRef.current = map;
      setReady(true);
    });
    return () => { mapRef.current = null; map.remove(); };
  }, []);

  // Data + camera: refit when the data or the focused vineyard changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.getSource('blocks').setData(fc);
    const focus = focusKey ? fc.features.filter((f) => f.properties.vineyardKey === focusKey) : fc.features;
    const bounds = boundsOf(focus.length ? focus : fc.features);
    if (bounds) map.fitBounds(bounds, { padding: 40, maxZoom: 17, duration: 600 });
  }, [ready, fc, focusKey]);

  // Highlight state only — no camera move when a block is picked.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const f of fc.features) {
      map.setFeatureState({ source: 'blocks', id: f.id }, {
        dim: Boolean(selectedKey) && f.properties.vineyardKey !== selectedKey,
        selected: f.id === selectedBlockId,
      });
    }
  }, [ready, fc, selectedKey, selectedBlockId]);

  return <div ref={containerRef} style={{ width: '100%', height, borderRadius: 8, overflow: 'hidden' }} />;
}
