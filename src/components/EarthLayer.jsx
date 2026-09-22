import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import {
  EARTH_LAYER_TYPES,
  EARTH_LAYER_OPACITY,
  TERROIR_CLASS_COLORS,
  UNCLASSIFIED_COLOR,
  terroirClassColorExpression,
} from '../config/earthLayersConfig';

/**
 * Soils / bedrock geology vector layer (PMTiles). Fills map units by grower-facing
 * class, outlines them once zoomed in, and shows a details popup on click —
 * except where the click lands on a vineyard, which keeps its own behaviour.
 */

const VINEYARD_CLICK_LAYERS = ['vineyards-linked-fill', 'vineyards-reference-fill', 'vineyards-reference-passive-fill'];
// Draw under vineyard polygons so parcels stay readable on top of the soil colours
const BEFORE_LAYER_CANDIDATES = ['vineyards-reference-fill', 'wv-boundary-line'];

const sourceId = (id) => `earth-${id}`;
const fillId   = (id) => `earth-${id}-fill`;
const lineId   = (id) => `earth-${id}-line`;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function row(label, value) {
  if (value == null || value === '') return '';
  return `<div style="display:flex;gap:10px;justify-content:space-between;margin-top:3px">
    <span style="color:var(--color-muted);white-space:nowrap">${esc(label)}</span>
    <span style="text-align:right;color:var(--color-ink)">${esc(value)}</span></div>`;
}

function popupHtml(layerId, p) {
  const color = TERROIR_CLASS_COLORS[p.cls] ?? UNCLASSIFIED_COLOR;
  const chip = `<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;
      letter-spacing:.04em;text-transform:uppercase;color:var(--color-muted)">
      <span style="width:10px;height:10px;border-radius:2px;background:${color}"></span>${esc(p.cls || 'Unclassified')}</span>`;

  let title;
  let body;
  if (!p.name && !p.series && !p.unit) {
    // Zoomed-out tiles are dissolved by class and carry no unit attributes
    title = p.cls || 'Unclassified';
    body = '<div style="color:var(--color-muted);margin-top:2px">Zoom in for unit details.</div>';
  } else if (layerId === 'soils') {
    title = p.series ? `${p.series}${p.tex ? ` ${String(p.tex).toLowerCase()}` : ''}` : (p.name || 'Soil map unit');
    const rock = p.rockcm != null && p.rockcm !== '' ? `${Math.round(Number(p.rockcm) / 2.54)} in` : '> 79 in';
    body = [
      row('Map unit', p.name),
      row('Parent material', p.pm),
      row('Drainage', p.drain),
      row('Depth to bedrock', rock),
      row('Soil order', p.order),
      row('Dominant component', p.pct != null ? `${p.pct}%` : null),
    ].join('');
  } else {
    title = p.name || p.fm || 'Geologic unit';
    body = [
      row('Formation', p.fm && p.fm !== p.name ? p.fm : null),
      row('Age', p.age),
      row('Rock type', p.rock),
      row('Lithology', p.lith),
      row('Map symbol', p.unit),
    ].join('');
  }

  return `<div style="font-family:var(--font-sans);padding:10px 14px 12px;font-size:12.5px;
      line-height:1.4;min-width:220px;max-width:280px;color:var(--color-ink)">
    ${chip}
    <div style="font-weight:650;font-size:14px;margin:4px 0 6px">${esc(title)}</div>
    ${body}
  </div>`;
}

const EarthLayer = ({ map, activeLayer }) => {
  const popupRef = useRef(null);

  useEffect(() => {
    if (!map || !activeLayer) return undefined;
    const cfg = EARTH_LAYER_TYPES[activeLayer];
    if (!cfg) return undefined;

    const sid = sourceId(activeLayer);
    const fid = fillId(activeLayer);
    const lid = lineId(activeLayer);

    const remove = () => {
      try {
        if (map.getLayer(lid)) map.removeLayer(lid);
        if (map.getLayer(fid)) map.removeLayer(fid);
        if (map.getSource(sid)) map.removeSource(sid);
      } catch { /* map torn down */ }
    };

    remove();
    try {
      map.addSource(sid, {
        type: 'vector',
        url: `pmtiles://${new URL(cfg.url, window.location.origin).href}`,
        attribution: cfg.attribution,
      });
      const beforeId = BEFORE_LAYER_CANDIDATES.find((id) => map.getLayer(id));
      map.addLayer({
        id: fid,
        type: 'fill',
        source: sid,
        'source-layer': cfg.sourceLayer,
        paint: {
          'fill-color': terroirClassColorExpression(),
          'fill-opacity': EARTH_LAYER_OPACITY,
        },
      }, beforeId);
      map.addLayer({
        id: lid,
        type: 'line',
        source: sid,
        'source-layer': cfg.sourceLayer,
        minzoom: 11,
        paint: {
          'line-color': 'rgba(40, 32, 24, 0.45)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 15, 1],
        },
      }, beforeId);
    } catch (e) {
      console.warn(`EarthLayer: failed to add ${activeLayer}`, e);
      return remove;
    }

    const onClick = (e) => {
      const vineyardLayers = VINEYARD_CLICK_LAYERS.filter((id) => map.getLayer(id));
      if (vineyardLayers.length && map.queryRenderedFeatures(e.point, { layers: vineyardLayers }).length) return;
      const f = map.queryRenderedFeatures(e.point, { layers: [fid] })[0];
      if (!f) return;
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '300px', offset: 8 })
        .setLngLat(e.lngLat)
        .setHTML(popupHtml(activeLayer, f.properties || {}))
        .addTo(map);
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };

    map.on('click', fid, onClick);
    map.on('mouseenter', fid, onEnter);
    map.on('mouseleave', fid, onLeave);

    return () => {
      map.off('click', fid, onClick);
      map.off('mouseenter', fid, onEnter);
      map.off('mouseleave', fid, onLeave);
      popupRef.current?.remove();
      popupRef.current = null;
      remove();
    };
  }, [map, activeLayer]);

  return null;
};

export default EarthLayer;
