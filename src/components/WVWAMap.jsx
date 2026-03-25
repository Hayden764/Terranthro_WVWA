import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import ClimateLayer from './ClimateLayer';
import TopographyLayer from './TopographyLayer';
import DesktopDock from './dock/DesktopDock';
import wineries from '../data/wineries.json';
import { WV_SUB_AVAS } from '../config/topographyConfig';
import { AVA_CAMERA, WV_CAMERA } from '../config/avaCameraConfig';
import { BRAND } from '../config/brandColors';

// ── Listing categories ────────────────────────────────────────────────────
export const LISTING_CATEGORIES = {
  hotel:      { label: 'Hotel / Inn',        color: '#C47C2B', icon: '🏨', emoji: '🏨' },
  restaurant: { label: 'Restaurant / Dining', color: '#2B7A4B', icon: '🍽️', emoji: '🍽️' },
  tasting:    { label: 'Tasting Room',        color: '#6B3A8E', icon: '🍷', emoji: '🍷' },
  winery:     { label: 'Winery / Vineyard',   color: BRAND.burgundy, icon: '🍇', emoji: '🍇' },
  other:      { label: 'Other',               color: BRAND.brownLight, icon: '📍', emoji: '📍' },
};

function classifyListing(item) {
  const text = ((item.description || '') + ' ' + item.title).toLowerCase();
  const isHotel      = /hotel|silo suite|b&b|bed and breakfast|\blodge\b|resort|inn |overnight|accommodation/.test(text);
  const isRestaurant = /restaurant|\bdining\b|bistro|\bcafe\b|culinary|farm-to-table/.test(text);
  const isTasting    = /tasting room/.test(text);
  const isWinery     = /winery|pinot|chardonnay|cellar|vineyard|sparkling|viticulture/.test(text);

  if (isHotel && !isRestaurant && !isWinery) return 'hotel';
  if (isRestaurant && !isWinery) return 'restaurant';
  if (isTasting) return 'tasting';
  if (isWinery) return 'winery';
  if (isHotel) return 'hotel';
  return 'other';
}

// Enrich listings with category + global number at module load time
const LISTINGS = wineries
  .filter(w => w.loc?.coordinates?.length === 2)
  .map((w, i) => ({
    id:        w.recid,
    num:       i + 1,               // global sequential number (1-based)
    title:     w.title,
    desc:      w.description || '',
    phone:     w.phone || '',
    url:       w.url?.url || '',
    image_url: w.image_url || '',
    lng:       w.loc.coordinates[0],
    lat:       w.loc.coordinates[1],
    category:  classifyListing(w),
  }));

// Willamette Valley approximate bounding box
const WV_BOUNDS = [[-123.8, 44.0], [-122.0, 45.9]];

// Build a GeoJSON FeatureCollection for the listings source, filtered by
// category set and optional AVA id allowlist.
function buildListingsGeoJSON(activeCategories, insideIds = null) {
  const features = LISTINGS
    .filter(l => {
      if (!activeCategories.has(l.category)) return false;
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

// Shared popup builder — used by map click and directory modal
function openListingPopup(map, listing, coords, popupRef) {
  if (popupRef.current) popupRef.current.remove();
  const cat = LISTING_CATEGORIES[listing.category];

  const descSnippet = listing.desc
    ? listing.desc.slice(0, 200) + (listing.desc.length > 200 ? '…' : '')
    : '';

  const catBadge = `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${cat.color}22;border:1px solid ${cat.color}55;color:${cat.color};font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:8px;">${cat.label}</span>`;

  const html = `
    <div style="font-family:Inter,sans-serif;width:256px;overflow:hidden;">
      ${listing.image_url ? `<img src="${listing.image_url}" alt="${listing.title}" style="width:100%;height:130px;object-fit:cover;display:block;" onerror="this.style.display='none'" />` : ''}
      <div style="padding:12px 14px 14px;">
        ${catBadge}
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="width:22px;height:22px;border-radius:50%;background:${cat.color};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0;">${listing.num}</span>
          <div style="font-weight:700;font-size:14px;color:#2E221A;line-height:1.3;">${listing.title}</div>
        </div>
        ${descSnippet ? `<div style="font-size:11px;color:#8A7968;line-height:1.55;margin-bottom:10px;">${descSnippet}</div>` : ''}
        <div style="display:flex;flex-direction:column;gap:5px;">
          ${listing.phone ? `<a href="tel:${listing.phone}" style="font-size:12px;color:#483729;text-decoration:none;">📞 ${listing.phone}</a>` : ''}
          ${listing.url ? `<a href="${listing.url}" target="_blank" rel="noopener" style="display:inline-block;margin-top:4px;padding:6px 12px;background:${cat.color};color:#fff;border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;text-align:center;">Visit Website ↗</a>` : ''}
        </div>
      </div>
    </div>`;

  popupRef.current = new maplibregl.Popup({ maxWidth: '270px', offset: 14, closeButton: true })
    .setLngLat(coords)
    .setHTML(html)
    .addTo(map);
}

// Export LISTINGS so the directory modal can use them
export { LISTINGS };

export default function WVWAMap({ selectedAva, onSelectAva, onMarkerClick, registerMarkerRef, panelHoveredAva, onPanelHoverAva }) {
  const mapContainerRef = useRef(null);
  const mapRef          = useRef(null);
  const popupRef        = useRef(null);
  const avaDataRef      = useRef({});
  const [mapLoaded, setMapLoaded]       = useState(false);
  const [introComplete, setIntroComplete] = useState(false);
  const [activeLayer, setActiveLayer]   = useState(null);
  const [topoStats, setTopoStats]       = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [hoveredAva, setHoveredAva]     = useState(null);
  const [selectedListing, setSelectedListing] = useState(null);
  const [hoveredListing, setHoveredListing] = useState(null);
  const [activeCategories, setActiveCategories] = useState(
    () => new Set() // start with all categories off — user enables what they want
  );
  const [insideIds, setInsideIds] = useState(null); // IDs inside the selected AVA, null = all

  const selectedListingRef = useRef(null);
  const setSelectedListingRef = useRef(null); // stable ref to the setter
  const setHoveredListingRef  = useRef(null); // stable ref for map closure hover

  // Keep selectedListingRef in sync so map click handlers can update state
  const setSelectedListingBoth = useCallback((listing) => {
    selectedListingRef.current = listing;
    setSelectedListing(listing);
  }, []);

  // Store the setter in a ref so the map's [] effect closure can call it
  useEffect(() => { setSelectedListingRef.current = setSelectedListingBoth; }, [setSelectedListingBoth]);

  // Refs to share current filter state with map effects without stale closures
  const insideIdsRef = useRef(null);
  const activeCategoriesRef = useRef(new Set()); // starts empty, synced to state

  // Keep activeCategoriesRef in sync with state
  useEffect(() => {
    activeCategoriesRef.current = activeCategories;
  }, [activeCategories]);

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

  // ── Panel hover → highlight that AVA border in sky blue ─────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || selectedAva) return; // don't interfere when an AVA is selected
    for (const ava of WV_SUB_AVAS) {
      const lineId = `ava-${ava.slug}-line`;
      const fillId = `ava-${ava.slug}-fill`;
      if (!map.getLayer(lineId)) continue;
      try {
        if (ava.slug === panelHoveredAva) {
          // Move fill + line to top so they render above sibling AVA layers
          if (map.getLayer(fillId)) map.moveLayer(fillId);
          map.moveLayer(lineId);
          map.setPaintProperty(lineId, 'line-color', '#38BDF8');
          map.setPaintProperty(lineId, 'line-width', 3);
          map.setPaintProperty(lineId, 'line-opacity', 1);
        } else {
          map.setPaintProperty(lineId, 'line-color', '#C9A84C');
          map.setPaintProperty(lineId, 'line-width',
            ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1.8]);
          map.setPaintProperty(lineId, 'line-opacity',
            ['case', ['boolean', ['feature-state', 'hover'], false], 1.0, 0.75]);
        }
      } catch (e) { /* ignore */ }
    }
  }, [panelHoveredAva, mapLoaded, selectedAva]);

  const isClimateActive = activeLayer === 'tdmean';
  const isTopoActive    = ['elevation', 'slope', 'aspect'].includes(activeLayer);

  // ── Map initialization ────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://api.maptiler.com/maps/hybrid-v4/style.json?key=${import.meta.env.VITE_MAPTILER_KEY}`,
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
          'line-color': '#C9A84C',
          'line-width': 2,
          'line-opacity': 0.9,
        },
      });

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
              'line-color': '#C9A84C',
              'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1.8],
              'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1.0, 0.75],
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

      // ── GeoJSON source for clustered markers ─────────────────────────
      // Initial data uses all categories (activeCategoriesRef holds current state)
      map.addSource('listings', {
        type: 'geojson',
        data: buildListingsGeoJSON(activeCategoriesRef.current),
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 40,
      });

      // Cluster circles
      map.addLayer({
        id: 'listings-clusters',
        type: 'circle',
        source: 'listings',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            'rgba(255,255,255,0.82)', 10,
            'rgba(255,255,255,0.72)', 30,
            'rgba(255,255,255,0.62)',
          ],
          'circle-radius': ['step', ['get', 'point_count'], 18, 10, 24, 30, 30],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(255,255,255,0.4)',
          'circle-opacity': 1,
        },
      });

      // Cluster count labels
      map.addLayer({
        id: 'listings-cluster-count',
        type: 'symbol',
        source: 'listings',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 12,
        },
        paint: {
          'text-color': '#2E221A',
          'text-halo-color': 'rgba(255,255,255,0.3)',
          'text-halo-width': 0.5,
        },
      });

      // Individual unclustered dots — colored by category
      map.addLayer({
        id: 'listings-unclustered',
        type: 'circle',
        source: 'listings',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 7, 14, 11],
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(255,255,255,0.55)',
          'circle-opacity': 0.92,
        },
      });

      // Number labels on unclustered dots (visible at zoom ≥ 12)
      map.addLayer({
        id: 'listings-unclustered-num',
        type: 'symbol',
        source: 'listings',
        filter: ['!', ['has', 'point_count']],
        minzoom: 12,
        layout: {
          'text-field': ['to-string', ['get', 'num']],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 9,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#fff',
          'text-halo-color': 'rgba(0,0,0,0.2)',
          'text-halo-width': 0.5,
        },
      });

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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 20, 14, 28],
          'circle-stroke-width': 3,
          'circle-stroke-color': '#38BDF8',
          'circle-stroke-opacity': 0.55,
          'circle-opacity': 0,
          'circle-blur': 0.6,
        },
      });
      // Inner highlighted dot — same color as category, bigger + blue stroke
      map.addLayer({
        id: 'listings-selected-dot',
        type: 'circle',
        source: 'selected-listing',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 12, 14, 17],
          'circle-stroke-width': 3.5,
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

      // ── Ensure highlight layers always render above everything else ──
      // AVA layers load asynchronously and can end up above the highlight
      // layers. Move all highlight layers to the top of the stack now that
      // all sources/layers have been added.
      for (const layerId of [
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
      ]) {
        if (map.getLayer(layerId)) map.moveLayer(layerId);
      }

      // ── Cluster click → zoom in ───────────────────────────────────
      map.on('click', 'listings-clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['listings-clusters'] });
        if (!features.length) return;
        const clusterId = features[0].properties.cluster_id;
        map.getSource('listings').getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          map.easeTo({ center: features[0].geometry.coordinates, zoom });
        });
      });

      // ── Unclustered dot click → right-side detail panel ──────────
      map.on('click', 'listings-unclustered', (e) => {
        if (!e.features?.length) return;
        const props = e.features[0].properties;
        const listing = LISTINGS.find(l => l.id === props.id);
        if (!listing) return;
        setSelectedListingRef.current?.(listing);
        map.easeTo({ center: [listing.lng, listing.lat], zoom: 15, duration: 1500 });
      });

      // Cursor changes + map-dot hover highlight
      map.on('mouseenter', 'listings-clusters',    () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'listings-clusters',    () => { map.getCanvas().style.cursor = ''; });
      map.on('mouseenter', 'listings-unclustered', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (!e.features?.length) return;
        const props = e.features[0].properties;
        const listing = LISTINGS.find(l => l.id === props.id);
        if (listing) setHoveredListingRef.current?.(listing);
      });
      map.on('mouseleave', 'listings-unclustered', () => {
        map.getCanvas().style.cursor = '';
        setHoveredListingRef.current?.(null);
      });

      // Register each listing for the directory modal
      if (registerMarkerRef) {
        LISTINGS.forEach(listing => {
          const openPopup = () => openListingPopup(map, listing, [listing.lng, listing.lat], popupRef);
          registerMarkerRef(listing.id, { openPopup, listing, map, el: null });
        });
      }

      // ── Intro fly-in: single smooth arc from the US into the Willamette Valley ──
      setTimeout(() => {
        map.flyTo({
          center:   [WV_CAMERA.lng, WV_CAMERA.lat],
          zoom:     WV_CAMERA.zoom,
          pitch:    WV_CAMERA.pitch,
          bearing:  WV_CAMERA.bearing,
          duration: 3000,
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
            map.setPaintProperty(`ava-${ava.slug}-line`, 'line-color',   '#C9A84C');
            map.setPaintProperty(`ava-${ava.slug}-line`, 'line-opacity', isSelected ? 1.0 : 0);
            map.setPaintProperty(`ava-${ava.slug}-line`, 'line-width',   isSelected ? 3 : 1);
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
        const insideIds = LISTINGS
          .filter(l => pointInPolygon(l.lng, l.lat))
          .map(l => l.id);
        insideIdsRef.current = insideIds;
        setInsideIds(insideIds);
        // Update source data so clusters re-compute with only the AVA's points
        const src = map.getSource('listings');
        if (src) src.setData(buildListingsGeoJSON(activeCategoriesRef.current, insideIds));
        // (listing layer filters are applied by the category filter effect below)
      }

      // ── Fly to selected AVA — use curated camera from avaCameraConfig ──
      const cam = AVA_CAMERA[selectedAva];
      if (cam) {
        map.flyTo({
          center:   [cam.lng, cam.lat],
          zoom:     cam.zoom,
          pitch:    cam.pitch   ?? 40,
          bearing:  cam.bearing ?? 0,
          duration: 1400,
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
            map.fitBounds(bounds, { padding: 80, pitch: 40, duration: 1400 });
          } catch (e) { /* ignore */ }
        }
      }
    } else {
      // ── Reset everything ──────────────────────────────────────────
      insideIdsRef.current = null;
      setInsideIds(null);
      // Restore source to current category filter (no AVA restriction)
      const src = map.getSource('listings');
      if (src) src.setData(buildListingsGeoJSON(activeCategoriesRef.current, null));
      for (const ava of WV_SUB_AVAS) {
        try {
          if (map.getLayer(`ava-${ava.slug}-fill`)) {
            map.setPaintProperty(`ava-${ava.slug}-fill`, 'fill-opacity',
              ['case', ['boolean', ['feature-state', 'hover'], false], 0.18, 0.05]);
          }
          if (map.getLayer(`ava-${ava.slug}-line`)) {
            map.setPaintProperty(`ava-${ava.slug}-line`, 'line-opacity',
              ['case', ['boolean', ['feature-state', 'hover'], false], 1.0, 0.75]);
            map.setPaintProperty(`ava-${ava.slug}-line`, 'line-width',
              ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1.8]);
          }
          if (map.getLayer(`ava-${ava.slug}-label`)) {
            map.setPaintProperty(`ava-${ava.slug}-label`, 'text-opacity', 0.9);
          }
        } catch (e) { /* ignore */ }
      }

      // ── Restore all listings layers — handled by category filter effect ──

      map.flyTo({
        center:   [WV_CAMERA.lng, WV_CAMERA.lat],
        zoom:     WV_CAMERA.zoom,
        pitch:    WV_CAMERA.pitch   ?? 35,
        bearing:  WV_CAMERA.bearing ?? 0,
        duration: 1200,
        essential: true,
      });
    }
  }, [selectedAva, mapLoaded]);

  // ── Re-feed the GeoJSON source whenever categories or AVA changes ────
  // Updating source data (not just layer filters) is the only way to make
  // the cluster engine re-cluster with the correct subset of points.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const source = map.getSource('listings');
    if (!source) return;
    source.setData(buildListingsGeoJSON(activeCategories, insideIdsRef.current));
  }, [activeCategories, mapLoaded, selectedAva]);

  const handleLayerChange = useCallback((layer) => {
    setActiveLayer(layer);
    setTopoStats(null); // clear stale stats when switching layers
  }, []);

  const handleToggleCategory = useCallback((key) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleListingClick = useCallback((listing) => {
    setSelectedListingBoth(listing);
    if (mapRef.current) {
      mapRef.current.easeTo({ center: [listing.lng, listing.lat], zoom: 15, duration: 1500 });
    }
  }, [setSelectedListingBoth]);

  const handleHoverListing = useCallback((listing) => {
    setHoveredListing(listing); // null to clear
  }, []);

  // Keep setHoveredListingRef in sync so the map's [] closure can call it
  useEffect(() => { setHoveredListingRef.current = handleHoverListing; }, [handleHoverListing]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* AVA hover label */}
      {introComplete && hoveredAva && !selectedAva && (() => {
        const ava = WV_SUB_AVAS.find(a => a.slug === hoveredAva);
        return ava ? (
          <div style={{
            position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(72,55,41,0.82)', backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: `1.5px solid #C9A84C`, borderRadius: 8,
            padding: '5px 14px', fontSize: 13, fontWeight: 600, color: BRAND.eggshell,
            pointerEvents: 'none', zIndex: 5, fontFamily: 'Inter, sans-serif',
            boxShadow: '0 4px 20px rgba(46,34,26,0.25)',
          }}>
            {ava.name}
          </div>
        ) : null;
      })()}

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
      {introComplete && mapLoaded && mapRef.current && (
        <ClimateLayer
          map={mapRef.current}
          isVisible={isClimateActive}
          currentMonth={currentMonth}
          prismVar="tdmean"
          colormap="plasma"
        />
      )}

      {/* Topography raster layers (all sub-AVAs) */}
      {introComplete && mapLoaded && mapRef.current && (
        <TopographyLayer
          map={mapRef.current}
          activeLayer={isTopoActive ? activeLayer : null}
          selectedAva={selectedAva}
          onStats={setTopoStats}
        />
      )}

      {/* Desktop Dock — always visible */}
      {introComplete && mapLoaded && (
        <DesktopDock
          map={mapRef.current}
          mapLoaded={mapLoaded}
          selectedAva={selectedAva}
          onSelectAva={onSelectAva}
          activeLayer={activeLayer}
          onLayerChange={handleLayerChange}
          currentMonth={currentMonth}
          onMonthChange={setCurrentMonth}
          onHoverAva={onPanelHoverAva}
          topoStats={topoStats}
          activeCategories={activeCategories}
          onToggleCategory={handleToggleCategory}
          onListingClick={handleListingClick}
          onHoverListing={handleHoverListing}
          insideIds={insideIds}
        />
      )}

      {/* Category legend / filter — bottom center */}

      {/* Right-side listing detail panel */}
      {introComplete && selectedListing && (() => {
        const listing = selectedListing;
        const cat = LISTING_CATEGORIES[listing.category];
        return (
          <div style={{
            position: 'absolute',
            right: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 288,
            maxHeight: 'calc(100vh - 120px)',
            background: 'rgba(46,34,26,0.90)',
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
            {/* Close button */}
            <button
              onClick={() => setSelectedListingBoth(null)}
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                zIndex: 2,
                background: 'rgba(46,34,26,0.7)',
                border: '1px solid rgba(250,247,242,0.15)',
                borderRadius: 8,
                color: 'rgba(250,247,242,0.7)',
                width: 28,
                height: 28,
                cursor: 'pointer',
                fontSize: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
              }}
            >
              ✕
            </button>

            {/* Hero image */}
            {listing.image_url && (
              <div style={{ flexShrink: 0, height: 150, overflow: 'hidden' }}>
                <img
                  src={listing.image_url}
                  alt={listing.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  onError={e => { e.currentTarget.parentElement.style.display = 'none'; }}
                />
              </div>
            )}

            {/* Content */}
            <div style={{ padding: '14px 16px 18px', overflowY: 'auto', flex: 1, scrollbarWidth: 'thin', scrollbarColor: 'rgba(250,247,242,0.15) transparent' }}>
              {/* Category badge */}
              <div style={{
                display: 'inline-block',
                padding: '2px 10px',
                borderRadius: 20,
                background: cat.color + '28',
                border: `1px solid ${cat.color}66`,
                color: cat.color,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 10,
              }}>
                {cat.label}
              </div>

              {/* Title row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                <span style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: cat.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#fff',
                  flexShrink: 0,
                  marginTop: 1,
                }}>
                  {listing.num}
                </span>
                <div style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: 'rgba(250,247,242,0.95)',
                  lineHeight: 1.3,
                }}>
                  {listing.title}
                </div>
              </div>

              {/* Description */}
              {listing.desc && (
                <p style={{
                  fontSize: 12,
                  color: 'rgba(250,247,242,0.6)',
                  lineHeight: 1.6,
                  margin: '0 0 14px 0',
                }}>
                  {listing.desc.slice(0, 300)}{listing.desc.length > 300 ? '…' : ''}
                </p>
              )}

              {/* Phone */}
              {listing.phone && (
                <a
                  href={`tel:${listing.phone}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: 'rgba(250,247,242,0.7)',
                    textDecoration: 'none',
                    marginBottom: 10,
                  }}
                >
                  📞 {listing.phone}
                </a>
              )}

              {/* Website button */}
              {listing.url && (
                <a
                  href={listing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block',
                    padding: '8px 14px',
                    background: cat.color,
                    color: '#fff',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    textDecoration: 'none',
                    textAlign: 'center',
                    marginTop: 4,
                  }}
                >
                  Visit Website ↗
                </a>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
