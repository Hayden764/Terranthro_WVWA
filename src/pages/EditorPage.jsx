import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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
  const navigate = useNavigate();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);

  const [authChecked, setAuthChecked] = useState(false);
  const [parcels, setParcels] = useState(null);

  // ── Vineyard-group selection ──────────────────────────────────────────────
  // selectedWinery: { id: number|null, title: string, parcels: Feature[] }
  // null id = the "Unlinked" bucket
  const [selectedWinery, setSelectedWinery] = useState(null);
  // focusedParcelId: which block within the selected vineyard has its edit panel open
  const [focusedParcelId, setFocusedParcelId] = useState(null);

  // Keep the old selectedParcel shape as a derived value so edit handlers work unchanged
  const selectedParcel = useMemo(() => {
    if (!selectedWinery || focusedParcelId == null) return null;
    return selectedWinery.parcels.find((f) => f.properties.id === focusedParcelId) ?? null;
  }, [selectedWinery, focusedParcelId]);
  const setSelectedParcel = useCallback((updater) => {
    // Allow edit handlers to update the feature in-place (used by handleSaveMeta)
    setSelectedWinery((prev) => {
      if (!prev) return prev;
      const next = typeof updater === 'function' ? updater(
        prev.parcels.find((f) => f.properties.id === focusedParcelId) ?? null
      ) : updater;
      if (!next) return prev;
      return { ...prev, parcels: prev.parcels.map((f) => f.properties.id === next.properties?.id ? next : f) };
    });
  }, [focusedParcelId]);

  // Drawing-a-new-block state
  const [isDrawingNew, setIsDrawingNew] = useState(false);
  const [newBlockForm, setNewBlockForm] = useState({ vineyard_name: '', source_dataset: 'admin' });
  const newBlockGeomRef = useRef(null); // stores drawn GeoJSON geometry

  // Confirm-delete state
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

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
  // winery_id for the batch request — prefer selected winery, then first staged op
  const batchWineryId = useMemo(() => {
    if (selectedWinery?.id) return selectedWinery.id;
    for (const op of stagedOps) {
      if (op.winery_id) return op.winery_id;
    }
    return null;
  }, [selectedWinery, stagedOps]);

  // Refs for use inside event handlers
  const selectedParcelRef = useRef(null);
  const selectedWineryRef = useRef(null);
  const isEditingRef = useRef(false);
  const hoveredIdRef = useRef(null);

  selectedParcelRef.current = selectedParcel;
  selectedWineryRef.current = selectedWinery;
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

      // ── Click to select vineyard group ───────────────────────────────
      map.on('click', 'parcels-fill', (e) => {
        if (isEditingRef.current || !e.features?.length) return;
        const feature = e.features[0];
        const clickedWineryId = feature.properties?.winery_id ?? null;
        const clickedParcelId = feature.properties?.id;

        // If same winery already selected, focus the specific parcel that was clicked
        if (selectedWineryRef.current &&
            String(selectedWineryRef.current.id ?? '') === String(clickedWineryId ?? '')) {
          setFocusedParcelId(clickedParcelId);
          setActiveTab('geometry');
          setIsEditing(false);
          setSaveStatus('idle');
          setStatusMessage('');
          e.stopPropagation?.();
          return;
        }

        // Select the vineyard group from the loaded parcels
        // (parcelsRef needed — use the source directly)
        const allFeatures = map.getSource('parcels')?._data?.features ?? [];
        const groupFeatures = allFeatures.filter(
          (f) => String(f.properties?.winery_id ?? '') === String(clickedWineryId ?? '')
        );

        const wineryTitle = feature.properties?.winery_title ||
          (clickedWineryId ? `Winery #${clickedWineryId}` : 'Unlinked Parcels');

        // Clear old feature-state selection
        if (selectedParcelRef.current?._mapId != null) {
          map.setFeatureState({ source: 'parcels', id: selectedParcelRef.current._mapId }, { selected: false });
        }
        // Highlight the clicked feature
        map.setFeatureState({ source: 'parcels', id: feature.id }, { selected: true });

        setSelectedWinery({ id: clickedWineryId, title: wineryTitle, parcels: groupFeatures });
        setFocusedParcelId(clickedParcelId);
        setIsEditing(false);
        setSaveStatus('idle');
        setStatusMessage('');
        setActiveTab('geometry');
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
          setSelectedWinery(null);
          setFocusedParcelId(null);
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
      'vineyard_name', 'vineyard_org', 'owner_name', 'ava_name',
      'nested_ava', 'nested_nested_ava', 'situs_address', 'situs_city',
      'situs_zip', 'acres', 'varietals_list', 'source_dataset', 'winery_id',
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
    }));
    setMetaSaveStatus('staged');
    setMetaStatusMessage('Staged for review.');
    setTimeout(() => setMetaSaveStatus('idle'), 3000);
  }, [selectedParcel, metaForm]);

  // ── Push for Review ────────────────────────────────────────────────────────
  const handlePushForReview = useCallback(async () => {
    if (stagedOps.length === 0) return;
    const wineryId = batchWineryId;
    if (!wineryId) {
      setPushMessage('Cannot submit: no winery_id found on any staged parcel. Ensure parcels are linked to a winery first.');
      setPushStatus('error');
      return;
    }
    setPushStatus('pushing');
    setPushMessage('Submitting…');
    try {
      const res = await fetch(`${API_BASE}/api/admin/requests/batch`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...API_HEADERS },
        body: JSON.stringify({ winery_id: wineryId, ops: stagedOps }),
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

  // ── Select a block within the active vineyard ─────────────────────────────
  const handleSelectBlock = useCallback((feature) => {
    if (isEditing) return;
    const pid = feature.properties.id;
    setFocusedParcelId(pid);
    setActiveTab('geometry');
    setIsEditing(false);
    setSaveStatus('idle');
    setStatusMessage('');
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
    // Fly to block
    const map = mapRef.current;
    if (map && feature.geometry?.coordinates) {
      const flat = [];
      const flatten = (arr) => {
        if (typeof arr[0] === 'number') { flat.push(arr); return; }
        arr.forEach(flatten);
      };
      flatten(feature.geometry.coordinates);
      if (flat.length) {
        const lngs = flat.map((c) => c[0]);
        const lats = flat.map((c) => c[1]);
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 100, maxZoom: 17, duration: 600 }
        );
      }
    }
  }, [isEditing]);

  // ── Stage a delete op ─────────────────────────────────────────────────────
  const handleDeleteBlock = useCallback((feature) => {
    const parcelId = feature.properties.id;
    setStagedOps((prev) => {
      // Remove any existing ops for this parcel (superseded by delete)
      const without = prev.filter((o) => o.parcel_id !== parcelId);
      return [...without, {
        op: 'delete',
        parcel_id: parcelId,
        parcel_name: feature.properties.vineyard_name || `Parcel #${parcelId}`,
        winery_id: feature.properties.winery_id,
      }];
    });
    // Remove from local winery parcels immediately so the list updates
    setSelectedWinery((prev) => prev
      ? { ...prev, parcels: prev.parcels.filter((f) => f.properties.id !== parcelId) }
      : prev
    );
    if (focusedParcelId === parcelId) setFocusedParcelId(null);
    setConfirmDeleteId(null);
  }, [focusedParcelId]);

  // ── Start drawing a new block ──────────────────────────────────────────────
  const handleStartDrawNew = useCallback(() => {
    if (!drawRef.current) return;
    drawRef.current.deleteAll();
    drawRef.current.changeMode('draw_polygon');
    setIsDrawingNew(true);
    setFocusedParcelId(null);
    setStatusMessage('Draw the new block boundary on the map. Click to place vertices, double-click to finish.');
    newBlockGeomRef.current = null;
    setNewBlockForm({ vineyard_name: '', source_dataset: 'admin', winery_id: selectedWinery?.id ? String(selectedWinery.id) : '' });
  }, [selectedWinery]);

  // ── Listen for draw.create to capture the new polygon ────────────────────
  // Wired once after draw is initialised — uses a stable ref pattern
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
      setStatusMessage('Polygon drawn. Fill in the block details below and click "Stage New Block".');
    };
    map.on('draw.create', onDrawCreate);
    return () => map.off('draw.create', onDrawCreate);
  }, []);

  // ── Stage a new-block add op ───────────────────────────────────────────────
  const handleSaveNewBlock = useCallback(() => {
    const geom = newBlockGeomRef.current;
    if (!geom) { setStatusMessage('No polygon drawn yet.'); return; }
    const wineryId = selectedWinery?.id ?? (newBlockForm.winery_id ? parseInt(newBlockForm.winery_id, 10) : null);
    const tempId = `new_${Date.now()}`;
    setStagedOps((prev) => [...prev, {
      op: 'add',
      temp_id: tempId,
      parcel_name: newBlockForm.vineyard_name || 'New Block',
      winery_id: wineryId,
      geometry: geom,
      fields: { ...newBlockForm, winery_id: wineryId },
    }]);
    drawRef.current?.deleteAll();
    newBlockGeomRef.current = null;
    setNewBlockForm({ vineyard_name: '', source_dataset: 'admin' });
    setStatusMessage('New block staged for review.');
    setTimeout(() => setStatusMessage(''), 3000);
  }, [selectedWinery, newBlockForm]);

  // ── Cancel drawing ─────────────────────────────────────────────────────────
  const handleCancelDraw = useCallback(() => {
    drawRef.current?.deleteAll();
    drawRef.current?.changeMode('simple_select');
    setIsDrawingNew(false);
    newBlockGeomRef.current = null;
    setStatusMessage('');
  }, []);

  // ── Select winery group from search list ──────────────────────────────────
  const handleSelectFromList = useCallback(
    (wineryId, wineryTitle) => {
      if (isEditing) return;
      if (!parcels) return;

      const groupFeatures = parcels.features.filter(
        (f) => String(f.properties?.winery_id ?? '') === String(wineryId ?? '')
      );
      setSelectedWinery({ id: wineryId, title: wineryTitle, parcels: groupFeatures });
      setFocusedParcelId(groupFeatures[0]?.properties?.id ?? null);
      setIsEditing(false);
      setSaveStatus('idle');
      setStatusMessage('');
      setActiveTab('geometry');
      setSearchQuery('');

      // Fly to bounding box of all blocks in the group
      const map = mapRef.current;
      if (map && groupFeatures.length > 0) {
        const flat = [];
        const fl = (arr) => { if (typeof arr[0] === 'number') { flat.push(arr); return; } arr.forEach(fl); };
        groupFeatures.forEach((f) => f.geometry?.coordinates && fl(f.geometry.coordinates));
        if (flat.length) {
          const lngs = flat.map((c) => c[0]);
          const lats = flat.map((c) => c[1]);
          map.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: 80, maxZoom: 17, duration: 700 }
          );
        }
      }

      if (groupFeatures[0]) {
        const props = groupFeatures[0].properties;
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
      }
    },
    [isEditing, parcels]
  );

  // ── Build search results — grouped by winery ──────────────────────────────
  const searchResults = useMemo(() => {
    if (!parcels || !searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const map = new Map(); // wineryKey -> { id, title, count, acres, sample }

    for (const f of parcels.features) {
      const p = f.properties;
      const matches =
        p.vineyard_name?.toLowerCase().includes(q) ||
        p.winery_title?.toLowerCase().includes(q);
      if (!matches) continue;

      const key = String(p.winery_id ?? '__unlinked__');
      if (!map.has(key)) {
        map.set(key, {
          id: p.winery_id ?? null,
          title: p.winery_title || (p.winery_id ? `Winery #${p.winery_id}` : 'Unlinked Parcels'),
          count: 0,
          acres: 0,
        });
      }
      const entry = map.get(key);
      entry.count++;
      entry.acres += Number(p.acres || 0);
    }
    return [...map.values()].sort((a, b) => (a.title > b.title ? 1 : -1));
  }, [parcels, searchQuery]);

  // ── Render ────────────────────────────────────────────────────────────────
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
          <Link to="/admin/dashboard" style={{ color: '#475569', fontSize: 12, textDecoration: 'none' }}>
            ← Dashboard
          </Link>
        </div>

        {/* Parcel count */}
        <p style={{ color: '#475569', fontSize: 11, margin: 0 }}>
          {parcels ? `${parcels.features.length.toLocaleString()} parcels loaded` : 'Loading parcels…'}
        </p>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder="Search by vineyard or winery…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#1e293b', border: '1px solid #334155',
              borderRadius: 6, color: '#f1f5f9', fontSize: 12,
              padding: '7px 10px', outline: 'none',
            }}
          />
        </div>

        {/* ── Search results (grouped by winery) ── */}
        {searchQuery.trim() && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
            {searchResults.length === 0 && (
              <div style={{ color: '#475569', fontSize: 12, padding: '6px 0' }}>No matches</div>
            )}
            {searchResults.map((entry) => (
              <button
                key={String(entry.id ?? '__unlinked__')}
                onClick={() => handleSelectFromList(entry.id, entry.title)}
                style={{
                  background: '#1e293b', border: '1px solid #334155', borderRadius: 5,
                  color: '#e2e8f0', fontSize: 12, padding: '7px 10px',
                  cursor: 'pointer', textAlign: 'left', lineHeight: 1.4,
                }}
              >
                <div style={{ fontWeight: 500 }}>{entry.title}</div>
                <div style={{ color: '#64748b', fontSize: 11 }}>
                  {entry.count} block{entry.count !== 1 ? 's' : ''} · {entry.acres.toFixed(1)} ac
                </div>
              </button>
            ))}
          </div>
        )}

        <div style={{ height: 1, background: '#1e293b' }} />

        {/* ── No selection state ── */}
        {!selectedWinery && !searchQuery && (
          <div style={{ color: '#64748b', fontSize: 12, background: '#1e293b', borderRadius: 8, padding: '12px', lineHeight: 1.7 }}>
            Click any parcel on the map to select its vineyard, or search by name above.
          </div>
        )}

        {/* ── Vineyard group panel ── */}
        {selectedWinery && !searchQuery && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Vineyard header */}
            <div style={{ background: '#1e293b', borderRadius: 8, padding: '10px 12px', border: '1px solid #334155' }}>
              <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 13 }}>
                {selectedWinery.title}
              </div>
              <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                {selectedWinery.parcels.length} block{selectedWinery.parcels.length !== 1 ? 's' : ''} ·{' '}
                {selectedWinery.parcels.reduce((s, f) => s + Number(f.properties.acres || 0), 0).toFixed(1)} ac total
              </div>
              <button
                onClick={() => { setSelectedWinery(null); setFocusedParcelId(null); setIsEditing(false); setIsDrawingNew(false); drawRef.current?.deleteAll(); }}
                style={{ background: 'none', border: 'none', color: '#475569', fontSize: 11, cursor: 'pointer', padding: '4px 0 0 0', display: 'block' }}
              >
                ← Back
              </button>
            </div>

            {/* Block list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {selectedWinery.parcels.map((f) => {
                const pid = f.properties.id;
                const isFocused = focusedParcelId === pid;
                const isDeletePending = stagedOps.some((o) => o.op === 'delete' && o.parcel_id === pid);
                return (
                  <div key={pid}>
                    {/* Block row */}
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: isFocused ? 'rgba(34,211,238,0.08)' : '#1e293b',
                        border: `1px solid ${isFocused ? '#22d3ee' : '#334155'}`,
                        borderRadius: confirmDeleteId === pid ? '6px 6px 0 0' : 6,
                        padding: '7px 10px', cursor: 'pointer',
                      }}
                      onClick={() => { if (confirmDeleteId === pid) return; handleSelectBlock(f); }}
                    >
                      <span style={{ fontSize: 9, color: isFocused ? '#22d3ee' : '#475569' }}>{isFocused ? '●' : '○'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: isFocused ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.properties.vineyard_name || `Block #${pid}`}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 10 }}>
                          {f.properties.acres ? `${Number(f.properties.acres).toFixed(1)} ac` : 'no area'}{' '}
                          {f.properties.nested_ava ? `· ${f.properties.nested_ava}` : ''}
                        </div>
                      </div>
                      {!isDeletePending && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(pid === confirmDeleteId ? null : pid); }}
                          title="Delete block"
                          style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 13, padding: '2px 4px', lineHeight: 1, flexShrink: 0 }}
                        >✕</button>
                      )}
                      {isDeletePending && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.12)', padding: '1px 5px', borderRadius: 3 }}>DEL</span>
                      )}
                    </div>

                    {/* Inline delete confirm */}
                    {confirmDeleteId === pid && (
                      <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderTop: 'none', borderRadius: '0 0 6px 6px', padding: '8px 10px', display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ color: '#fca5a5', fontSize: 11, flex: 1 }}>Delete this block?</span>
                        <button onClick={() => handleDeleteBlock(f)} style={{ background: '#ef4444', border: 'none', color: '#fff', borderRadius: 4, fontSize: 11, padding: '3px 8px', cursor: 'pointer', fontWeight: 600 }}>Yes</button>
                        <button onClick={() => setConfirmDeleteId(null)} style={{ background: 'none', border: '1px solid #475569', color: '#94a3b8', borderRadius: 4, fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>No</button>
                      </div>
                    )}

                    {/* Block edit panel (only when focused) */}
                    {isFocused && !isDrawingNew && (
                      <div style={{ background: '#0f172a', border: '1px solid #334155', borderTop: 'none', borderRadius: '0 0 6px 6px', padding: '10px 10px 12px' }}>
                        {/* Tab switcher */}
                        <div style={{ display: 'flex', borderRadius: 5, overflow: 'hidden', border: '1px solid #334155', marginBottom: 10 }}>
                          {['geometry', 'metadata'].map((tab) => (
                            <button
                              key={tab}
                              onClick={() => { if (!isEditing) setActiveTab(tab); }}
                              style={{
                                flex: 1, padding: '6px 0',
                                background: activeTab === tab ? '#3b82f6' : '#1e293b',
                                color: activeTab === tab ? '#fff' : '#64748b',
                                border: 'none', cursor: isEditing ? 'not-allowed' : 'pointer',
                                fontSize: 11, fontWeight: 600, textTransform: 'capitalize',
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
                              <button onClick={handleStartEdit} style={btnStyle('#3b82f6', '#2563eb')}>Edit Geometry</button>
                            ) : (
                              <>
                                <div style={{ fontSize: 11, color: '#fbbf24', background: '#1e293b', border: '1px solid #92400e', borderRadius: 5, padding: '6px 9px' }}>
                                  ✏ Editing — drag vertices to reshape
                                </div>
                                <button onClick={handleSave} disabled={saveStatus === 'staging'} style={btnStyle(saveStatus === 'staging' ? '#166534' : '#16a34a', '#15803d')}>
                                  {saveStatus === 'staging' ? 'Staging…' : 'Stage Geometry'}
                                </button>
                                <button onClick={handleDiscard} style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>Discard</button>
                              </>
                            )}
                            {statusMessage && (
                              <div style={{ color: saveStatus === 'error' ? '#f87171' : saveStatus === 'staged' ? '#4ade80' : '#94a3b8', fontSize: 11, padding: '5px 9px', background: '#1e293b', borderRadius: 5, lineHeight: 1.5 }}>
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
                            <MetaField label="Owner Name"          field="owner_name"        form={metaForm} setForm={setMetaForm} />
                            <MetaField label="Source Dataset"      field="source_dataset"    form={metaForm} setForm={setMetaForm} />
                            <div style={{ height: 1, background: '#1e293b' }} />
                            <MetaField label="AVA Name"            field="ava_name"          form={metaForm} setForm={setMetaForm} />
                            <MetaField label="Nested AVA"          field="nested_ava"        form={metaForm} setForm={setMetaForm} />
                            <MetaField label="Nested-Nested AVA"   field="nested_nested_ava" form={metaForm} setForm={setMetaForm} />
                            <div style={{ height: 1, background: '#1e293b' }} />
                            <MetaField label="Acres"               field="acres"             form={metaForm} setForm={setMetaForm} type="number" />
                            <MetaField label="Varietals"           field="varietals_list"    form={metaForm} setForm={setMetaForm} multiline />
                            <div style={{ height: 1, background: '#1e293b' }} />
                            <MetaField label="Winery ID"           field="winery_id"         form={metaForm} setForm={setMetaForm} type="number" />
                            <div style={{ height: 1, background: '#1e293b' }} />
                            <MetaField label="Situs Address"       field="situs_address"     form={metaForm} setForm={setMetaForm} />
                            <MetaField label="Situs City"          field="situs_city"        form={metaForm} setForm={setMetaForm} />
                            <MetaField label="Situs ZIP"           field="situs_zip"         form={metaForm} setForm={setMetaForm} />
                            <button onClick={handleSaveMeta} disabled={metaSaveStatus === 'saving'} style={{ ...btnStyle(metaSaveStatus === 'saving' ? '#166534' : '#16a34a', '#15803d'), marginTop: 4, fontSize: 12 }}>
                              {metaSaveStatus === 'saving' ? 'Staging…' : 'Stage Metadata'}
                            </button>
                            {metaStatusMessage && (
                              <div style={{ color: metaSaveStatus === 'error' ? '#f87171' : '#4ade80', fontSize: 11, padding: '5px 9px', background: '#1e293b', borderRadius: 5, lineHeight: 1.5 }}>
                                {metaStatusMessage}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Add new block ── */}
            {!isDrawingNew && !isEditing && (
              <button onClick={handleStartDrawNew} style={{ ...btnStyle('#0f766e', '#0d9488'), fontSize: 12 }}>
                + Add New Block
              </button>
            )}

            {/* ── Draw-new-block panel ── */}
            {isDrawingNew && (
              <div style={{ background: '#1e293b', borderRadius: 8, border: '1px solid #334155', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ color: '#22d3ee', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>New Block</div>
                {statusMessage && (
                  <div style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.5 }}>{statusMessage}</div>
                )}
                <MetaField label="Block Name" field="vineyard_name" form={newBlockForm} setForm={setNewBlockForm} />
                <MetaField label="Source Dataset" field="source_dataset" form={newBlockForm} setForm={setNewBlockForm} />
                <MetaField label="AVA Name" field="ava_name" form={newBlockForm} setForm={setNewBlockForm} />
                <MetaField label="Varietals" field="varietals_list" form={newBlockForm} setForm={setNewBlockForm} multiline />
                <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                  <button onClick={handleSaveNewBlock} disabled={!newBlockGeomRef.current} style={{ ...btnStyle(newBlockGeomRef.current ? '#16a34a' : '#1e293b', '#15803d'), flex: 1, fontSize: 12, opacity: newBlockGeomRef.current ? 1 : 0.5 }}>
                    Stage New Block
                  </button>
                  <button onClick={handleCancelDraw} style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', cursor: 'pointer', fontSize: 12 }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Staged changes panel ──────────────────────────────────────── */}
        {stagedOps.length > 0 && (
          <div style={{ borderTop: '1px solid #1e293b', paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Staged ({stagedOps.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10, maxHeight: 160, overflowY: 'auto' }}>
              {stagedOps.map((op, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b', borderRadius: 5, padding: '5px 8px' }}>
                  <div>
                    <span style={{ fontSize: 11, color: op.op === 'geometry' ? '#60a5fa' : op.op === 'add' ? '#4ade80' : op.op === 'delete' ? '#f87171' : '#a78bfa', fontWeight: 600, textTransform: 'uppercase' }}>{op.op}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>{op.parcel_name}</span>
                  </div>
                  <button
                    onClick={() => setStagedOps((prev) => prev.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
                  >×</button>
                </div>
              ))}
            </div>
            <button
              onClick={handlePushForReview}
              disabled={pushStatus === 'pushing'}
              style={{ ...btnStyle(pushStatus === 'pushing' ? '#78350f' : '#d97706', '#b45309'), fontSize: 12, fontWeight: 700 }}
            >
              {pushStatus === 'pushing' ? 'Submitting…' : `↑ Push ${stagedOps.length} Change${stagedOps.length !== 1 ? 's' : ''} for Review`}
            </button>
            {pushMessage && (
              <div style={{ marginTop: 6, fontSize: 11, color: pushStatus === 'error' ? '#f87171' : pushStatus === 'done' ? '#4ade80' : '#94a3b8', background: '#1e293b', borderRadius: 5, padding: '5px 8px', lineHeight: 1.5 }}>
                {pushMessage}
              </div>
            )}
          </div>
        )}

        {/* Help text */}
        <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid #1e293b', color: '#334155', fontSize: 11, lineHeight: 1.7 }}>
          <span style={{ color: '#475569', fontWeight: 600 }}>Editing station</span><br />
          Click a parcel → see all blocks for that vineyard.<br />
          Edit geometry, metadata, add or delete blocks.<br />
          Stage changes, then push as one batch.
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
