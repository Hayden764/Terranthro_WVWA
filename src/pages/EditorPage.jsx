import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import SplitParcelModal from '../components/admin/SplitParcelModal';
import { useNavigate, Link } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TOKENS, TYPE } from '../styles/tokens';

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

const MAP_COLOR_FALLBACKS = {
  lineDefault: '#2E9BFF',
  lineHover: '#C87D4A',
  lineSelected: '#00C44F',
  lightPoint: '#E8E2D6',
};

function resolveCssColor(varName, fallback) {
  if (typeof window === 'undefined') return fallback;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallback;
}

function getMapColors() {
  return {
    lineDefault: resolveCssColor('--color-electric-blue', MAP_COLOR_FALLBACKS.lineDefault),
    lineHover: resolveCssColor('--color-amber', MAP_COLOR_FALLBACKS.lineHover),
    lineSelected: resolveCssColor('--color-success', MAP_COLOR_FALLBACKS.lineSelected),
    lightPoint: resolveCssColor('--color-parchment', MAP_COLOR_FALLBACKS.lightPoint),
  };
}

// Custom draw styles — @mapbox/mapbox-gl-draw's default styles use bare numeric
// line-dasharray arrays which MapLibre GL v5 now rejects (requires ["literal", [...]]).
// These custom styles avoid dasharray entirely, so they work with any MapLibre version.
function createDrawStyles(colors) {
  return [
    { id: 'gl-draw-polygon-fill-inactive',    type: 'fill',   filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],   paint: { 'fill-color': colors.lineDefault, 'fill-outline-color': colors.lineDefault, 'fill-opacity': 0.1 } },
    { id: 'gl-draw-polygon-fill-active',      type: 'fill',   filter: ['all', ['==', 'active', 'true'],  ['==', '$type', 'Polygon']],                              paint: { 'fill-color': colors.lineHover, 'fill-outline-color': colors.lineHover, 'fill-opacity': 0.15 } },
    { id: 'gl-draw-polygon-midpoint',         type: 'circle', filter: ['all', ['==', '$type', 'Point'],  ['==', 'meta', 'midpoint']],                              paint: { 'circle-radius': 4, 'circle-color': colors.lineHover } },
    { id: 'gl-draw-polygon-stroke-inactive',  type: 'line',   filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],   layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colors.lineDefault, 'line-width': 2 } },
    { id: 'gl-draw-polygon-stroke-active',    type: 'line',   filter: ['all', ['==', 'active', 'true'],  ['==', '$type', 'Polygon']],                              layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colors.lineHover, 'line-width': 2.5 } },
    { id: 'gl-draw-line-inactive',            type: 'line',   filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'LineString'], ['!=', 'mode', 'static']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colors.lineDefault, 'line-width': 2 } },
    { id: 'gl-draw-line-active',              type: 'line',   filter: ['all', ['==', 'active', 'true'],  ['==', '$type', 'LineString']],                           layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colors.lineHover, 'line-width': 2.5 } },
    { id: 'gl-draw-vertex-inactive',          type: 'circle', filter: ['all', ['==', 'meta', 'vertex'],  ['==', '$type', 'Point'], ['!=', 'mode', 'static']],      paint: { 'circle-radius': 5, 'circle-color': colors.lightPoint, 'circle-stroke-width': 1.5, 'circle-stroke-color': colors.lineDefault } },
    { id: 'gl-draw-vertex-active',            type: 'circle', filter: ['all', ['==', 'meta', 'vertex'],  ['==', '$type', 'Point'], ['==', 'active', 'true']],      paint: { 'circle-radius': 7, 'circle-color': colors.lineHover, 'circle-stroke-width': 2, 'circle-stroke-color': colors.lightPoint } },
    { id: 'gl-draw-point-inactive',           type: 'circle', filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Point'], ['==', 'meta', 'feature'], ['!=', 'mode', 'static']], paint: { 'circle-radius': 5, 'circle-color': colors.lineDefault } },
    { id: 'gl-draw-point-active',             type: 'circle', filter: ['all', ['==', 'active', 'true'],  ['==', '$type', 'Point'], ['!=', 'meta', 'midpoint']],    paint: { 'circle-radius': 7, 'circle-color': colors.lineHover } },
  ];
}

export default function EditorPage() {
  const navigate = useNavigate();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);

  const [authChecked, setAuthChecked] = useState(false);
  const [parcels, setParcels] = useState(null);
  const [wineries, setWineries] = useState([]);

  // ── Single-parcel selection ───────────────────────────────────────────────
  const [selectedParcel, setSelectedParcel] = useState(null);

  // Drawing-a-new-block state
  const [isDrawingNew, setIsDrawingNew] = useState(false);
  const [newBlockForm, setNewBlockForm] = useState({ vineyard_name: '', source_dataset: 'admin' });
  const newBlockGeomRef = useRef(null); // stores drawn GeoJSON geometry

  // Split modal state
  const [showSplitModal, setShowSplitModal] = useState(false);

  // Confirm-delete state
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [activeTab, setActiveTab] = useState('geometry'); // 'geometry' | 'metadata'
  const [isEditing, setIsEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | staging | staged | error
  const [statusMessage, setStatusMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  // Metadata form state — populated when a parcel is selected
  const [metaForm, setMetaForm] = useState({});
  const [metaSaveStatus, setMetaSaveStatus] = useState('idle');
  const [metaStatusMessage, setMetaStatusMessage] = useState('');
  // Staged operations — accumulated until "Push for Review"
  // Initialised from localStorage so a page refresh doesn't lose staged work.
  const [stagedOps, setStagedOpsRaw] = useState(() => {
    try {
      const stored = localStorage.getItem('editor_staged_ops');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  // Wrap setter so every update is also persisted to localStorage
  const setStagedOps = useCallback((updater) => {
    setStagedOpsRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('editor_staged_ops', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const [pushStatus, setPushStatus] = useState('idle'); // idle | pushing | done | error
  const [pushMessage, setPushMessage] = useState('');
  // winery_id for the batch request — prefer selected parcel, then first staged op
  const batchWineryId = useMemo(() => {
    if (selectedParcel?.properties?.winery_id) return selectedParcel.properties.winery_id;
    for (const op of stagedOps) {
      if (op.winery_id) return op.winery_id;
    }
    return null;
  }, [selectedParcel, stagedOps]);

  // Refs for use inside event handlers
  const selectedParcelRef = useRef(null);
  const isEditingRef = useRef(false);
  const hoveredIdRef = useRef(null);

  selectedParcelRef.current = selectedParcel;
  isEditingRef.current = isEditing;

  // ── Admin auth guard ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/api/admin/me`, { credentials: 'include', headers: API_HEADERS })
      .then((r) => {
        if (!r.ok) navigate('/admin', { replace: true });
        else setAuthChecked(true);
      })
      .catch(() => navigate('/admin', { replace: true }));
  }, [navigate]);

  // ── Fetch all parcels ────────────────────────────────────────────────────
  useEffect(() => {
    if (!authChecked) return;
    fetch(`${API_BASE}/api/vineyards/parcels`, { headers: API_HEADERS })
      .then((r) => r.json())
      .then((data) => setParcels(data))
      .catch((err) => console.error('Failed to load parcels:', err));
  }, [authChecked]);

  // ── Fetch wineries for optional selector in new-block form ─────────────
  useEffect(() => {
    if (!authChecked) return;
    fetch(`${API_BASE}/api/admin/vineyards`, { credentials: 'include', headers: API_HEADERS })
      .then((r) => r.json())
      .then((rows) => {
        const uniq = Array.from(
          new Map(
            (Array.isArray(rows) ? rows : [])
              .filter((w) => Number.isInteger(w.winery_id))
              .map((w) => [w.winery_id, { winery_id: w.winery_id, winery_name: w.winery_name || `Winery ${w.winery_id}` }])
          ).values()
        ).sort((a, b) => a.winery_name.localeCompare(b.winery_name));
        setWineries(uniq);
      })
      .catch((err) => console.error('Failed to load wineries for editor:', err));
  }, [authChecked]);

  // ── Initialize map ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current) return;
    // Guard against React StrictMode double-invoke
    if (mapRef.current) return;

    const mapColors = getMapColors();

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
      styles: createDrawStyles(mapColors),
    });

    if (drawRef.current) {
      try { map.removeControl(drawRef.current); } catch (_) {}
      drawRef.current = null;
    }

    try {
      map.addControl(draw, 'top-right');
      drawRef.current = draw;
    } catch (err) {
      console.error('Failed to initialize draw controls:', err);
    }

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
            ['boolean', ['feature-state', 'selected'], false], mapColors.lineSelected,
            ['boolean', ['feature-state', 'hovered'], false], mapColors.lineHover,
            mapColors.lineDefault,
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
            ['boolean', ['feature-state', 'selected'], false], mapColors.lineSelected,
            ['boolean', ['feature-state', 'hovered'], false], mapColors.lineHover,
            mapColors.lineDefault,
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

      // ── Click to select a single parcel ─────────────────────────────
      map.on('click', 'parcels-fill', (e) => {
        if (isEditingRef.current || !e.features?.length) return;
        const feature = e.features[0];

        // Clear previous selection highlight
        if (selectedParcelRef.current?._mapId != null) {
          map.setFeatureState({ source: 'parcels', id: selectedParcelRef.current._mapId }, { selected: false });
        }
        map.setFeatureState({ source: 'parcels', id: feature.id }, { selected: true });

        // Look up full geometry from source
        const allFeatures = map.getSource('parcels')?._data?.features ?? [];
        const full = allFeatures.find((f) => f.properties.id === feature.properties.id) ?? feature;
        // Attach internal map ID so we can clear feature-state later
        full._mapId = feature.id;

        setSelectedParcel(full);
        setConfirmDelete(false);
        setIsEditing(false);
        setSaveStatus('idle');
        setStatusMessage('');
        setActiveTab('geometry');
        const props = full.properties;
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
        if (!hits.length) {
          if (selectedParcelRef.current?._mapId != null) {
            map.setFeatureState(
              { source: 'parcels', id: selectedParcelRef.current._mapId },
              { selected: false }
            );
          }
          setSelectedParcel(null);
          setConfirmDelete(false);
          setStatusMessage('');
        }
      });
    });

    return () => {
      if (drawRef.current) {
        try { map.removeControl(drawRef.current); } catch (_) {}
      }
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
  }, []);

  // ── Push parcel data into map source ────────────────────────────────────
  // NOTE: mapRef.current.loaded() can return false while tiles are still
  // fetching, even after our 'load' handler has already fired and added the
  // 'parcels' source. Using getSource() as the readiness check avoids that
  // race: if the source exists, our init already ran; if not, wait for 'load'.
  useEffect(() => {
    if (!mapRef.current || !parcels) return;
    const pushData = () => {
      const src = mapRef.current?.getSource('parcels');
      if (src) src.setData(parcels);
    };
    if (mapRef.current.getSource('parcels')) {
      pushData();
    } else {
      mapRef.current.once('load', pushData);
    }
  }, [parcels]);

  // ── Fly to focused parcel ───────────────────────────────────────────────
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

  // ── Stage geometry change ────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!drawRef.current || !selectedParcel) return;
    const all = drawRef.current.getAll();
    if (!all.features.length) {
      setStatusMessage('No edited geometry found.');
      return;
    }

    const edited = all.features[0];
    const parcelId = selectedParcel.properties.id;
    const beforeGeom = selectedParcel.geometry;
    const beforeAcres = selectedParcel.properties.acres != null
      ? Number(selectedParcel.properties.acres) : null;

    // Compute approximate after_acres client-side so the flag can be previewed
    // (server will recompute exactly on approval)
    // We just store the geometry; the server computes authoritative acres.
    setSaveStatus('staging');
    setStatusMessage('Staged.');

    setStagedOps((prev) => {
      // Replace any existing geometry op for this parcel
      const without = prev.filter((o) => !(o.op === 'geometry' && o.parcel_id === parcelId));
      return [
        ...without,
        {
          op: 'geometry',
          parcel_id: parcelId,
          parcel_name: selectedParcel.properties.vineyard_name || `Parcel #${parcelId}`,
          winery_id: selectedParcel.properties.winery_id,
          geometry: edited.geometry,
          before_geom: beforeGeom,
          before_acres: beforeAcres,
          // after_acres will be null until the server computes it on approval
          after_acres: null,
        },
      ];
    });

    // Update local source so map reflects the staged shape immediately
    setParcels((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        features: prev.features.map((f) =>
          f.properties.id === parcelId
            ? { ...f, geometry: edited.geometry }
            : f
        ),
      };
    });

    drawRef.current.deleteAll();
    drawRef.current.changeMode('simple_select');
    setIsEditing(false);
    setSaveStatus('staged');
    setTimeout(() => setSaveStatus('idle'), 3000);
  }, [selectedParcel]);

  // ── Stage metadata change ─────────────────────────────────────────────────
  const handleSaveMeta = useCallback(async () => {
    if (!selectedParcel) return;
    const parcelId = selectedParcel.properties.id;

    // Capture before values for the fields that changed
    const before = {};
    const META_KEYS = [
      'vineyard_name', 'vineyard_org', 'ava_name',
      'nested_ava', 'nested_nested_ava',
      'acres', 'varietals_list', 'source_dataset', 'winery_id',
    ];
    for (const k of META_KEYS) {
      before[k] = selectedParcel.properties[k] ?? null;
    }

    setStagedOps((prev) => {
      const without = prev.filter((o) => !(o.op === 'metadata' && o.parcel_id === parcelId));
      return [
        ...without,
        {
          op: 'metadata',
          parcel_id: parcelId,
          parcel_name: selectedParcel.properties.vineyard_name || `Parcel #${parcelId}`,
          winery_id: selectedParcel.properties.winery_id,
          fields: { ...metaForm },
          before,
        },
      ];
    });

    // Merge into local parcels state for immediate UI feedback
    setParcels((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        features: prev.features.map((f) => {
          if (f.properties.id !== parcelId) return f;
          return { ...f, properties: { ...f.properties, ...metaForm, acres: metaForm.acres ? parseFloat(metaForm.acres) : null } };
        }),
      };
    });
    setSelectedParcel((prev) => ({
      ...prev,
      properties: { ...prev.properties, ...metaForm, acres: metaForm.acres ? parseFloat(metaForm.acres) : null },
    }));    setMetaSaveStatus('staged');
    setMetaStatusMessage('Staged for review.');
    setTimeout(() => setMetaSaveStatus('idle'), 3000);
  }, [selectedParcel, metaForm]);

  // ── Push for Review ────────────────────────────────────────────────────────
  const handlePushForReview = useCallback(async () => {
    if (stagedOps.length === 0) return;
    const wineryId = batchWineryId;
    setPushStatus('pushing');
    setPushMessage('Submitting…');
    try {
      const res = await fetch(`${API_BASE}/api/admin/requests/batch`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...API_HEADERS },
        body: JSON.stringify({ winery_id: wineryId ?? null, ops: stagedOps }),
      });
      if (res.status === 401) {
        // Session expired — staged ops are safe in localStorage, redirect to login
        setPushStatus('error');
        setPushMessage('Session expired. Your staged changes are saved. Re-login and come back to push them.');
        setTimeout(() => navigate('/admin', { replace: true }), 2500);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      const result = await res.json();
      setStagedOps([]);
      try { localStorage.removeItem('editor_staged_ops'); } catch {}
      setPushStatus('done');
      setPushMessage(`Submitted as request #${result.id} — pending second approval.`);
    } catch (err) {
      setPushStatus('error');
      setPushMessage(`Submit failed: ${err.message}`);
    }
  }, [stagedOps, batchWineryId]);

  // ── Discard ──────────────────────────────────────────────────────────────
  const handleDiscard = useCallback(() => {
    if (!drawRef.current) return;
    drawRef.current.deleteAll();
    drawRef.current.changeMode('simple_select');
    setIsEditing(false);
    setSaveStatus('idle');
    setStatusMessage('');
  }, []);

  // ── Stage a delete op for the currently selected parcel ──────────────────
  const handleDeleteBlock = useCallback((feature) => {
    const parcelId = feature.properties.id;
    setStagedOps((prev) => {
      const without = prev.filter((o) => o.parcel_id !== parcelId);
      return [...without, {
        op: 'delete',
        parcel_id: parcelId,
        parcel_name: feature.properties.vineyard_name || `Parcel #${parcelId}`,
        winery_id: feature.properties.winery_id,
      }];
    });
    // Deselect so the parcel panel closes
    if (selectedParcelRef.current?._mapId != null) {
      mapRef.current?.setFeatureState({ source: 'parcels', id: selectedParcelRef.current._mapId }, { selected: false });
    }
    setSelectedParcel(null);
    setConfirmDelete(false);
  }, []);

  // ── Start drawing a new block ──────────────────────────────────────────────
  const handleStartDrawNew = useCallback(() => {
    if (!drawRef.current) return;
    drawRef.current.deleteAll();
    drawRef.current.changeMode('draw_polygon');
    setIsDrawingNew(true);
    setSelectedParcel(null);
    setConfirmDelete(false);
    setStatusMessage('Draw the new block boundary on the map. Click to place vertices, double-click to finish.');
    newBlockGeomRef.current = null;
    setNewBlockForm({ vineyard_name: '', source_dataset: 'admin', winery_id: '' });
  }, []);

  // ── Listen for draw.create to capture the new polygon ────────────────────
  const isDrawingNewRef = useRef(false);
  isDrawingNewRef.current = isDrawingNew;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onDrawCreate = (e) => {
      if (!isDrawingNewRef.current) return;
      const geom = e.features?.[0]?.geometry;
      if (!geom) return;
      newBlockGeomRef.current = geom;
      drawRef.current?.changeMode('simple_select');
      setIsDrawingNew(false);
      setStatusMessage('Polygon drawn. Fill in the block details and click "Stage New Block".');
    };
    map.on('draw.create', onDrawCreate);
    return () => map.off('draw.create', onDrawCreate);
  }, []);

  // ── Stage a new-block add op ───────────────────────────────────────────────
  const handleSaveNewBlock = useCallback(() => {
    const geom = newBlockGeomRef.current;
    if (!geom) { setStatusMessage('No polygon drawn yet.'); return; }
    let wineryId = null;
    if (newBlockForm.winery_id !== '' && newBlockForm.winery_id != null) {
      wineryId = parseInt(newBlockForm.winery_id, 10);
      if (Number.isNaN(wineryId)) {
        setStatusMessage('Winery selection is invalid. Choose a winery or Unknown / Independent.');
        return;
      }
    }
    setStagedOps((prev) => [...prev, {
      op: 'add',
      temp_id: `new_${Date.now()}`,
      parcel_name: newBlockForm.vineyard_name || 'New Block',
      winery_id: wineryId,
      geometry: geom,
      fields: { ...newBlockForm, winery_id: wineryId },
    }]);
    drawRef.current?.deleteAll();
    newBlockGeomRef.current = null;
    setNewBlockForm({ vineyard_name: '', source_dataset: 'admin', winery_id: '' });
    setStatusMessage('New block staged for review.');
    setTimeout(() => setStatusMessage(''), 3000);
  }, [newBlockForm]);

  // ── Cancel drawing ─────────────────────────────────────────────────────────
  const handleCancelDraw = useCallback(() => {
    drawRef.current?.deleteAll();
    drawRef.current?.changeMode('simple_select');
    setIsDrawingNew(false);
    newBlockGeomRef.current = null;
    setStatusMessage('');
  }, []);

  // ── Select from flat search list ──────────────────────────────────────────
  const handleSelectFromList = useCallback((feature) => {
    if (isEditing) return;
    if (selectedParcelRef.current?._mapId != null) {
      mapRef.current?.setFeatureState({ source: 'parcels', id: selectedParcelRef.current._mapId }, { selected: false });
    }
    feature._mapId = undefined; // no map ID from search
    setSelectedParcel(feature);
    setConfirmDelete(false);
    setIsEditing(false);
    setSaveStatus('idle');
    setStatusMessage('');
    setActiveTab('geometry');
    setSearchQuery('');
    const props = feature.properties;
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
    // Fly to parcel
    const map = mapRef.current;
    if (map && feature.geometry?.coordinates) {
      const flat = [];
      const fl = (arr) => { if (typeof arr[0] === 'number') { flat.push(arr); return; } arr.forEach(fl); };
      fl(feature.geometry.coordinates);
      if (flat.length) {
        const lngs = flat.map((c) => c[0]);
        const lats = flat.map((c) => c[1]);
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 100, maxZoom: 17, duration: 600 });
      }
    }
  }, [isEditing]);

  // ── Flat search results ────────────────────────────────────────────────────
  const filteredParcels = useMemo(() => {
    if (!parcels || !searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return parcels.features.filter((f) =>
      f.properties.vineyard_name?.toLowerCase().includes(q) ||
      f.properties.winery_title?.toLowerCase().includes(q)
    ).slice(0, 40);
  }, [parcels, searchQuery]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'var(--font-sans)', background: TOKENS.ink }}>

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <div style={{
        width: 300,
        minWidth: 300,
        background: TOKENS.surface,
        borderRight: `1px solid ${TOKENS.border}`,
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 14px',
        gap: 12,
        overflowY: 'auto',
        zIndex: 10,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ color: TOKENS.parchment, fontSize: 'var(--type-display-italic-size)', fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>
            Parcel Editor
          </h1>
          <Link to="/admin/dashboard" style={{ color: TOKENS.muted, fontSize: 'var(--type-body-size)', textDecoration: 'none' }}>
            ← Dashboard
          </Link>
        </div>

        {/* Parcel count */}
        <p style={{ color: TOKENS.muted, fontSize: 'var(--type-ui-label-size)', margin: 0 }}>
          {parcels ? `${parcels.features.length.toLocaleString()} parcels loaded` : 'Loading parcels…'}
        </p>

        {/* Add New Block button — always visible */}
        {!isDrawingNew && !isEditing && (
          <button onClick={handleStartDrawNew} style={{ ...btnStyle(TOKENS.success, TOKENS.vividGreen), fontSize: 'var(--type-body-size)' }}>
            + Add New Block
          </button>
        )}

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder="Search by vineyard or winery…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: TOKENS.surfaceRaised, border: `1px solid ${TOKENS.border}`,
              borderRadius: 6, color: TOKENS.parchment, fontSize: 'var(--type-body-size)',
              padding: '7px 10px', outline: 'none',
            }}
          />
        </div>

        {/* ── Search results (flat) ── */}
        {searchQuery.trim() && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
            {filteredParcels.length === 0 && (
              <div style={{ color: TOKENS.muted, fontSize: 'var(--type-body-size)', padding: '6px 0' }}>No matches</div>
            )}
            {filteredParcels.map((f) => (
              <button
                key={f.properties.id ?? f._mapId}
                onClick={() => handleSelectFromList(f)}
                style={{
                  background: TOKENS.surfaceRaised, border: `1px solid ${TOKENS.border}`, borderRadius: 5,
                  color: TOKENS.parchment, fontSize: 'var(--type-body-size)', padding: '7px 10px',
                  cursor: 'pointer', textAlign: 'left', lineHeight: 1.4,
                }}
              >
                <div style={{ fontWeight: 500 }}>{f.properties.vineyard_name || `Block #${f.properties.id}`}</div>
                <div style={{ color: TOKENS.ghost, fontSize: 'var(--type-ui-label-size)' }}>{f.properties.winery_title || '—'}</div>
              </button>
            ))}
          </div>
        )}

        <div style={{ height: 1, background: TOKENS.border }} />

        {/* ── No selection hint ── */}
        {!selectedParcel && !searchQuery && !isDrawingNew && (
          <div style={{ color: TOKENS.ghost, fontSize: 'var(--type-body-size)', background: TOKENS.surfaceRaised, borderRadius: 8, padding: '12px', lineHeight: 1.7 }}>
            Click any parcel on the map to select it.
          </div>
        )}

        {/* ── Selected parcel panel ── */}
        {selectedParcel && !isDrawingNew && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

            {/* Identity strip */}
            <div style={{ background: TOKENS.surfaceRaised, borderRadius: 8, padding: '10px 12px', border: `1px solid ${TOKENS.border}` }}>
              <div style={{ color: TOKENS.parchment, fontWeight: 600, fontSize: 'var(--type-mono-size)' }}>
                {selectedParcel.properties.vineyard_name || `Block #${selectedParcel.properties.id}`}
              </div>
              <div style={{ color: TOKENS.ghost, fontSize: 'var(--type-ui-label-size)', marginTop: 2 }}>
                {selectedParcel.properties.winery_title || '—'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {selectedParcel.properties.id && <Tag>id {selectedParcel.properties.id}</Tag>}
                {selectedParcel.properties.source_dataset && <Tag>{selectedParcel.properties.source_dataset}</Tag>}
                {selectedParcel.properties.nested_ava && <Tag>{selectedParcel.properties.nested_ava}</Tag>}
                {selectedParcel.properties.acres && <Tag>{Number(selectedParcel.properties.acres).toFixed(1)} ac</Tag>}
              </div>
            </div>

            {/* Delete button */}
            {!stagedOps.some((o) => o.op === 'delete' && o.parcel_id === selectedParcel.properties.id) && (
              <button
                onClick={() => setConfirmDelete((v) => !v)}
                style={{ ...btnStyle(TOKENS.dangerDim, TOKENS.dangerDim), color: TOKENS.danger, fontSize: 'var(--type-body-size)', border: `1px solid ${TOKENS.danger}` }}
              >
                🗑 Delete Block
              </button>
            )}
            {stagedOps.some((o) => o.op === 'delete' && o.parcel_id === selectedParcel.properties.id) && (
              <span style={{ fontSize: 'var(--type-ui-label-size)', fontWeight: 700, color: TOKENS.danger, background: TOKENS.dangerDim, padding: '4px 8px', borderRadius: 4, textAlign: 'center' }}>
                Staged for deletion
              </span>
            )}

            {/* Inline delete confirm */}
            {confirmDelete && (
              <div style={{ background: TOKENS.dangerDim, border: `1px solid ${TOKENS.danger}`, borderRadius: 6, padding: '8px 10px', display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: TOKENS.danger, fontSize: 'var(--type-ui-label-size)', flex: 1 }}>Permanently delete this block?</span>
                <button onClick={() => handleDeleteBlock(selectedParcel)} style={{ background: TOKENS.danger, border: 'none', color: TOKENS.parchment, borderRadius: 4, fontSize: 'var(--type-ui-label-size)', padding: '3px 8px', cursor: 'pointer', fontWeight: 600 }}>Yes, Delete</button>
                <button onClick={() => setConfirmDelete(false)} style={{ background: 'none', border: `1px solid ${TOKENS.border}`, color: TOKENS.muted, borderRadius: 4, fontSize: 'var(--type-ui-label-size)', padding: '3px 8px', cursor: 'pointer' }}>Cancel</button>
              </div>
            )}

            {/* Split Polygon button */}
            {!isEditing && (
              <button
                onClick={() => setShowSplitModal(true)}
                style={{ ...btnStyle(TOKENS.amber, TOKENS.amber), fontSize: 'var(--type-body-size)' }}
              >
                ✂️ Split Polygon
              </button>
            )}

            {/* Tab switcher */}
            <div style={{ display: 'flex', borderRadius: 5, overflow: 'hidden', border: `1px solid ${TOKENS.border}` }}>
              {['geometry', 'metadata'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => { if (!isEditing) setActiveTab(tab); }}
                  style={{
                    flex: 1, padding: '6px 0',
                    background: activeTab === tab ? TOKENS.electricBlue : TOKENS.surfaceRaised,
                    color: activeTab === tab ? TOKENS.ink : TOKENS.ghost,
                    border: 'none', cursor: isEditing ? 'not-allowed' : 'pointer',
                    fontSize: 'var(--type-ui-label-size)', fontWeight: 600, textTransform: 'capitalize',
                    opacity: isEditing && tab !== 'geometry' ? 0.4 : 1,
                  }}
                >
                  {tab === 'geometry' ? '⬡ Geometry' : '✎ Metadata'}
                </button>
              ))}
            </div>

            {/* Geometry tab */}
            {activeTab === 'geometry' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {!isEditing ? (
                  <button onClick={handleStartEdit} style={btnStyle(TOKENS.electricBlue, TOKENS.electricBlue)}>Edit Geometry</button>
                ) : (
                  <>
                    <div style={{ fontSize: 'var(--type-ui-label-size)', color: TOKENS.warning, background: TOKENS.warningDim, border: `1px solid ${TOKENS.warning}`, borderRadius: 5, padding: '6px 9px' }}>
                      ✏ Editing — drag vertices to reshape
                    </div>
                    <button onClick={handleSave} disabled={saveStatus === 'staging'} style={btnStyle(saveStatus === 'staging' ? TOKENS.vividGreen : TOKENS.success, TOKENS.vividGreen)}>
                      {saveStatus === 'staging' ? 'Staging…' : 'Stage Geometry'}
                    </button>
                    <button onClick={handleDiscard} style={{ background: 'transparent', color: TOKENS.muted, border: `1px solid ${TOKENS.border}`, borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 'var(--type-body-size)', fontWeight: 500 }}>Discard</button>
                  </>
                )}
                {statusMessage && (
                  <div style={{ color: saveStatus === 'error' ? TOKENS.danger : saveStatus === 'staged' ? TOKENS.success : TOKENS.muted, fontSize: 'var(--type-ui-label-size)', padding: '5px 9px', background: TOKENS.surfaceRaised, borderRadius: 5, lineHeight: 1.5 }}>
                    {statusMessage}
                  </div>
                )}
              </div>
            )}

            {/* Metadata tab */}
            {activeTab === 'metadata' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <MetaField label="Vineyard Name"       field="vineyard_name"     form={metaForm} setForm={setMetaForm} />
                <MetaField label="Organization"        field="vineyard_org"      form={metaForm} setForm={setMetaForm} />
                <MetaField label="Source Dataset"      field="source_dataset"    form={metaForm} setForm={setMetaForm} />
                <div style={{ height: 1, background: TOKENS.border }} />
                <MetaField label="AVA Name"            field="ava_name"          form={metaForm} setForm={setMetaForm} />
                <MetaField label="Nested AVA"          field="nested_ava"        form={metaForm} setForm={setMetaForm} />
                <MetaField label="Nested-Nested AVA"   field="nested_nested_ava" form={metaForm} setForm={setMetaForm} />
                <div style={{ height: 1, background: TOKENS.border }} />
                <MetaField label="Acres"               field="acres"             form={metaForm} setForm={setMetaForm} type="number" />
                <MetaField label="Varietals"           field="varietals_list"    form={metaForm} setForm={setMetaForm} multiline />
                <div style={{ height: 1, background: TOKENS.border }} />
                <MetaField label="Winery ID"           field="winery_id"         form={metaForm} setForm={setMetaForm} type="number" />
                <div style={{ height: 1, background: TOKENS.border }} />
                <button onClick={handleSaveMeta} disabled={metaSaveStatus === 'saving'} style={{ ...btnStyle(metaSaveStatus === 'saving' ? TOKENS.vividGreen : TOKENS.success, TOKENS.vividGreen), marginTop: 4, fontSize: 'var(--type-body-size)' }}>
                  {metaSaveStatus === 'saving' ? 'Staging…' : 'Stage Metadata'}
                </button>
                {metaStatusMessage && (
                  <div style={{ color: metaSaveStatus === 'error' ? TOKENS.danger : TOKENS.success, fontSize: 'var(--type-ui-label-size)', padding: '5px 9px', background: TOKENS.surfaceRaised, borderRadius: 5, lineHeight: 1.5 }}>
                    {metaStatusMessage}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Draw-new-block panel ── */}
        {isDrawingNew && (
          <div style={{ background: TOKENS.surfaceRaised, borderRadius: 8, border: `1px solid ${TOKENS.border}`, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ ...TYPE.uiLabel, color: TOKENS.electricBlue, fontSize: 'var(--type-ui-label-size)', fontWeight: 600 }}>New Block</div>
            {statusMessage && (
              <div style={{ color: TOKENS.muted, fontSize: 'var(--type-ui-label-size)', lineHeight: 1.5 }}>{statusMessage}</div>
            )}
            <MetaField label="Block Name" field="vineyard_name" form={newBlockForm} setForm={setNewBlockForm} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <label style={{ ...TYPE.uiLabel, color: TOKENS.ghost, fontSize: 'var(--type-ui-label-size)', fontWeight: 600 }}>
                Winery (optional)
              </label>
              <select
                value={newBlockForm.winery_id ?? ''}
                onChange={(e) => setNewBlockForm((f) => ({ ...f, winery_id: e.target.value }))}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: TOKENS.surface,
                  border: `1px solid ${TOKENS.border}`,
                  borderRadius: 5,
                  color: TOKENS.parchment,
                  fontSize: 'var(--type-body-size)',
                  padding: '5px 8px',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              >
                <option value="">Unknown / Independent</option>
                {wineries.map((w) => (
                  <option key={w.winery_id} value={String(w.winery_id)}>
                    {w.winery_name} (ID {w.winery_id})
                  </option>
                ))}
              </select>
            </div>
            <MetaField label="Source Dataset" field="source_dataset" form={newBlockForm} setForm={setNewBlockForm} />
            <MetaField label="AVA Name" field="ava_name" form={newBlockForm} setForm={setNewBlockForm} />
            <MetaField label="Varietals" field="varietals_list" form={newBlockForm} setForm={setNewBlockForm} multiline />
            {/* Clone Metadata Button */}
            {selectedParcel && (
              <button
                onClick={() => {
                  const props = selectedParcel.properties;
                  setNewBlockForm((f) => ({
                    ...f,
                    vineyard_name: props.vineyard_name ?? '',
                    vineyard_org: props.vineyard_org ?? '',
                    owner_name: props.owner_name ?? '',
                    ava_name: props.ava_name ?? '',
                    nested_ava: props.nested_ava ?? '',
                    nested_nested_ava: props.nested_nested_ava ?? '',
                    situs_address: props.situs_address ?? '',
                    situs_city: props.situs_city ?? '',
                    situs_zip: props.situs_zip ?? '',
                    acres: props.acres != null ? String(props.acres) : '',
                    varietals_list: props.varietals_list ?? '',
                    source_dataset: props.source_dataset ?? '',
                    winery_id: props.winery_id != null ? String(props.winery_id) : '',
                  }));
                }}
                style={{ ...btnStyle(TOKENS.amber, TOKENS.amber), fontSize: 'var(--type-body-size)', margin: '8px 0' }}
              >
                📋 Clone Metadata from Selected
              </button>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <button onClick={handleSaveNewBlock} disabled={!newBlockGeomRef.current} style={{ ...btnStyle(newBlockGeomRef.current ? TOKENS.success : TOKENS.surfaceRaised, TOKENS.vividGreen), flex: 1, fontSize: 'var(--type-body-size)', opacity: newBlockGeomRef.current ? 1 : 0.5 }}>
                Stage New Block
              </button>
              <button onClick={handleCancelDraw} style={{ background: 'transparent', color: TOKENS.muted, border: `1px solid ${TOKENS.border}`, borderRadius: 6, padding: '8px 10px', cursor: 'pointer', fontSize: 'var(--type-body-size)' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Staged changes panel ──────────────────────────────────────── */}
        {stagedOps.length > 0 && (
          <div style={{ borderTop: `1px solid ${TOKENS.border}`, paddingTop: 12 }}>
            <div style={{ ...TYPE.uiLabel, color: TOKENS.muted, marginBottom: 8 }}>
              Staged ({stagedOps.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10, maxHeight: 160, overflowY: 'auto' }}>
              {stagedOps.map((op, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: TOKENS.surfaceRaised, borderRadius: 5, padding: '5px 8px' }}>
                  <div>
                    <span style={{ ...TYPE.uiLabel, color: op.op === 'geometry' ? TOKENS.electricBlue : op.op === 'add' ? TOKENS.success : op.op === 'delete' ? TOKENS.danger : TOKENS.violet, fontWeight: 600 }}>{op.op}</span>
                    <span style={{ fontSize: 'var(--type-ui-label-size)', color: TOKENS.muted, marginLeft: 6 }}>{op.parcel_name}</span>
                  </div>
                  <button
                    onClick={() => setStagedOps((prev) => prev.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', color: TOKENS.muted, cursor: 'pointer', fontSize: 'var(--type-body-size)', padding: '0 2px', lineHeight: 1 }}
                  >×</button>
                </div>
              ))}
            </div>
            <button
              onClick={handlePushForReview}
              disabled={pushStatus === 'pushing'}
              style={{ ...btnStyle(pushStatus === 'pushing' ? TOKENS.warning : TOKENS.amber, TOKENS.warning), fontSize: 'var(--type-body-size)', fontWeight: 700 }}
            >
              {pushStatus === 'pushing' ? 'Submitting…' : `↑ Push ${stagedOps.length} Change${stagedOps.length !== 1 ? 's' : ''} for Review`}
            </button>
            {pushMessage && (
              <div style={{ marginTop: 6, fontSize: 'var(--type-ui-label-size)', color: pushStatus === 'error' ? TOKENS.danger : pushStatus === 'done' ? TOKENS.success : TOKENS.muted, background: TOKENS.surfaceRaised, borderRadius: 5, padding: '5px 8px', lineHeight: 1.5 }}>
                {pushMessage}
              </div>
            )}
          </div>
        )}

        {/* Help text */}
        <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: `1px solid ${TOKENS.border}`, color: TOKENS.ghost, fontSize: 'var(--type-ui-label-size)', lineHeight: 1.7 }}>
          <span style={{ color: TOKENS.muted, fontWeight: 600 }}>Editing station</span><br />
          Click a parcel on the map to select it.<br />
          Edit geometry or metadata, add or delete blocks.<br />
          Stage changes, then push as one batch.
        </div>
      </div>

      {/* ── Map ─────────────────────────────────────────────────────────── */}
      <div ref={mapContainerRef} style={{ flex: 1, position: 'relative' }} />

      {/* Split Parcel Modal */}
      {showSplitModal && selectedParcel && (
        <SplitParcelModal
          parcel={{ ...selectedParcel.properties, geometry: selectedParcel.geometry }}
          blocks={[]}
          onClose={() => setShowSplitModal(false)}
          onApplied={() => {
            setShowSplitModal(false);
            // Reload parcels after split
            fetch(`${API_BASE}/api/vineyards/parcels`, { headers: API_HEADERS })
              .then((r) => r.json())
              .then((data) => setParcels(data));
            setSelectedParcel(null);
          }}
        />
      )}
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function MetaField({ label, field, form, setForm, type = 'text', multiline = false }) {
  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    background: TOKENS.surface,
    border: `1px solid ${TOKENS.border}`,
    borderRadius: 5,
    color: TOKENS.parchment,
    fontSize: 'var(--type-body-size)',
    padding: '5px 8px',
    outline: 'none',
    resize: multiline ? 'vertical' : undefined,
    fontFamily: 'inherit',
    minHeight: multiline ? 56 : undefined,
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <label style={{ ...TYPE.uiLabel, color: TOKENS.ghost, fontSize: 'var(--type-ui-label-size)', fontWeight: 600 }}>
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
      background: TOKENS.surface,
      color: TOKENS.ghost,
      fontSize: 'var(--type-ui-label-size)',
      padding: '2px 7px',
      borderRadius: 4,
      border: `1px solid ${TOKENS.border}`,
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
    fontSize: 'var(--type-mono-size)',
    fontWeight: 600,
    width: '100%',
  };
}
