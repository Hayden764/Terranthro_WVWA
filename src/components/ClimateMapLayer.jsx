import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { overlayBeforeId, placeBelowVineyards } from '../lib/mapLayerOrder';
import {
  CLIMATE_MAP_LAYERS,
  CLIMATE_MAP_OPACITY,
  bandLabel,
  binColorExpression,
} from '../config/climateMapConfig';

/**
 * Heat-accumulation climate layers (one PMTiles file per layer).
 * The vintage layer holds every year; the year slider only swaps the filter, so
 * scrubbing never refetches tiles. Click/tap shows the band under the pointer —
 * except where it lands on a vineyard, which keeps its own behaviour.
 */

const SOURCE_ID = 'climate-gdd';
const FILL_ID = 'climate-gdd-fill';
const VINEYARD_CLICK_LAYERS = ['vineyards-linked-fill', 'vineyards-reference-fill', 'vineyards-reference-passive-fill'];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const num = (v) => (v == null || v === '' ? null : Number(v));

function popupHtml(layerId, p, year) {
  const cfg = CLIMATE_MAP_LAYERS[layerId];
  const color = cfg.colors[num(p.bin)] ?? 'transparent';
  const band = bandLabel(layerId, num(p.lo), num(p.hi));
  let kicker = cfg.label;
  let note = '';
  if (layerId === 'gdd_normal') {
    kicker = num(p.bin) === 0 ? 'Too cool for wine grapes' : `Winkler ${p.region}`;
    note = 'Average growing season, 1991–2020';
  } else if (layerId === 'gdd_vintage') {
    kicker = `${year} vintage`;
    note = 'Compared with the 1991–2020 normal';
  } else {
    note = '2016–2025 average vs 1991–2020';
  }
  return `<div style="font-family:var(--font-sans);padding:10px 14px 12px;font-size:12.5px;
      line-height:1.4;min-width:200px;max-width:260px;color:var(--color-ink)">
    <span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.04em;
      text-transform:uppercase;color:var(--color-muted)">
      <span style="width:10px;height:10px;border-radius:2px;background:${color}"></span>${esc(kicker)}</span>
    <div style="font-weight:650;font-size:14px;margin:4px 0 4px">${esc(band)}</div>
    <div style="color:var(--color-muted)">${esc(note)}</div>
  </div>`;
}

const ClimateMapLayer = ({ map, activeLayer, year }) => {
  const popupRef = useRef(null);
  const yearRef = useRef(year);
  yearRef.current = year;

  useEffect(() => {
    if (!map || !activeLayer) return undefined;
    const cfg = CLIMATE_MAP_LAYERS[activeLayer];
    if (!cfg) return undefined;

    const remove = () => {
      try {
        if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch { /* map torn down */ }
    };

    remove();
    try {
      map.addSource(SOURCE_ID, {
        type: 'vector',
        url: `pmtiles://${new URL(cfg.url, window.location.origin).href}`,
        attribution: 'PRISM Climate Group, Oregon State University',
      });
      map.addLayer({
        id: FILL_ID,
        type: 'fill',
        source: SOURCE_ID,
        'source-layer': cfg.sourceLayer,
        ...(activeLayer === 'gdd_vintage' ? { filter: ['==', ['to-number', ['get', 'yr']], yearRef.current] } : {}),
        paint: {
          'fill-color': binColorExpression(cfg.colors),
          'fill-opacity': CLIMATE_MAP_OPACITY,
          'fill-antialias': false, // no hairline seams between adjacent bands
        },
      }, overlayBeforeId(map));
      placeBelowVineyards(map, [FILL_ID]);
    } catch (e) {
      console.warn(`ClimateMapLayer: failed to add ${activeLayer}`, e);
      return remove;
    }

    const onClick = (e) => {
      const vineyardLayers = VINEYARD_CLICK_LAYERS.filter((id) => map.getLayer(id));
      if (vineyardLayers.length && map.queryRenderedFeatures(e.point, { layers: vineyardLayers }).length) return;
      const f = map.queryRenderedFeatures(e.point, { layers: [FILL_ID] })[0];
      if (!f) return;
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '280px', offset: 8 })
        .setLngLat(e.lngLat)
        .setHTML(popupHtml(activeLayer, f.properties || {}, yearRef.current))
        .addTo(map);
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };
    map.on('click', FILL_ID, onClick);
    map.on('mouseenter', FILL_ID, onEnter);
    map.on('mouseleave', FILL_ID, onLeave);

    return () => {
      map.off('click', FILL_ID, onClick);
      map.off('mouseenter', FILL_ID, onEnter);
      map.off('mouseleave', FILL_ID, onLeave);
      popupRef.current?.remove();
      popupRef.current = null;
      remove();
    };
  }, [map, activeLayer]);

  // Year changes only re-filter the vintage layer
  useEffect(() => {
    if (!map || activeLayer !== 'gdd_vintage' || !map.getLayer(FILL_ID)) return;
    map.setFilter(FILL_ID, ['==', ['to-number', ['get', 'yr']], year]);
    popupRef.current?.remove();
  }, [map, activeLayer, year]);

  return null;
};

export default ClimateMapLayer;
