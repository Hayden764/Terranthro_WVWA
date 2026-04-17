import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import 'maplibre-gl/dist/maplibre-gl.css';

const API_BASE = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const API_HEADERS = import.meta.env.VITE_INTERNAL_API_KEY
  ? { 'x-api-key': import.meta.env.VITE_INTERNAL_API_KEY }
  : {};
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;

const MAP_STYLE = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/019d98dc-0865-7ac5-a184-a072f37b9509/style.json?key=${MAPTILER_KEY}`
  : {
      version: 8,
      sources: {
        esriWorldImagery: {
          type: 'raster',
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [{ id: 'esri-world-imagery', type: 'raster', source: 'esriWorldImagery', minzoom: 0, maxzoom: 19 }],
    };

// Custom draw styles — @mapbox/mapbox-gl-draw's default styles use bare numeric
// line-dasharray arrays which MapLibre GL v5 now rejects (requires ["literal", [...]]).
// These custom styles avoid dasharray entirely, so they work with any MapLibre version.
const DRAW_STYLES = [
  { id: 'gl-draw-polygon-fill-inactive',    type: 'fill',   filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],   paint: { 'fill-color': '#3bb2d0', 'fill-outline-color': '#3bb2d0', 'fill-opacity': 0.1 } },
  { id: 'gl-draw-polygon-fill-active',      type: 'fill',   filter: ['all', ['==', 'active', 'true'],  ['==', '$type', 'Polygon']],                              paint: { 'fill-color': '#fbb03b', 'fill-outline-color': '#fbb03b', 'fill-opacity': 0.15 } },
  { id: 'gl-draw-polygon-midpoint',         type: 'circle', filter: ['all', ['==', '$type', 'Point'],  ['==', 'meta', 'midpoint']],                              paint: { 'circle-radius': 4, 'circle-color': '#fbb03b' } },
  { id: 'gl-draw-polygon-stroke-inactive',  type: 'line',   filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],   layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#3bb2d0', 'line-width': 2 } },
  { id: 'gl-draw-polygon-stroke-active',    type: 'line',   filter: ['all', ['==', 'active', 'true'],  ['==', '$type', 'Polygon']],                              layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fbb03b', 'line-width': 2.5 } },
  { id: 'gl-draw-line-inactive',            type: 'line',   filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'LineString'], ['!=', 'mode', 'static']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#3bb2d0', 'line-width': 2 } },
  { id: 'gl-draw-line-active',              type: 'line',   filter: ['all', ['==', 'active', 'true'],  ['==', '$type', 'LineString']],                           layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fbb03b', 'line-width': 2.5 } },
  { id: 'gl-draw-vertex-inactive',          type: 'circle', filter: ['all', ['==', 'meta', 'vertex'],  ['==', '$type', 'Point'], ['!=', 'mode', 'static']],      paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#3bb2d0' } },
  { id: 'gl-draw-vertex-active',            type: 'circle', filter: ['all', ['==', 'meta', 'vertex'],  ['==', '$type', 'Point'], ['==', 'active', 'true']],      paint: { 'circle-radius': 7, 'circle-color': '#fbb03b', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } },
  { id: 'gl-draw-point-inactive',           type: 'circle', filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Point'], ['==', 'meta', 'feature'], ['!=', 'mode', 'static']], paint: { 'circle-radius': 5, 'circle-color': '#3bb2d0' } },
  { id: 'gl-draw-point-active',             type: 'circle', filter: ['all', ['==', 'active', 'true'],  ['==', '$type', 'Point'], ['!=', 'meta', 'midpoint']],    paint: { 'circle-radius': 7, 'circle-color': '#fbb03b' } },
];

export default function EditorPage() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);

  const [parcels, setParcels] = useState(null);
  const [selectedParcel, setSelectedParcel] = useState(null);
  const [activeTab, setActiveTab] = useState('geometry'); // 'geometry' | 'metadata'
  const [isEditing, setIsEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const [statusMessage, setStatusMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  // Metadata form state — populated when a parcel is selected
  const [metaForm, setMetaForm] = useState({});
  const [metaSaveStatus, setMetaSaveStatus] = useState('idle');
  const [metaStatusMessage, setMetaStatusMessage] = useState('');

  // Refs for use inside event handlers
  const selectedParcelRef = useRef(null);
  const isEditingRef = useRef(false);
  const hoveredIdRef = useRef(null);

  selectedParcelRef.current = selectedParcel;
  isEditingRef.current = isEditing;

  // ── Fetch all parcels ────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/api/vineyards/parcels`, { headers: API_HEADERS })
      .then((r) => r.json())
      .then((data) => setParcels(data))
      .catch((err) => console.error('Failed to load parcels:', err));
  }, []);

  // ── Initialize map ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current) return;
    // Guard against React StrictMode double-invoke
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [-123.1, 45.25],
      zoom: 11,
    });
    mapRef.current = map;

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { trash: true },
      defaultMode: 'simple_select',
      styles: DRAW_STYLES,
    });
    drawRef.current = draw;

    map.addControl(draw, 'top-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      // Parcel source — generateId so MapLibre assigns stable numeric IDs for feature-state
      map.addSource('parcels', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        generateId: true,
      });

      // Fill
      map.addLayer({
        id: 'parcels-fill',
        type: 'fill',
        source: 'parcels',
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], '#4ade80',
            ['boolean', ['feature-state', 'hovered'], false], '#facc15',
            '#22d3ee',
          ],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 0.35,
            ['boolean', ['feature-state', 'hovered'], false], 0.22,
            0.12,
          ],
        },
      });

      // Outline
      map.addLayer({
        id: 'parcels-outline',
        type: 'line',
        source: 'parcels',
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], '#4ade80',
            ['boolean', ['feature-state', 'hovered'], false], '#facc15',
            '#22d3ee',
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 2.5,
            ['boolean', ['feature-state', 'hovered'], false], 2,
            1.5,
          ],
        },
      });

      // ── Hover ──────────────────────────────────────────────────────────
      map.on('mousemove', 'parcels-fill', (e) => {
        if (isEditingRef.current || !e.features?.length) return;
        map.getCanvas().style.cursor = 'pointer';
        const fid = e.features[0].id;
        if (hoveredIdRef.current !== null && hoveredIdRef.current !== fid) {
          map.setFeatureState({ source: 'parcels', id: hoveredIdRef.current }, { hovered: false });
        }
        hoveredIdRef.current = fid;
        map.setFeatureState({ source: 'parcels', id: fid }, { hovered: true });
      });

      map.on('mouseleave', 'parcels-fill', () => {
        map.getCanvas().style.cursor = '';
        if (hoveredIdRef.current !== null) {
          map.setFeatureState({ source: 'parcels', id: hoveredIdRef.current }, { hovered: false });
          hoveredIdRef.current = null;
        }
      });

      // ── Click to select ────────────────────────────────────────────────
      map.on('click', 'parcels-fill', (e) => {
        if (isEditingRef.current || !e.features?.length) return;
        const feature = e.features[0];

        // Clear old selection highlight
        if (selectedParcelRef.current?._mapId != null) {
          map.setFeatureState(
            { source: 'parcels', id: selectedParcelRef.current._mapId },
            { selected: false }
          );
        }
        map.setFeatureState({ source: 'parcels', id: feature.id }, { selected: true });

        const props = feature.properties;
        setSelectedParcel({ ...feature, _mapId: feature.id });
        setIsEditing(false);
        setSaveStatus('idle');
        setStatusMessage('');
        setActiveTab('geometry');
        setMetaForm({
          vineyard_name:     props.vineyard_name     ?? '',
          vineyard_org:      props.vineyard_org      ?? '',
          owner_name:        props.owner_name        ?? '',
          ava_name:          props.ava_name          ?? '',
          nested_ava:        props.nested_ava        ?? '',
          nested_nested_ava: props.nested_nested_ava ?? '',
          situs_address:     props.situs_address     ?? '',
          situs_city:        props.situs_city        ?? '',
          situs_zip:         props.situs_zip         ?? '',
          acres:             props.acres != null ? String(props.acres) : '',
          varietals_list:    props.varietals_list    ?? '',
          source_dataset:    props.source_dataset    ?? '',
          winery_id:         props.winery_id != null ? String(props.winery_id) : '',
        });
        setMetaSaveStatus('idle');
        setMetaStatusMessage('');
        e.stopPropagation?.();
      });

      // ── Click on empty area to deselect ───────────────────────────────
      map.on('click', (e) => {
        if (isEditingRef.current) return;
        const hits = map.queryRenderedFeatures(e.point, { layers: ['parcels-fill'] });
        if (!hits.length && selectedParcelRef.current?._mapId != null) {
          map.setFeatureState(
            { source: 'parcels', id: selectedParcelRef.current._mapId },
            { selected: false }
          );
          setSelectedParcel(null);
          setStatusMessage('');
        }
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
  }, []);

  // ── Push parcel data into map source ────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !parcels) return;
    const pushData = () => {
      const src = mapRef.current?.getSource('parcels');
      if (src) src.setData(parcels);
    };
    if (mapRef.current.loaded()) {
      pushData();
    } else {
      mapRef.current.once('load', pushData);
    }
  }, [parcels]);

  // ── Fly to selected parcel ───────────────────────────────────────────────
  useEffect(() => {
    if (!selectedParcel || !mapRef.current) return;
    const coords = selectedParcel.geometry?.coordinates;
    if (!coords) return;
    // Flatten to get all [lng, lat] pairs from Polygon or MultiPolygon
    const flat = [];
    const flatten = (arr) => {
      if (typeof arr[0] === 'number') { flat.push(arr); return; }
      arr.forEach(flatten);
    };
    flatten(coords);
    if (!flat.length) return;
    const lngs = flat.map((c) => c[0]);
    const lats = flat.map((c) => c[1]);
    const bounds = new maplibregl.LngLatBounds(
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)]
    );
    mapRef.current.fitBounds(bounds, { padding: 100, maxZoom: 17, duration: 600 });
  }, [selectedParcel]);

  // ── Edit ─────────────────────────────────────────────────────────────────
  const handleStartEdit = useCallback(() => {
    if (!selectedParcel || !drawRef.current || !parcels) return;
    const draw = drawRef.current;

    // MapLibre rendered features from click events may have geometry: undefined.
    // Always look up the full geometry from the loaded parcels source.
    const parcelId = selectedParcel.properties.id;
    const sourceFeat = parcels.features.find((f) => f.properties.id === parcelId);
    if (!sourceFeat?.geometry) {
      setStatusMessage('Could not find geometry for this parcel.');
      return;
    }

    const featureToEdit = {
      type: 'Feature',
      id: String(parcelId),
      properties: { ...selectedParcel.properties },
      geometry: sourceFeat.geometry,
    };

    draw.deleteAll();
    const added = draw.add(featureToEdit);
    draw.changeMode('direct_select', { featureId: added[0] });

    setIsEditing(true);
    setStatusMessage('Drag vertices to reshape. Click a vertex then press Delete/Backspace to remove it.');
  }, [selectedParcel, parcels]);

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!drawRef.current || !selectedParcel) return;
    const all = drawRef.current.getAll();
    if (!all.features.length) {
      setStatusMessage('No edited geometry found.');
      return;
    }

    const edited = all.features[0];
    setSaveStatus('saving');
    setStatusMessage('Saving…');

    try {
      const res = await fetch(
        `${API_BASE}/api/vineyards/parcels/${selectedParcel.properties.id}/geometry`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...API_HEADERS },
          body: JSON.stringify({ geometry: edited.geometry }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      // Update local source so the parcel reflects the new shape immediately
      setParcels((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          features: prev.features.map((f) =>
            f.properties.id === selectedParcel.properties.id
              ? { ...f, geometry: edited.geometry }
              : f
          ),
        };
      });

      drawRef.current.deleteAll();
      drawRef.current.changeMode('simple_select');
      setIsEditing(false);
      setSelectedParcel(null);
      setSaveStatus('saved');
      setStatusMessage('Saved. Parcel geometry updated.');
      setTimeout(() => setSaveStatus('idle'), 4000);
    } catch (err) {
      setSaveStatus('error');
      setStatusMessage(`Save failed: ${err.message}`);
    }
  }, [selectedParcel]);

  // ── Save metadata ─────────────────────────────────────────────────────────
  const handleSaveMeta = useCallback(async () => {
    if (!selectedParcel) return;
    setMetaSaveStatus('saving');
    setMetaStatusMessage('Saving…');
    try {
      const res = await fetch(
        `${API_BASE}/api/vineyards/parcels/${selectedParcel.properties.id}/metadata`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...API_HEADERS },
          body: JSON.stringify(metaForm),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      // Merge updated fields back into parcels state
      setParcels((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          features: prev.features.map((f) => {
            if (f.properties.id !== selectedParcel.properties.id) return f;
            return { ...f, properties: { ...f.properties, ...metaForm, acres: metaForm.acres ? parseFloat(metaForm.acres) : null } };
          }),
        };
      });
      setSelectedParcel((prev) => ({
        ...prev,
        properties: { ...prev.properties, ...metaForm, acres: metaForm.acres ? parseFloat(metaForm.acres) : null },
      }));
      setMetaSaveStatus('saved');
      setMetaStatusMessage('Metadata saved.');
      setTimeout(() => setMetaSaveStatus('idle'), 4000);
    } catch (err) {
      setMetaSaveStatus('error');
      setMetaStatusMessage(`Save failed: ${err.message}`);
    }
  }, [selectedParcel, metaForm]);

  // ── Discard ──────────────────────────────────────────────────────────────
  const handleDiscard = useCallback(() => {
    if (!drawRef.current) return;
    drawRef.current.deleteAll();
    drawRef.current.changeMode('simple_select');
    setIsEditing(false);
    setSaveStatus('idle');
    setStatusMessage('');
  }, []);

  // ── Filter sidebar list ───────────────────────────────────────────────────
  const filteredParcels = parcels?.features.filter((f) => {
    if (!searchQuery.trim()) return false; // Don't show full list — too long
    const q = searchQuery.toLowerCase();
    return (
      f.properties.vineyard_name?.toLowerCase().includes(q) ||
      f.properties.winery_title?.toLowerCase().includes(q)
    );
  }) ?? [];

  const handleSelectFromList = useCallback(
    (feature) => {
      if (isEditing) return;
      const map = mapRef.current;
      if (!map) return;

      // Clear previous selection
      if (selectedParcelRef.current?._mapId != null) {
        map.setFeatureState(
          { source: 'parcels', id: selectedParcelRef.current._mapId },
          { selected: false }
        );
      }

      // Find MapLibre feature ID by matching properties.id
      const rendered = map.querySourceFeatures('parcels', { sourceLayer: '' });
      const match = rendered.find((f) => f.properties?.id === feature.properties.id);
      const mapId = match?.id ?? null;

      if (mapId != null) {
        map.setFeatureState({ source: 'parcels', id: mapId }, { selected: true });
      }

      const props = feature.properties;
      setSelectedParcel({ ...feature, _mapId: mapId });
      setIsEditing(false);
      setSaveStatus('idle');
      setStatusMessage('');
      setActiveTab('geometry');
      setMetaForm({
        vineyard_name:     props.vineyard_name     ?? '',
        vineyard_org:      props.vineyard_org      ?? '',
        owner_name:        props.owner_name        ?? '',
        ava_name:          props.ava_name          ?? '',
        nested_ava:        props.nested_ava        ?? '',
        nested_nested_ava: props.nested_nested_ava ?? '',
        situs_address:     props.situs_address     ?? '',
        situs_city:        props.situs_city        ?? '',
        situs_zip:         props.situs_zip         ?? '',
        acres:             props.acres != null ? String(props.acres) : '',
        varietals_list:    props.varietals_list    ?? '',
        source_dataset:    props.source_dataset    ?? '',
        winery_id:         props.winery_id != null ? String(props.winery_id) : '',
      });
      setMetaSaveStatus('idle');
      setMetaStatusMessage('');
      setSearchQuery('');
    },
    [isEditing]
  );

  // ── Status color ──────────────────────────────────────────────────────────
  // (used inline per-tab now)

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0f172a' }}>

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <div style={{
        width: 300,
        minWidth: 300,
        background: '#0f172a',
        borderRight: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 14px',
        gap: 12,
        overflowY: 'auto',
        zIndex: 10,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ color: '#f1f5f9', fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>
            Parcel Editor
          </h1>
          <a
            href="#/"
            style={{ color: '#475569', fontSize: 12, textDecoration: 'none' }}
          >
            ← Map
          </a>
        </div>

        {/* Parcel count */}
        <p style={{ color: '#475569', fontSize: 11, margin: 0 }}>
          {parcels ? `${parcels.features.length.toLocaleString()} parcels loaded` : 'Loading parcels…'}
        </p>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder="Search by name or winery…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 6,
              color: '#f1f5f9',
              fontSize: 12,
              padding: '7px 10px',
              outline: 'none',
            }}
          />
        </div>

        {/* Search results */}
        {searchQuery.trim() && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
            {filteredParcels.length === 0 && (
              <div style={{ color: '#475569', fontSize: 12, padding: '6px 0' }}>No matches</div>
            )}
            {filteredParcels.map((f) => (
              <button
                key={f.properties.id}
                onClick={() => handleSelectFromList(f)}
                style={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 5,
                  color: '#e2e8f0',
                  fontSize: 12,
                  padding: '6px 10px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  lineHeight: 1.4,
                }}
              >
                <div style={{ fontWeight: 500 }}>{f.properties.vineyard_name || 'Unnamed'}</div>
                {f.properties.winery_title && (
                  <div style={{ color: '#64748b', fontSize: 11 }}>{f.properties.winery_title}</div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Divider */}
        <div style={{ height: 1, background: '#1e293b' }} />

        {/* No selection state */}
        {!selectedParcel && !searchQuery && (
          <div style={{
            color: '#64748b',
            fontSize: 12,
            background: '#1e293b',
            borderRadius: 8,
            padding: '12px',
            lineHeight: 1.7,
          }}>
            Click any parcel on the map to select it, or search by name above.
          </div>
        )}

        {/* Selected parcel panel */}
        {selectedParcel && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Parcel identity strip */}
            <div style={{ background: '#1e293b', borderRadius: 8, padding: '10px 12px', border: '1px solid #334155' }}>
              <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 13, lineHeight: 1.4 }}>
                {selectedParcel.properties.vineyard_name || 'Unnamed Parcel'}
              </div>
              {selectedParcel.properties.winery_title && (
                <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>{selectedParcel.properties.winery_title}</div>
              )}
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                <Tag>id: {selectedParcel.properties.id}</Tag>
                <Tag>{selectedParcel.properties.source_dataset}</Tag>
                {selectedParcel.properties.nested_ava && <Tag>{selectedParcel.properties.nested_ava}</Tag>}
                {selectedParcel.properties.acres && <Tag>{Number(selectedParcel.properties.acres).toFixed(1)} ac</Tag>}
              </div>
            </div>

            {/* Tab switcher */}
            <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #334155' }}>
              {['geometry', 'metadata'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => { if (!isEditing) setActiveTab(tab); }}
                  style={{
                    flex: 1,
                    padding: '7px 0',
                    background: activeTab === tab ? '#3b82f6' : '#1e293b',
                    color: activeTab === tab ? '#fff' : '#64748b',
                    border: 'none',
                    cursor: isEditing ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                    textTransform: 'capitalize',
                    opacity: isEditing && tab !== 'geometry' ? 0.4 : 1,
                  }}
                >
                  {tab === 'geometry' ? '⬡ Geometry' : '✎ Metadata'}
                </button>
              ))}
            </div>

            {/* ── GEOMETRY TAB ── */}
            {activeTab === 'geometry' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {!isEditing ? (
                  <button onClick={handleStartEdit} style={btnStyle('#3b82f6', '#2563eb')}>
                    Edit Geometry
                  </button>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: '#fbbf24', background: '#1e293b', border: '1px solid #92400e', borderRadius: 6, padding: '7px 10px' }}>
                      ✏ Editing active — drag vertices to reshape
                    </div>
                    <button onClick={handleSave} disabled={saveStatus === 'saving'} style={btnStyle(saveStatus === 'saving' ? '#166534' : '#16a34a', '#15803d')}>
                      {saveStatus === 'saving' ? 'Saving…' : 'Save Geometry'}
                    </button>
                    <button onClick={handleDiscard} style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                      Discard
                    </button>
                  </>
                )}
                {statusMessage && (
                  <div style={{ color: saveStatus === 'error' ? '#f87171' : saveStatus === 'saved' ? '#4ade80' : '#94a3b8', fontSize: 12, padding: '6px 10px', background: '#1e293b', borderRadius: 6, lineHeight: 1.5 }}>
                    {statusMessage}
                  </div>
                )}
                <div style={{ color: '#334155', fontSize: 11, lineHeight: 1.7, marginTop: 4 }}>
                  1. Click "Edit Geometry"<br />
                  2. Drag vertices to reshape<br />
                  3. Trash icon removes selected vertices<br />
                  4. Save writes directly to the DB
                </div>
              </div>
            )}

            {/* ── METADATA TAB ── */}
            {activeTab === 'metadata' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <MetaField label="Vineyard Name"     field="vineyard_name"     form={metaForm} setForm={setMetaForm} />
                <MetaField label="Organization"       field="vineyard_org"      form={metaForm} setForm={setMetaForm} />
                <MetaField label="Owner Name"          field="owner_name"        form={metaForm} setForm={setMetaForm} />
                <MetaField label="Source Dataset"      field="source_dataset"    form={metaForm} setForm={setMetaForm} />
                <div style={{ height: 1, background: '#1e293b', margin: '2px 0' }} />
                <MetaField label="AVA Name"            field="ava_name"          form={metaForm} setForm={setMetaForm} />
                <MetaField label="Nested AVA"          field="nested_ava"        form={metaForm} setForm={setMetaForm} />
                <MetaField label="Nested-Nested AVA"   field="nested_nested_ava" form={metaForm} setForm={setMetaForm} />
                <div style={{ height: 1, background: '#1e293b', margin: '2px 0' }} />
                <MetaField label="Acres"               field="acres"             form={metaForm} setForm={setMetaForm} type="number" />
                <MetaField label="Varietals"           field="varietals_list"    form={metaForm} setForm={setMetaForm} multiline />
                <div style={{ height: 1, background: '#1e293b', margin: '2px 0' }} />
                <MetaField label="Winery ID"           field="winery_id"         form={metaForm} setForm={setMetaForm} type="number" />
                <div style={{ height: 1, background: '#1e293b', margin: '2px 0' }} />
                <MetaField label="Situs Address"       field="situs_address"     form={metaForm} setForm={setMetaForm} />
                <MetaField label="Situs City"          field="situs_city"        form={metaForm} setForm={setMetaForm} />
                <MetaField label="Situs ZIP"           field="situs_zip"         form={metaForm} setForm={setMetaForm} />

                <button
                  onClick={handleSaveMeta}
                  disabled={metaSaveStatus === 'saving'}
                  style={{ ...btnStyle(metaSaveStatus === 'saving' ? '#166534' : '#16a34a', '#15803d'), marginTop: 4 }}
                >
                  {metaSaveStatus === 'saving' ? 'Saving…' : 'Save Metadata'}
                </button>

                {metaStatusMessage && (
                  <div style={{ color: metaSaveStatus === 'error' ? '#f87171' : metaSaveStatus === 'saved' ? '#4ade80' : '#94a3b8', fontSize: 12, padding: '6px 10px', background: '#1e293b', borderRadius: 6, lineHeight: 1.5 }}>
                    {metaStatusMessage}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Help text at bottom */}
        <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid #1e293b', color: '#334155', fontSize: 11, lineHeight: 1.7 }}>
          <span style={{ color: '#475569', fontWeight: 600 }}>Editing station</span><br />
          Click a parcel → Geometry tab to reshape,<br />
          Metadata tab to edit fields.
        </div>
      </div>

      {/* ── Map ─────────────────────────────────────────────────────────── */}
      <div ref={mapContainerRef} style={{ flex: 1, position: 'relative' }} />
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function MetaField({ label, field, form, setForm, type = 'text', multiline = false }) {
  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 5,
    color: '#e2e8f0',
    fontSize: 12,
    padding: '5px 8px',
    outline: 'none',
    resize: multiline ? 'vertical' : undefined,
    fontFamily: 'inherit',
    minHeight: multiline ? 56 : undefined,
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <label style={{ color: '#64748b', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </label>
      {multiline ? (
        <textarea
          value={form[field] ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
          style={inputStyle}
          rows={2}
        />
      ) : (
        <input
          type={type}
          value={form[field] ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
          style={inputStyle}
          step={type === 'number' ? 'any' : undefined}
        />
      )}
    </div>
  );
}

function Tag({ children }) {
  return (
    <span style={{
      background: '#0f172a',
      color: '#64748b',
      fontSize: 10,
      padding: '2px 7px',
      borderRadius: 4,
      border: '1px solid #1e293b',
    }}>
      {children}
    </span>
  );
}

function btnStyle(bg, hoverBg) {
  return {
    background: bg,
    color: 'white',
    border: 'none',
    borderRadius: 6,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    width: '100%',
  };
}
