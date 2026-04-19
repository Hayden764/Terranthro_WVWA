/**
 * AdminRequestDetail — full-page review view for a single edit request.
 * Route: /admin/requests/:id
 *
 * Shows:
 *   - Request metadata (type, winery, status, timestamps)
 *   - geometry_update  → old/new overlay map + notes
 *   - vineyard_blocks  → before/after field changelog table + new blocks table
 *   - other types      → formatted JSON payload
 *   - Approve / Reject actions (if pending)
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { apiJson, apiPost } from '../../lib/api';
import AdminGeometryDiffMap from './AdminGeometryDiffMap';
import AdminBatchMap from './AdminBatchMap';

const REQUEST_TYPE_LABELS = {
  profile:            'Winery Profile',
  vineyard_varietals: 'Varietals Update',
  vineyard_blocks:    'Block Info Update',
  vineyard_claim:     'Vineyard Claim',
  vineyard_new:       'New Vineyard',
  geometry_update:    'Boundary Edit',
  admin_batch_edit:   'Admin Batch Edit',
};

const BLOCK_FIELDS = ['block_name', 'variety', 'clone', 'rootstock', 'row_orientation', 'vine_spacing', 'row_spacing', 'year_planted', 'trellis'];

export default function AdminRequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionStatus, setActionStatus] = useState(null); // 'working' | 'done' | 'error'
  const [rejectNotes, setRejectNotes] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiJson(`/api/admin/requests/${id}`);
      setRequest(r);
    } catch {
      navigate('/admin/dashboard', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  async function handleAction(action) {
    setActionStatus('working');
    try {
      await apiPost(`/api/admin/requests/${id}/${action}`, {
        admin_notes: action === 'reject' ? (rejectNotes || undefined) : undefined,
      });
      setActionStatus('done');
      await load();
      setShowRejectBox(false);
      setRejectNotes('');
    } catch {
      setActionStatus('error');
    }
  }

  if (loading) {
    return (
      <Shell>
        <p style={{ color: '#888' }}>Loading request…</p>
      </Shell>
    );
  }

  if (!request) return null;

  const payload = request.payload || {};
  const isPending = request.status === 'pending';
  const parcel = request.parcel || null;
  const isGeometryUpdate = request.request_type === 'geometry_update';

  // For geometry_update, use parcel.geometry as old_geometry fallback
  const effectivePayload = isGeometryUpdate
    ? { ...payload, old_geometry: payload.old_geometry || parcel?.geometry || null }
    : payload;

  return (
    <Shell>
      {/* Back link */}
      <Link
        to="/admin/dashboard"
        style={{ fontSize: 12, color: '#4a90d9', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 20 }}
      >
        ← Back to Dashboard
      </Link>

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, color: '#e0e0e0', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {REQUEST_TYPE_LABELS[request.request_type] || request.request_type.replace(/_/g, ' ')}
            <span style={{ fontSize: 14, fontWeight: 400, color: '#666' }}>#{request.id}</span>
            {request.origin === 'admin' && (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#818cf8', background: 'rgba(99,102,241,0.12)', borderRadius: 4, padding: '2px 7px' }}>ADMIN</span>
            )}
            {request.flag === 'acreage_change' && (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#eab308', background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.25)', borderRadius: 4, padding: '2px 7px' }}>
                ⚠ Acreage Δ{request.flag_detail?.pct_change != null ? ` ${request.flag_detail.pct_change > 0 ? '+' : ''}${request.flag_detail.pct_change}%` : ''}
              </span>
            )}
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: '#aaa' }}>
            <strong style={{ color: '#ccc' }}>{request.winery_name}</strong>
            {request.contact_email ? `· ${request.contact_email}` : request.submitted_by_admin_name ? `· by admin: ${request.submitted_by_admin_name}` : ''}
            {parcel && (
              <span style={{ color: '#888' }}>
                {' · '}{parcel.vineyard_name || `Parcel #${request.target_id}`}
                {parcel.acres && ` · ${Number(parcel.acres).toFixed(1)} ac`}
                {parcel.ava_name && ` · ${parcel.ava_name}`}
              </span>
            )}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      {/* Timestamps */}
      <div style={{ fontSize: 11, color: '#555', marginBottom: 20, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span>Submitted {new Date(request.created_at).toLocaleString()}</span>
        {request.reviewed_at && (
          <span>
            {request.status === 'approved' ? 'Approved' : 'Rejected'}{' '}
            {new Date(request.reviewed_at).toLocaleString()}
            {request.reviewed_by_name && ` by ${request.reviewed_by_name}`}
          </span>
        )}
      </div>

      {/* Admin notes (if already reviewed) */}
      {request.admin_notes && (
        <div style={{ ...infoBox, borderColor: 'rgba(255,193,7,0.2)', marginBottom: 20 }}>
          <SectionLabel>Admin note</SectionLabel>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{request.admin_notes}</p>
        </div>
      )}

      {/* ── Two-column layout for requests with a parcel ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: parcel?.geometry ? '1fr 340px' : '1fr',
        gap: 24,
        alignItems: 'start',
      }}>
        {/* Left: payload diff */}
        <div>
          <PayloadSection requestType={request.request_type} payload={effectivePayload} />
        </div>

        {/* Right: parcel context map (always shown when geometry exists) */}
        {parcel?.geometry && !isGeometryUpdate && (
          <div style={{ position: 'sticky', top: 20 }}>
            <SectionLabel>Parcel location</SectionLabel>
            <ParcelContextMap geometry={parcel.geometry} />
            <div style={{ fontSize: 11, color: '#555', marginTop: 6 }}>
              {parcel.vineyard_name && <div style={{ color: '#888' }}>{parcel.vineyard_name}</div>}
              {parcel.ava_name && <div>{parcel.ava_name}</div>}
              {parcel.acres && <div>{Number(parcel.acres).toFixed(1)} acres</div>}
            </div>
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      {isPending && (
        <div style={{ marginTop: 28, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 20 }}>
          {actionStatus === 'error' && (
            <p style={{ fontSize: 12, color: '#ef9a9a', marginBottom: 12 }}>Action failed — please try again.</p>
          )}

          {!showRejectBox ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => handleAction('approve')}
                disabled={actionStatus === 'working'}
                style={approveBtnStyle}
              >
                {actionStatus === 'working' ? 'Working…' : '✓ Approve'}
              </button>
              <button
                onClick={() => setShowRejectBox(true)}
                disabled={actionStatus === 'working'}
                style={rejectBtnStyle}
              >
                ✕ Reject
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
              <label style={{ fontSize: 12, color: '#888' }}>Rejection reason (optional)</label>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={3}
                placeholder="Explain why this request is being rejected…"
                style={{
                  padding: '8px 10px', borderRadius: 6, fontSize: 13, color: '#e0e0e0',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
                  resize: 'vertical', outline: 'none', fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => handleAction('reject')}
                  disabled={actionStatus === 'working'}
                  style={rejectBtnStyle}
                >
                  {actionStatus === 'working' ? 'Working…' : 'Confirm Reject'}
                </button>
                <button onClick={() => setShowRejectBox(false)} style={outlineBtn}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {actionStatus === 'done' && (
        <p style={{ fontSize: 12, color: '#81c784', marginTop: 12 }}>Action applied successfully.</p>
      )}

      {/* Entity history — shown when this request targets a parcel */}
      {request.target_id && (
        <AdminEntityHistory entityType="vineyard_parcel" entityId={request.target_id} currentRequestId={request.id} />
      )}
    </Shell>
  );
}

// ── AdminEntityHistory ───────────────────────────────────────────────────────
// Shows the full audit trail for the target parcel, grouped by request.

function AdminEntityHistory({ entityType, entityId, currentRequestId }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (data) return;
    setLoading(true);
    try {
      const res = await apiJson(`/api/admin/history/${entityType}/${entityId}`);
      setData(res);
    } catch (e) {
      setData({ error: e.message });
    } finally {
      setLoading(false);
    }
  }, [data, entityType, entityId]);

  const toggle = () => {
    if (!open) load();
    setOpen(o => !o);
  };

  const sectionStyle = {
    marginTop: 28,
    borderTop: '1px solid #333',
    paddingTop: 16,
  };
  const headerStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    cursor: 'pointer', userSelect: 'none',
  };
  const titleStyle = { fontSize: 13, fontWeight: 600, color: '#ccc', letterSpacing: '0.04em', textTransform: 'uppercase' };
  const chevron = open ? '▲' : '▼';

  const fmtDate = iso => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const typeLabel = t => ({
    profile: 'Winery Profile',
    vineyard_varietals: 'Varietals Update',
    vineyard_blocks: 'Block Info Update',
    vineyard_claim: 'Vineyard Claim',
    vineyard_new: 'New Vineyard',
    geometry_update: 'Boundary Edit',
  }[t] || t);

  const statusColor = s => ({ pending: '#f0a500', approved: '#66bb6a', rejected: '#e57373' }[s] || '#aaa');

  const renderLogEntries = entries => {
    if (!entries || entries.length === 0) return null;
    // group by request_id
    const groups = {};
    entries.forEach(e => {
      const key = e.request_id ?? `_${e.id}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });
    return Object.values(groups).map((rows, gi) => {
      const first = rows[0];
      return (
        <div key={gi} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #2a2a2a' }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
            {fmtDate(first.created_at)} · <span style={{ color: '#aaa' }}>{typeLabel(first.request_type)}</span>
            {first.changed_by_email && <span> · {first.changed_by_email}</span>}
          </div>
          {rows.map((row, ri) => (
            <div key={ri} style={{ fontSize: 12, color: '#bbb', paddingLeft: 8, marginTop: 2 }}>
              {row.field_name === 'geometry'
                ? <span style={{ color: '#90caf9' }}>Boundary geometry updated</span>
                : <>
                    <span style={{ color: '#e0e0e0', fontWeight: 500 }}>{row.field_name}</span>
                    {': '}
                    <span style={{ color: '#e57373' }}>{String(row.old_value ?? '—')}</span>
                    {' → '}
                    <span style={{ color: '#81c784' }}>{String(row.new_value ?? '—')}</span>
                  </>}
            </div>
          ))}
        </div>
      );
    });
  };

  return (
    <div style={sectionStyle}>
      <div style={headerStyle} onClick={toggle}>
        <span style={titleStyle}>Parcel Edit History</span>
        <span style={{ fontSize: 11, color: '#666' }}>{chevron}</span>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          {loading && <p style={{ fontSize: 12, color: '#888' }}>Loading…</p>}
          {data?.error && <p style={{ fontSize: 12, color: '#e57373' }}>{data.error}</p>}

          {data && !data.error && (
            <>
              {/* Pending / rejected requests */}
              {data.pending && data.pending.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <p style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Open Requests</p>
                  {data.pending.map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 }}>
                      <span style={{ color: statusColor(r.status), fontWeight: 600, minWidth: 64 }}>{r.status}</span>
                      <span style={{ color: '#aaa' }}>{typeLabel(r.request_type)}</span>
                      <span style={{ color: '#666' }}>{fmtDate(r.created_at)}</span>
                      {r.id !== currentRequestId && (
                        <Link to={`/admin/requests/${r.id}`} style={{ color: '#90caf9', fontSize: 11, marginLeft: 'auto' }}>View →</Link>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Applied log */}
              {data.log && data.log.length > 0
                ? renderLogEntries(data.log)
                : <p style={{ fontSize: 12, color: '#666', fontStyle: 'italic' }}>No applied changes recorded yet.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── ParcelContextMap ────────────────────────────────────────────────────────
// A small single-parcel reference map used for non-geometry requests.

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;
const MAP_STYLE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/019d98dc-0865-7ac5-a184-a072f37b9509/style.json?key=${MAPTILER_KEY}`
  : {
      version: 8,
      sources: { esri: { type: 'raster', tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256 } },
      layers: [{ id: 'esri-bg', type: 'raster', source: 'esri' }],
    };

function bboxFromGeometry(geometry) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  function proc(coords) {
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    } else { coords.forEach(proc); }
  }
  proc(geometry.coordinates);
  return [[minLng, minLat], [maxLng, maxLat]];
}

function ParcelContextMap({ geometry }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !geometry) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [-123.05, 45.2],
      zoom: 10,
      attributionControl: false,
      interactive: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      map.addSource('parcel', { type: 'geojson', data: { type: 'Feature', geometry, properties: {} } });
      map.addLayer({ id: 'parcel-fill', type: 'fill', source: 'parcel', paint: { 'fill-color': '#4CAF50', 'fill-opacity': 0.3 } });
      map.addLayer({ id: 'parcel-line', type: 'line', source: 'parcel', paint: { 'line-color': '#4CAF50', 'line-width': 2 } });
      const bbox = bboxFromGeometry(geometry);
      if (isFinite(bbox[0][0])) map.fitBounds(bbox, { padding: 32, maxZoom: 17 });
    });
    return () => { map.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div ref={containerRef} style={{ height: 240 }} />
    </div>
  );
}

// ── AdminBatchDiffSection ────────────────────────────────────────────────────
// Split-panel: shared map on the left, scrollable ops list on the right.

function AdminBatchDiffSection({ ops }) {
  const [activeGeomIndex, setActiveGeomIndex] = useState(null); // index within geomOps
  const [showOld, setShowOld] = useState(true);
  const [showNew, setShowNew] = useState(true);

  if (!ops || ops.length === 0) {
    return <p style={{ fontSize: 13, color: '#888', fontStyle: 'italic' }}>No ops in this batch.</p>;
  }

  // Geometry ops indexed within the full ops array (geometry + add both have spatial extents)
  const geomOps = ops.reduce((acc, op, i) => {
    if (op.op === 'geometry' || op.op === 'add') acc.push({ ...op, opsIndex: i });
    return acc;
  }, []);

  const toggleBtnStyle = (active) => ({
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 5,
    border: `1px solid ${active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)'}`,
    background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
    color: active ? '#e0e0e0' : '#555',
    cursor: 'pointer',
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <SectionLabel style={{ margin: 0 }}>Batch ops ({ops.length})</SectionLabel>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button style={toggleBtnStyle(showOld)} onClick={() => setShowOld((v) => !v)}>
            <span style={{ display: 'inline-block', width: 10, height: 2, background: '#e8a020', marginRight: 5, verticalAlign: 'middle' }} />
            Old
          </button>
          <button style={toggleBtnStyle(showNew)} onClick={() => setShowNew((v) => !v)}>
            <span style={{ display: 'inline-block', width: 10, height: 2, background: '#64b5f6', marginRight: 5, verticalAlign: 'middle' }} />
            New
          </button>
          {activeGeomIndex !== null && (
            <button style={toggleBtnStyle(false)} onClick={() => setActiveGeomIndex(null)}>Show all</button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, alignItems: 'start' }}>
        {/* Left: shared map */}
        <div style={{ position: 'sticky', top: 24 }}>
          <AdminBatchMap
            ops={ops}
            activeIndex={activeGeomIndex}
            showOld={showOld}
            showNew={showNew}
            height={520}
          />
        </div>

        {/* Right: ops list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 520, overflowY: 'auto', paddingRight: 2 }}>
          {ops.map((op, i) => {
            const isGeom = op.op === 'geometry';
            const isMeta = op.op === 'metadata';
            const isAdd  = op.op === 'add';
            const isDel  = op.op === 'delete';

            // Map geometry/add ops to their index within geomOps
            const geomIdx = (isGeom || isAdd) ? geomOps.findIndex((g) => g.opsIndex === i) : -1;
            const isActiveGeom = (isGeom || isAdd) && activeGeomIndex === geomIdx;

            let acreDelta = null;
            if (isGeom && op.before_acres != null && Number(op.before_acres) > 0 && op.after_acres != null) {
              const pct = ((Number(op.after_acres) - Number(op.before_acres)) / Number(op.before_acres)) * 100;
              acreDelta = pct;
            }

            const opColor = isGeom ? '#60a5fa' : isAdd ? '#4ade80' : isDel ? '#f87171' : '#a78bfa';

            const borderColor = isDel
              ? 'rgba(239,68,68,0.30)'
              : isActiveGeom
              ? 'rgba(96,165,250,0.45)'
              : acreDelta != null && Math.abs(acreDelta) >= 5
              ? 'rgba(234,179,8,0.30)'
              : 'rgba(255,255,255,0.07)';

            return (
              <div
                key={i}
                onClick={(isGeom || isAdd) ? () => setActiveGeomIndex(isActiveGeom ? null : geomIdx) : undefined}
                style={{
                  background: isDel
                    ? 'rgba(239,68,68,0.05)'
                    : isActiveGeom ? 'rgba(96,165,250,0.06)' : 'rgba(0,0,0,0.18)',
                  borderRadius: 8,
                  border: `1px solid ${borderColor}`,
                  padding: '10px 13px',
                  cursor: (isGeom || isAdd) ? 'pointer' : 'default',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                {/* Op header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: (isMeta || isAdd) ? 8 : 6 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    color: opColor, minWidth: 52,
                  }}>{op.op}</span>
                  <span style={{ fontSize: 13, color: '#e0e0e0', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {op.parcel_name || `Parcel #${op.parcel_id}`}
                  </span>
                  {op.parcel_id && <span style={{ fontSize: 10, color: '#444' }}>#{op.parcel_id}</span>}
                  {(isGeom || isAdd) && (
                    <span style={{ fontSize: 10, color: '#666' }}>{isActiveGeom ? '◉' : '○'}</span>
                  )}
                </div>

                {/* Delete warning */}
                {isDel && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                    <span style={{ fontSize: 14 }}>⚠</span>
                    <span style={{ color: '#fca5a5' }}>This block will be permanently deleted from the database.</span>
                  </div>
                )}

                {/* Geometry: before/after acres */}
                {isGeom && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ color: '#888' }}>
                      {op.before_acres != null
                        ? <><span style={{ color: '#e8a020' }}>{Number(op.before_acres).toFixed(2)} ac</span> → </>
                        : '— → '
                      }
                      {op.after_acres != null
                        ? <span style={{ color: acreDelta != null && Math.abs(acreDelta) >= 5 ? '#eab308' : '#4ade80' }}>
                            {Number(op.after_acres).toFixed(2)} ac
                          </span>
                        : '—'
                      }
                    </span>
                    {acreDelta != null && Math.abs(acreDelta) >= 5 && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: '#eab308',
                        background: 'rgba(234,179,8,0.10)', borderRadius: 4,
                        padding: '1px 5px', border: '1px solid rgba(234,179,8,0.2)',
                      }}>
                        ⚠ {acreDelta > 0 ? '+' : ''}{Math.round(acreDelta * 10) / 10}%
                      </span>
                    )}
                    {acreDelta != null && Math.abs(acreDelta) < 5 && (
                      <span style={{ fontSize: 10, color: '#555' }}>
                        ({acreDelta > 0 ? '+' : ''}{Math.round(acreDelta * 10) / 10}%)
                      </span>
                    )}
                  </div>
                )}

                {/* Add: show new acreage estimate + key fields */}
                {isAdd && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {op.after_acres != null && (
                      <div style={{ fontSize: 12, color: '#4ade80' }}>
                        New area: {Number(op.after_acres).toFixed(2)} ac
                      </div>
                    )}
                    {op.fields && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {['vineyard_name', 'ava_name', 'nested_ava', 'varietals_list', 'source_dataset'].map((key) => {
                          const val = op.fields[key];
                          if (!val) return null;
                          return (
                            <div key={key} style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'baseline' }}>
                              <span style={{ color: '#64748b', minWidth: 100, textTransform: 'uppercase', fontSize: 9, fontWeight: 600, flexShrink: 0 }}>
                                {key.replace(/_/g, ' ')}
                              </span>
                              <span style={{ color: '#4ade80' }}>{String(val)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Metadata: inline field diffs */}
                {isMeta && op.fields && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {Object.entries(op.fields).map(([key, val]) => {
                      const oldVal = op.before?.[key];
                      if (String(oldVal ?? '') === String(val ?? '') && oldVal == null && val == null) return null;
                      if (String(oldVal ?? '') === String(val ?? '')) return null;
                      return (
                        <div key={key} style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'baseline', padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <span style={{ color: '#64748b', minWidth: 100, textTransform: 'uppercase', fontSize: 9, fontWeight: 600, flexShrink: 0 }}>{key.replace(/_/g, ' ')}</span>
                          <span style={{ color: '#e57373', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{String(oldVal ?? '—')}</span>
                          <span style={{ color: '#475569' }}>→</span>
                          <span style={{ color: '#4ade80', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{String(val ?? '—')}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── PayloadSection ──────────────────────────────────────────────────────────

function PayloadSection({ requestType, payload }) {
  if (requestType === 'admin_batch_edit') {
    return <AdminBatchDiffSection ops={payload.ops || []} />;
  }

  if (requestType === 'geometry_update') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {payload.notes && (
          <div style={infoBox}>
            <SectionLabel>Owner's note</SectionLabel>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{payload.notes}</p>
          </div>
        )}

        {(payload.old_geometry || payload.new_geometry) ? (
          <>
            <SectionLabel>Boundary comparison — amber = current, blue dashed = proposed</SectionLabel>
            <AdminGeometryDiffMap
              oldGeometry={payload.old_geometry || null}
              newGeometry={payload.new_geometry || null}
              height={420}
            />
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {payload.old_geometry && <GeoJsonDownload label="Current geometry" geometry={payload.old_geometry} />}
              {payload.new_geometry && <GeoJsonDownload label="Proposed geometry" geometry={payload.new_geometry} />}
            </div>
          </>
        ) : (
          <p style={{ fontSize: 13, color: '#888', fontStyle: 'italic' }}>No geometry data attached to this request.</p>
        )}
      </div>
    );
  }

  if (requestType === 'vineyard_blocks') {
    return <BlocksDiffSection payload={payload} />;
  }

  // Generic fallback
  return (
    <>
      <SectionLabel>Payload</SectionLabel>
      <pre style={{
        fontSize: 12, color: '#aaa', whiteSpace: 'pre-wrap',
        background: 'rgba(0,0,0,0.25)', padding: '14px 16px', borderRadius: 8,
        overflow: 'auto', maxHeight: 'none', border: '1px solid rgba(255,255,255,0.06)',
        lineHeight: 1.6,
      }}>
        {JSON.stringify(payload, null, 2)}
      </pre>
    </>
  );
}

// ── BlocksDiffSection ───────────────────────────────────────────────────────

function BlocksDiffSection({ payload }) {
  const changes = payload.block_changes || [];
  const newBlocks = payload.new_blocks || [];

  if (changes.length === 0 && newBlocks.length === 0) {
    return <p style={{ fontSize: 13, color: '#888', fontStyle: 'italic' }}>No block data in this request.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {changes.length > 0 && (
        <div>
          <SectionLabel>Changes to existing blocks ({changes.length})</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {changes.map((c) => {
              const fieldChanges = c.field_changes
                ? c.field_changes
                : BLOCK_FIELDS
                    .filter((f) => f in c && f !== 'id')
                    .map((f) => ({ field: f, label: f, old: null, new: c[f] }));

              return (
                <div key={c.id} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#ddd' }}>
                      {c.block_name ? `Block "${c.block_name}"` : `Block #${c.id}`}
                    </span>
                    <span style={{ fontSize: 11, color: '#666', marginLeft: 8 }}>{fieldChanges.length} field{fieldChanges.length !== 1 ? 's' : ''} changed</span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'rgba(0,0,0,0.15)' }}>
                        <th style={{ ...thStyle, width: '30%' }}>Field</th>
                        <th style={{ ...thStyle, color: '#e8a020', width: '35%' }}>Before</th>
                        <th style={{ ...thStyle, color: '#64b5f6', width: '35%' }}>After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fieldChanges.map((fc) => (
                        <tr key={fc.field} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ ...tdStyle, color: '#888', fontWeight: 500 }}>{fc.label || fc.field}</td>
                          <td style={{ ...tdStyle, color: '#e8a020' }}>
                            {fc.old != null ? fc.old : <em style={{ color: '#444' }}>—</em>}
                          </td>
                          <td style={{ ...tdStyle, color: '#64b5f6', fontWeight: 600 }}>
                            {fc.new != null ? fc.new : <em style={{ color: '#444' }}>—</em>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {newBlocks.length > 0 && (
        <div>
          <SectionLabel>New blocks to add ({newBlocks.length})</SectionLabel>
          <div style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'rgba(0,0,0,0.25)' }}>
                    {BLOCK_FIELDS.filter((f) => newBlocks.some((b) => b[f] != null)).map((f) => (
                      <th key={f} style={{ ...thStyle, color: '#64b5f6' }}>{f}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {newBlocks.map((b, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      {BLOCK_FIELDS.filter((f) => newBlocks.some((nb) => nb[f] != null)).map((f) => (
                        <td key={f} style={tdStyle}>
                          {b[f] != null ? b[f] : <em style={{ color: '#444' }}>—</em>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── GeoJsonDownload ─────────────────────────────────────────────────────────

function GeoJsonDownload({ label, geometry }) {
  function download() {
    const blob = new Blob([JSON.stringify({ type: 'Feature', geometry, properties: {} }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label.toLowerCase().replace(/\s+/g, '-')}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button onClick={download} style={{ ...outlineBtn, fontSize: 11 }}>
      ↓ {label}
    </button>
  );
}

// ── Shared sub-components & styles ──────────────────────────────────────────

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#1a1a2e', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 20px' }}>
        {children}
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, fontWeight: 600 }}>
      {children}
    </div>
  );
}

function StatusBadge({ status }) {
  const colors = {
    pending: { bg: 'rgba(255,193,7,0.15)', color: '#FFD54F' },
    approved: { bg: 'rgba(76,175,80,0.15)', color: '#81C784' },
    rejected: { bg: 'rgba(244,67,54,0.15)', color: '#EF9A9A' },
  };
  const c = colors[status] || colors.pending;
  return (
    <span style={{
      padding: '4px 14px', borderRadius: 12, fontSize: 12, fontWeight: 600,
      background: c.bg, color: c.color, textTransform: 'capitalize', whiteSpace: 'nowrap',
    }}>
      {status}
    </span>
  );
}

const infoBox = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 8, padding: '12px 14px',
};

const thStyle = {
  textAlign: 'left', padding: '8px 14px',
  color: '#777', fontWeight: 600,
  borderBottom: '1px solid rgba(255,255,255,0.07)',
};

const tdStyle = {
  padding: '8px 14px', color: '#ccc', verticalAlign: 'top',
};

const outlineBtn = {
  background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6, padding: '7px 16px', fontSize: 12,
  color: '#aaa', cursor: 'pointer', fontFamily: 'inherit',
};

const approveBtnStyle = {
  padding: '8px 20px', borderRadius: 6, border: 'none',
  background: '#2e7d32', color: '#fff', fontSize: 13,
  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};

const rejectBtnStyle = {
  padding: '8px 20px', borderRadius: 6, border: 'none',
  background: '#c62828', color: '#fff', fontSize: 13,
  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
