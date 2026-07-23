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
import { alpha, TOKENS, TYPE } from '../../styles/tokens';
import { apiJson, apiPost } from '../../lib/api';
import AdminGeometryDiffMap from './AdminGeometryDiffMap';
import AdminBatchMap from './AdminBatchMap';

const REQUEST_TYPE_LABELS = {
  profile:            'Winery Profile',
  vineyard_varietals: 'Varietals Update',
  vineyard_blocks:    'Block Info Update',
  vineyard_blocks_bulk: 'Block CSV Bulk Import',
  vineyard_claim:     'Vineyard Claim',
  vineyard_new:       'New Vineyard',
  geometry_update:    'Boundary Edit',
  admin_batch_edit:   'Admin Batch Edit',
};

const REVIEW_VERBS = {
  approved: 'Approved',
  rejected: 'Rejected',
  auto_applied: 'Auto-applied',
  reverted: 'Reverted',
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
  const [revertNotes, setRevertNotes] = useState('');
  const [showRevertBox, setShowRevertBox] = useState(false);
  // For admin_batch_edit: tracks admin-edited ops (null = use server payload as-is)
  const [editedOps, setEditedOps] = useState(null);

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
      const body = {};
      if (action === 'reject') body.admin_notes = rejectNotes || undefined;
      if (action === 'revert') body.admin_notes = revertNotes || undefined;
      if (action === 'approve' && editedOps !== null) body.ops_override = editedOps;
      await apiPost(`/api/admin/requests/${id}/${action}`, body);
      setActionStatus('done');
      await load();
      setShowRejectBox(false);
      setRejectNotes('');
      setShowRevertBox(false);
      setRevertNotes('');
    } catch {
      setActionStatus('error');
    }
  }

  if (loading) {
    return (
      <Shell>
        <p style={{ color: TOKENS.muted }}>Loading request…</p>
      </Shell>
    );
  }

  if (!request) return null;

  const payload = request.payload || {};
  const isPending = request.status === 'pending';
  const isAutoApplied = request.status === 'auto_applied';
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
        style={{ ...TYPE.body, color: TOKENS.electricBlue, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 20 }}
      >
        ← Back to Dashboard
      </Link>

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ ...TYPE.displayItalic, fontStyle: 'normal', color: TOKENS.parchment, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {REQUEST_TYPE_LABELS[request.request_type] || request.request_type.replace(/_/g, ' ')}
            <span style={{ ...TYPE.mono, fontWeight: 400, color: alpha(TOKENS.parchment, 0.35) }}>#{request.id}</span>
            {request.origin === 'admin' && (
              <span style={{ ...TYPE.uiLabel, fontWeight: 700, color: TOKENS.violet, background: alpha(TOKENS.violet, 0.12), borderRadius: 4, padding: '2px 7px' }}>ADMIN</span>
            )}
            {request.flag === 'acreage_change' && (
              <span style={{ ...TYPE.uiLabel, fontWeight: 700, color: TOKENS.warning, background: alpha(TOKENS.warning, 0.12), border: `1px solid ${alpha(TOKENS.warning, 0.25)}`, borderRadius: 4, padding: '2px 7px' }}>
                ⚠ Acreage Δ{request.flag_detail?.pct_change != null ? ` ${request.flag_detail.pct_change > 0 ? '+' : ''}${request.flag_detail.pct_change}%` : ''}
              </span>
            )}
          </h1>
          <p style={{ ...TYPE.mono, margin: 0, color: alpha(TOKENS.parchment, 0.7) }}>
            <strong style={{ color: alpha(TOKENS.parchment, 0.82) }}>{request.winery_name || 'Independent vineyard'}</strong>
            {request.contact_email ? ` · ${request.contact_email}` : request.submitted_by_admin_name ? ` · by admin: ${request.submitted_by_admin_name}` : ''}
            {parcel && (
              <span style={{ color: TOKENS.muted }}>
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
      <div style={{ ...TYPE.uiLabel, color: alpha(TOKENS.parchment, 0.3), marginBottom: 20, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span>Submitted {new Date(request.created_at).toLocaleString()}</span>
        {request.reviewed_at && (
          <span>
            {REVIEW_VERBS[request.status] || 'Reviewed'}{' '}
            {new Date(request.reviewed_at).toLocaleString()}
            {request.reviewed_by_name && ` by ${request.reviewed_by_name}`}
          </span>
        )}
      </div>

      {/* Auto-applied notice */}
      {isAutoApplied && (
        <div style={{ ...infoBox, borderColor: alpha(TOKENS.electricBlue, 0.3), background: alpha(TOKENS.electricBlue, 0.06), marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 'var(--type-mono-size)', color: alpha(TOKENS.parchment, 0.82), lineHeight: 1.5 }}>
            ⚡ <strong>Applied immediately</strong> by the winery — no approval was required. Review the change below; if it looks wrong, reach out to the winery or use <strong>Revert</strong> to restore the previous values.
          </p>
        </div>
      )}

      {/* Admin notes (if already reviewed) */}
      {request.admin_notes && (
        <div style={{ ...infoBox, borderColor: alpha(TOKENS.warning, 0.2), marginBottom: 20 }}>
          <SectionLabel>Admin note</SectionLabel>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--type-mono-size)', color: alpha(TOKENS.parchment, 0.82), lineHeight: 1.5 }}>{request.admin_notes}</p>
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
          <PayloadSection
            requestType={request.request_type}
            payload={effectivePayload}
            isPending={isPending}
            onOpsChange={setEditedOps}
          />
        </div>

        {/* Right: parcel context map (always shown when geometry exists) */}
        {parcel?.geometry && !isGeometryUpdate && (
          <div style={{ position: 'sticky', top: 20 }}>
            <SectionLabel>Parcel location</SectionLabel>
            <ParcelContextMap geometry={parcel.geometry} />
            <div style={{ fontSize: 'var(--type-ui-label-size)', color: alpha(TOKENS.parchment, 0.3), marginTop: 6 }}>
              {parcel.vineyard_name && <div style={{ color: TOKENS.muted }}>{parcel.vineyard_name}</div>}
              {parcel.ava_name && <div>{parcel.ava_name}</div>}
              {parcel.acres && <div>{Number(parcel.acres).toFixed(1)} acres</div>}
            </div>
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      {isPending && (
        <div style={{ marginTop: 28, borderTop: `1px solid ${alpha(TOKENS.parchment, 0.07)}`, paddingTop: 20 }}>
          {actionStatus === 'error' && (
            <p style={{ fontSize: 'var(--type-body-size)', color: TOKENS.danger, marginBottom: 12 }}>Action failed — please try again.</p>
          )}

          {/* Edited ops summary */}
          {editedOps !== null && request.request_type === 'admin_batch_edit' && (
            <div style={{
              fontSize: 'var(--type-body-size)', color: TOKENS.warning, background: alpha(TOKENS.warning, 0.08),
              border: `1px solid ${alpha(TOKENS.warning, 0.2)}`, borderRadius: 6,
              padding: '7px 12px', marginBottom: 12,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>✎ Approving {editedOps.length} of {(request.payload?.ops || []).length} ops (edited)</span>
              <button
                onClick={() => setEditedOps(null)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: TOKENS.warning, cursor: 'pointer', fontSize: 'var(--type-ui-label-size)', textDecoration: 'underline' }}
              >
                Reset to original
              </button>
            </div>
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
              <label style={{ ...TYPE.uiLabel, color: TOKENS.muted }}>Rejection reason (optional)</label>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={3}
                placeholder="Explain why this request is being rejected…"
                style={{
                  padding: '8px 10px', borderRadius: 6, fontSize: 'var(--type-mono-size)', color: TOKENS.parchment,
                  background: alpha(TOKENS.parchment, 0.05), border: `1px solid ${alpha(TOKENS.parchment, 0.10)}`,
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

      {/* ── Revert action (auto-applied changes) ── */}
      {isAutoApplied && (
        <div style={{ marginTop: 28, borderTop: `1px solid ${alpha(TOKENS.parchment, 0.07)}`, paddingTop: 20 }}>
          {actionStatus === 'error' && (
            <p style={{ fontSize: 'var(--type-body-size)', color: TOKENS.danger, marginBottom: 12 }}>Action failed — please try again.</p>
          )}
          {!showRevertBox ? (
            <button onClick={() => setShowRevertBox(true)} disabled={actionStatus === 'working'} style={rejectBtnStyle}>
              ↩ Revert this change
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
              <label style={{ ...TYPE.uiLabel, color: TOKENS.muted }}>Revert reason (optional — restores the previous values)</label>
              <textarea
                value={revertNotes}
                onChange={(e) => setRevertNotes(e.target.value)}
                rows={3}
                placeholder="Why is this being reverted? (e.g. incorrect data)"
                style={{
                  padding: '8px 10px', borderRadius: 6, fontSize: 'var(--type-mono-size)', color: TOKENS.parchment,
                  background: alpha(TOKENS.parchment, 0.05), border: `1px solid ${alpha(TOKENS.parchment, 0.10)}`,
                  resize: 'vertical', outline: 'none', fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleAction('revert')} disabled={actionStatus === 'working'} style={rejectBtnStyle}>
                  {actionStatus === 'working' ? 'Working…' : 'Confirm Revert'}
                </button>
                <button onClick={() => setShowRevertBox(false)} style={outlineBtn}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {actionStatus === 'done' && (
        <p style={{ fontSize: 'var(--type-body-size)', color: TOKENS.success, marginTop: 12 }}>Action applied successfully.</p>
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
// audit-ignore-start admin-request-detail-legacy-palette

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
  const titleStyle = { ...TYPE.uiLabel, fontWeight: 600, color: '#ccc' };
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
          <div style={{ fontSize: 'var(--type-ui-label-size)', color: '#888', marginBottom: 4 }}>
            {fmtDate(first.created_at)} · <span style={{ color: '#aaa' }}>{typeLabel(first.request_type)}</span>
            {first.changed_by_email && <span> · {first.changed_by_email}</span>}
          </div>
          {rows.map((row, ri) => (
            <div key={ri} style={{ fontSize: 'var(--type-body-size)', color: '#bbb', paddingLeft: 8, marginTop: 2 }}>
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
        <span style={{ fontSize: 'var(--type-ui-label-size)', color: '#666' }}>{chevron}</span>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          {loading && <p style={{ fontSize: 'var(--type-body-size)', color: '#888' }}>Loading…</p>}
          {data?.error && <p style={{ fontSize: 'var(--type-body-size)', color: '#e57373' }}>{data.error}</p>}

          {data && !data.error && (
            <>
              {/* Pending / rejected requests */}
              {data.pending && data.pending.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <p style={{ ...TYPE.uiLabel, color: '#888', marginBottom: 8 }}>Open Requests</p>
                  {data.pending.map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 'var(--type-body-size)' }}>
                      <span style={{ color: statusColor(r.status), fontWeight: 600, minWidth: 64 }}>{r.status}</span>
                      <span style={{ color: '#aaa' }}>{typeLabel(r.request_type)}</span>
                      <span style={{ color: '#666' }}>{fmtDate(r.created_at)}</span>
                      {r.id !== currentRequestId && (
                        <Link to={`/admin/requests/${r.id}`} style={{ color: '#90caf9', fontSize: 'var(--type-ui-label-size)', marginLeft: 'auto' }}>View →</Link>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Applied log */}
              {data.log && data.log.length > 0
                ? renderLogEntries(data.log)
                : <p style={{ fontSize: 'var(--type-body-size)', color: '#666', fontStyle: 'italic' }}>No applied changes recorded yet.</p>}
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
// Split-panel: shared map on the left, editable ops list on the right.
// When isPending, each op shows edit/exclude controls.
// onOpsChange(ops) is called whenever the admin modifies or excludes ops.

const EDITABLE_META_FIELDS = [
  'vineyard_name', 'vineyard_org', 'owner_name', 'source_dataset',
  'ava_name', 'nested_ava', 'nested_nested_ava',
  'acres', 'varietals_list', 'winery_id',
  'situs_address', 'situs_city', 'situs_zip',
];

function AdminBatchDiffSection({ ops, isPending, onOpsChange }) {
  const [activeGeomIndex, setActiveGeomIndex] = useState(null);
  const [showOld, setShowOld] = useState(true);
  const [showNew, setShowNew] = useState(true);

  // Local editable state: array of { ...op, _excluded: bool, _editedFields: {} }
  const [localOps, setLocalOps] = useState(() =>
    ops.map((op) => ({ ...op, _excluded: false, _editedFields: {} }))
  );
  const [expandedEdit, setExpandedEdit] = useState(null); // index of op with open edit panel

  // Sync local state when ops prop changes (e.g. on re-load)
  useEffect(() => {
    setLocalOps(ops.map((op) => ({ ...op, _excluded: false, _editedFields: {} })));
    setExpandedEdit(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(ops)]);

  // Notify parent whenever local ops change (if pending)
  useEffect(() => {
    if (!isPending) return;
    const hasAnyEdit = localOps.some((o) => o._excluded || Object.keys(o._editedFields).length > 0);
    if (!hasAnyEdit) {
      onOpsChange(null); // null = use original payload
      return;
    }
    // Build cleaned ops for submission
    const cleaned = localOps
      .filter((o) => !o._excluded)
      .map(({ _excluded, _editedFields, ...op }) => {
        if (Object.keys(_editedFields).length === 0) return op;
        if (op.op === 'metadata') {
          return { ...op, fields: { ...(op.fields || {}), ..._editedFields } };
        }
        if (op.op === 'add') {
          return { ...op, fields: { ...(op.fields || {}), ..._editedFields } };
        }
        return op;
      });
    onOpsChange(cleaned);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localOps, isPending]);

  function toggleExclude(i) {
    setLocalOps((prev) => prev.map((o, j) => j === i ? { ...o, _excluded: !o._excluded } : o));
    setExpandedEdit((e) => e === i ? null : e);
  }

  function setEditField(i, field, value) {
    setLocalOps((prev) => prev.map((o, j) =>
      j === i ? { ...o, _editedFields: { ...o._editedFields, [field]: value === '' ? null : value } } : o
    ));
  }

  function resetOp(i) {
    setLocalOps((prev) => prev.map((o, j) => j === i ? { ...o, _excluded: false, _editedFields: {} } : o));
  }

  if (!ops || ops.length === 0) {
    return <p style={{ fontSize: 'var(--type-mono-size)', color: '#888', fontStyle: 'italic' }}>No ops in this batch.</p>;
  }

  // Geometry ops indexed within the full ops array (geometry + add both have spatial extents)
  const geomOps = localOps.reduce((acc, op, i) => {
    if ((op.op === 'geometry' || op.op === 'add') && !op._excluded) acc.push({ ...op, opsIndex: i });
    return acc;
  }, []);

  const toggleBtnStyle = (active) => ({
    fontSize: 'var(--type-ui-label-size)', fontWeight: 600, padding: '4px 10px', borderRadius: 5,
    border: `1px solid ${active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)'}`,
    background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
    color: active ? '#e0e0e0' : '#555', cursor: 'pointer',
  });

  const includedCount = localOps.filter((o) => !o._excluded).length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <SectionLabel style={{ margin: 0 }}>
          Batch ops ({includedCount}/{localOps.length} included)
        </SectionLabel>
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16, alignItems: 'start' }}>
        {/* Left: shared map */}
        <div style={{ position: 'sticky', top: 24 }}>
          <AdminBatchMap
            ops={localOps.filter((o) => !o._excluded)}
            activeIndex={activeGeomIndex}
            showOld={showOld}
            showNew={showNew}
            height={520}
          />
        </div>

        {/* Right: ops list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 520, overflowY: 'auto', paddingRight: 2 }}>
          {localOps.map((op, i) => {
            const isGeom = op.op === 'geometry';
            const isMeta = op.op === 'metadata';
            const isAdd  = op.op === 'add';
            const isDel  = op.op === 'delete';
            const isExcluded = op._excluded;
            const hasEdits = Object.keys(op._editedFields).length > 0;
            const isEditOpen = expandedEdit === i;
            const canEdit = isPending && (isMeta || isAdd);

            const geomIdx = (isGeom || isAdd) ? geomOps.findIndex((g) => g.opsIndex === i) : -1;
            const isActiveGeom = (isGeom || isAdd) && activeGeomIndex === geomIdx && !isExcluded;

            let acreDelta = null;
            if (isGeom && op.before_acres != null && Number(op.before_acres) > 0 && op.after_acres != null) {
              const pct = ((Number(op.after_acres) - Number(op.before_acres)) / Number(op.before_acres)) * 100;
              acreDelta = pct;
            }

            const opColor = isGeom ? '#60a5fa' : isAdd ? '#4ade80' : isDel ? '#f87171' : '#a78bfa';

            const borderColor = isExcluded
              ? 'rgba(255,255,255,0.05)'
              : isDel ? 'rgba(239,68,68,0.30)'
              : isActiveGeom ? 'rgba(96,165,250,0.45)'
              : acreDelta != null && Math.abs(acreDelta) >= 5 ? 'rgba(234,179,8,0.30)'
              : hasEdits ? 'rgba(251,191,36,0.30)'
              : 'rgba(255,255,255,0.07)';

            // Merged display fields (original + admin edits)
            const displayFields = isMeta || isAdd
              ? { ...(op.fields || {}), ...op._editedFields }
              : {};

            return (
              <div key={i} style={{ opacity: isExcluded ? 0.38 : 1, transition: 'opacity 0.15s' }}>
                <div
                  style={{
                    background: isExcluded ? 'rgba(0,0,0,0.10)'
                      : isDel ? 'rgba(239,68,68,0.05)'
                      : isActiveGeom ? 'rgba(96,165,250,0.06)' : 'rgba(0,0,0,0.18)',
                    borderRadius: isEditOpen ? '8px 8px 0 0' : 8,
                    border: `1px solid ${borderColor}`,
                    padding: '10px 13px',
                    cursor: (isGeom || isAdd) && !isExcluded ? 'pointer' : 'default',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                  onClick={(isGeom || isAdd) && !isExcluded ? () => setActiveGeomIndex(isActiveGeom ? null : geomIdx) : undefined}
                >
                  {/* Op header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: (isMeta || isAdd) ? 8 : 6 }}>
                    <span style={{ ...TYPE.uiLabel, color: isExcluded ? '#444' : opColor, minWidth: 52 }}>
                      {op.op}
                    </span>
                    <span style={{ fontSize: 'var(--type-mono-size)', color: isExcluded ? '#555' : '#e0e0e0', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isExcluded ? <s>{op.parcel_name || `Parcel #${op.parcel_id}`}</s> : (op.parcel_name || `Parcel #${op.parcel_id}`)}
                    </span>
                    {op.parcel_id && <span style={{ fontSize: 'var(--type-ui-label-size)', color: '#444' }}>#{op.parcel_id}</span>}
                    {hasEdits && !isExcluded && (
                      <span style={{ fontSize: 'var(--type-ui-label-size)', fontWeight: 700, color: '#fbbf24', background: 'rgba(251,191,36,0.10)', borderRadius: 3, padding: '1px 5px' }}>EDITED</span>
                    )}
                    {(isGeom || isAdd) && !isExcluded && (
                      <span style={{ fontSize: 'var(--type-ui-label-size)', color: '#666' }}>{isActiveGeom ? '◉' : '○'}</span>
                    )}

                    {/* Action buttons — stop propagation so they don't trigger map focus */}
                    {isPending && (
                      <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                        {canEdit && !isExcluded && (
                          <button
                            onClick={() => setExpandedEdit(isEditOpen ? null : i)}
                            title="Edit fields"
                            style={{
                              background: isEditOpen ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.05)',
                              border: `1px solid ${isEditOpen ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.10)'}`,
                              borderRadius: 4, color: isEditOpen ? '#fbbf24' : '#666',
                              cursor: 'pointer', fontSize: 'var(--type-ui-label-size)', padding: '2px 6px',
                            }}
                          >✎</button>
                        )}
                        {hasEdits && !isExcluded && (
                          <button
                            onClick={() => resetOp(i)}
                            title="Reset to original"
                            style={{
                              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)',
                              borderRadius: 4, color: '#666', cursor: 'pointer', fontSize: 'var(--type-ui-label-size)', padding: '2px 6px',
                            }}
                          >↺</button>
                        )}
                        <button
                          onClick={() => toggleExclude(i)}
                          title={isExcluded ? 'Include this op' : 'Exclude this op'}
                          style={{
                            background: isExcluded ? 'rgba(74,222,128,0.10)' : 'rgba(239,68,68,0.08)',
                            border: `1px solid ${isExcluded ? 'rgba(74,222,128,0.25)' : 'rgba(239,68,68,0.25)'}`,
                            borderRadius: 4, color: isExcluded ? '#4ade80' : '#f87171',
                            cursor: 'pointer', fontSize: 'var(--type-ui-label-size)', padding: '2px 6px',
                          }}
                        >{isExcluded ? '+ Include' : '✕ Skip'}</button>
                      </div>
                    )}
                  </div>

                  {/* Delete warning */}
                  {isDel && !isExcluded && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 'var(--type-body-size)' }}>
                      <span style={{ fontSize: 'var(--type-body-size)' }}>⚠</span>
                      <span style={{ color: '#fca5a5' }}>This block will be permanently deleted from the database.</span>
                    </div>
                  )}

                  {/* Geometry: before/after acres */}
                  {isGeom && !isExcluded && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--type-body-size)' }}>
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
                        <span style={{ fontSize: 'var(--type-ui-label-size)', fontWeight: 700, color: '#eab308', background: 'rgba(234,179,8,0.10)', borderRadius: 4, padding: '1px 5px', border: '1px solid rgba(234,179,8,0.2)' }}>
                          ⚠ {acreDelta > 0 ? '+' : ''}{Math.round(acreDelta * 10) / 10}%
                        </span>
                      )}
                      {acreDelta != null && Math.abs(acreDelta) < 5 && (
                        <span style={{ fontSize: 'var(--type-ui-label-size)', color: '#555' }}>({acreDelta > 0 ? '+' : ''}{Math.round(acreDelta * 10) / 10}%)</span>
                      )}
                    </div>
                  )}

                  {/* Add: show acreage + key fields (merged with edits) */}
                  {isAdd && !isExcluded && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {op.after_acres != null && (
                        <div style={{ fontSize: 'var(--type-body-size)', color: '#4ade80' }}>New area: {Number(op.after_acres).toFixed(2)} ac</div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {['vineyard_name', 'ava_name', 'nested_ava', 'varietals_list', 'source_dataset'].map((key) => {
                          const val = displayFields[key];
                          if (!val) return null;
                          const isEdited = key in op._editedFields;
                          return (
                            <div key={key} style={{ fontSize: 'var(--type-ui-label-size)', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                              <span style={{ ...TYPE.uiLabel, color: '#64748b', minWidth: 100, fontWeight: 600, flexShrink: 0 }}>
                                {key.replace(/_/g, ' ')}
                              </span>
                              <span style={{ color: isEdited ? '#fbbf24' : '#4ade80' }}>{String(val)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Metadata: inline field diffs (merged with edits) */}
                  {isMeta && !isExcluded && op.fields && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {Object.entries({ ...(op.fields || {}), ...op._editedFields }).map(([key, val]) => {
                        const oldVal = op.before?.[key];
                        const isEdited = key in op._editedFields;
                        const effectiveNew = isEdited ? op._editedFields[key] : val;
                        if (String(oldVal ?? '') === String(effectiveNew ?? '') && oldVal == null && effectiveNew == null) return null;
                        if (String(oldVal ?? '') === String(effectiveNew ?? '')) return null;
                        return (
                          <div key={key} style={{ fontSize: 'var(--type-ui-label-size)', display: 'flex', gap: 6, alignItems: 'baseline', padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <span style={{ ...TYPE.uiLabel, color: '#64748b', minWidth: 100, fontWeight: 600, flexShrink: 0 }}>{key.replace(/_/g, ' ')}</span>
                            <span style={{ color: '#e57373', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{String(oldVal ?? '—')}</span>
                            <span style={{ color: '#475569' }}>→</span>
                            <span style={{ color: isEdited ? '#fbbf24' : '#4ade80', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{String(effectiveNew ?? '—')}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Inline edit panel */}
                {isEditOpen && canEdit && !isExcluded && (
                  <div style={{
                    background: 'rgba(0,0,0,0.35)', border: `1px solid ${borderColor}`, borderTop: 'none',
                    borderRadius: '0 0 8px 8px', padding: '12px 14px',
                    display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    <div style={{ ...TYPE.uiLabel, color: '#fbbf24', marginBottom: 2 }}>
                      Edit fields — overrides staged values
                    </div>
                    {EDITABLE_META_FIELDS.map((field) => {
                      const original = (op.fields || {})[field];
                      const edited = op._editedFields[field];
                      const current = edited !== undefined ? edited : original;
                      const isEdited = edited !== undefined;
                      return (
                        <div key={field} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <label style={{ ...TYPE.uiLabel, color: isEdited ? '#fbbf24' : '#555', display: 'flex', gap: 6 }}>
                            {field.replace(/_/g, ' ')}
                            {isEdited && <span style={{ color: '#fbbf24' }}>• edited</span>}
                          </label>
                          <input
                            type={field === 'acres' || field === 'winery_id' ? 'number' : 'text'}
                            value={current ?? ''}
                            onChange={(e) => setEditField(i, field, e.target.value)}
                            placeholder={original != null ? String(original) : '—'}
                            style={{
                              background: isEdited ? 'rgba(251,191,36,0.06)' : 'rgba(255,255,255,0.04)',
                              border: `1px solid ${isEdited ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.10)'}`,
                              borderRadius: 4, color: isEdited ? '#fbbf24' : '#ccc',
                              fontSize: 'var(--type-body-size)', padding: '5px 8px', outline: 'none',
                              width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
                            }}
                          />
                        </div>
                      );
                    })}
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <button
                        onClick={() => setExpandedEdit(null)}
                        style={{ ...outlineBtn, fontSize: 'var(--type-ui-label-size)', padding: '5px 12px', color: '#94a3b8' }}
                      >
                        Done
                      </button>
                      {hasEdits && (
                        <button
                          onClick={() => resetOp(i)}
                          style={{ ...outlineBtn, fontSize: 'var(--type-ui-label-size)', padding: '5px 12px', color: '#f87171', borderColor: 'rgba(239,68,68,0.25)' }}
                        >
                          Reset
                        </button>
                      )}
                    </div>
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

function PayloadSection({ requestType, payload, isPending, onOpsChange }) {
  if (requestType === 'admin_batch_edit') {
    return <AdminBatchDiffSection ops={payload.ops || []} isPending={isPending} onOpsChange={onOpsChange} />;
  }

  if (requestType === 'geometry_update') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {payload.notes && (
          <div style={infoBox}>
            <SectionLabel>Owner's note</SectionLabel>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--type-mono-size)', color: '#ccc', lineHeight: 1.5 }}>{payload.notes}</p>
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
          <p style={{ fontSize: 'var(--type-mono-size)', color: '#888', fontStyle: 'italic' }}>No geometry data attached to this request.</p>
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
        fontSize: 'var(--type-body-size)', color: '#aaa', whiteSpace: 'pre-wrap',
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
    return <p style={{ fontSize: 'var(--type-mono-size)', color: '#888', fontStyle: 'italic' }}>No block data in this request.</p>;
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
                    <span style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: '#ddd' }}>
                      {c.block_name ? `Block "${c.block_name}"` : `Block #${c.id}`}
                    </span>
                    <span style={{ fontSize: 'var(--type-ui-label-size)', color: '#666', marginLeft: 8 }}>{fieldChanges.length} field{fieldChanges.length !== 1 ? 's' : ''} changed</span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--type-body-size)' }}>
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
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--type-body-size)' }}>
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
    <button onClick={download} style={{ ...outlineBtn, fontSize: 'var(--type-ui-label-size)' }}>
      ↓ {label}
    </button>
  );
}
// audit-ignore-end

// ── Shared sub-components & styles ──────────────────────────────────────────

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: TOKENS.ink, fontFamily: 'var(--font-sans)' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 20px' }}>
        {children}
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ ...TYPE.uiLabel, color: alpha(TOKENS.parchment, 0.35), marginBottom: 8, fontWeight: 600 }}>
      {children}
    </div>
  );
}

function StatusBadge({ status }) {
  const colors = {
    pending: { bg: alpha(TOKENS.warning, 0.15), color: TOKENS.warning },
    approved: { bg: alpha(TOKENS.success, 0.15), color: TOKENS.success },
    rejected: { bg: alpha(TOKENS.danger, 0.15), color: TOKENS.danger },
    auto_applied: { bg: alpha(TOKENS.electricBlue, 0.15), color: TOKENS.electricBlue },
    reverted: { bg: alpha(TOKENS.muted, 0.18), color: TOKENS.muted },
  };
  const c = colors[status] || colors.pending;
  return (
    <span style={{
      padding: '4px 14px', borderRadius: 12, fontSize: 'var(--type-body-size)', fontWeight: 600,
      background: c.bg, color: c.color, textTransform: 'capitalize', whiteSpace: 'nowrap',
    }}>
      {status === 'auto_applied' ? 'auto-applied' : status}
    </span>
  );
}

const infoBox = {
  background: alpha(TOKENS.parchment, 0.04), border: `1px solid ${alpha(TOKENS.parchment, 0.07)}`,
  borderRadius: 8, padding: '12px 14px',
};

const thStyle = {
  textAlign: 'left', padding: '8px 14px',
  color: alpha(TOKENS.parchment, 0.45), fontWeight: 600,
  borderBottom: `1px solid ${alpha(TOKENS.parchment, 0.07)}`,
};

const tdStyle = {
  padding: '8px 14px', color: alpha(TOKENS.parchment, 0.82), verticalAlign: 'top',
};

const outlineBtn = {
  background: 'transparent', border: `1px solid ${alpha(TOKENS.parchment, 0.12)}`,
  borderRadius: 6, padding: '7px 16px', fontSize: 'var(--type-body-size)',
  color: alpha(TOKENS.parchment, 0.7), cursor: 'pointer', fontFamily: 'inherit',
};

const approveBtnStyle = {
  padding: '8px 20px', borderRadius: 6, border: 'none',
  background: TOKENS.success, color: TOKENS.ink, fontSize: 'var(--type-mono-size)',
  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};

const rejectBtnStyle = {
  padding: '8px 20px', borderRadius: 6, border: 'none',
  background: TOKENS.danger, color: TOKENS.ink, fontSize: 'var(--type-mono-size)',
  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
