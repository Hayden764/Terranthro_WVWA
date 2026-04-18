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
import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiJson, apiPost } from '../../lib/api';
import AdminGeometryDiffMap from './AdminGeometryDiffMap';

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, color: '#e0e0e0', margin: '0 0 4px' }}>
            {request.request_type.replace(/_/g, ' ')}
            <span style={{ fontSize: 14, fontWeight: 400, color: '#666', marginLeft: 8 }}>#{request.id}</span>
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: '#aaa' }}>
            <strong style={{ color: '#ccc' }}>{request.winery_name}</strong>
            {' · '}{request.contact_email}
            {request.target_id && <span style={{ color: '#666' }}> · Parcel #{request.target_id}</span>}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      {/* Timestamps */}
      <div style={{ fontSize: 11, color: '#555', marginBottom: 24, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
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
        <div style={{ ...infoBox, borderColor: 'rgba(255,193,7,0.2)', marginBottom: 24 }}>
          <SectionLabel>Admin note</SectionLabel>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{request.admin_notes}</p>
        </div>
      )}

      {/* ── Payload viewer ── */}
      <PayloadSection requestType={request.request_type} payload={payload} />

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
    </Shell>
  );
}

// ── PayloadSection ──────────────────────────────────────────────────────────

function PayloadSection({ requestType, payload }) {
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
