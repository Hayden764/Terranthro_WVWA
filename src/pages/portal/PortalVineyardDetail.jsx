import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { BRAND } from '../../config/brandColors';
import { apiJson, apiPost } from '../../lib/api';
import PortalVineyardMap from '../../components/PortalVineyardMap';
import EditableBlocksTable from '../../components/EditableBlocksTable';
import ParcelHistorySection from '../../components/ParcelHistorySection';

export default function PortalVineyardDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [vineyard, setVineyard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingGeometry, setEditingGeometry] = useState(false);
  const [editingBlocks, setEditingBlocks] = useState(false);
  const [pendingGeometry, setPendingGeometry] = useState(null); // { geometry, notes }
  const [geoSubmitStatus, setGeoSubmitStatus] = useState(null); // null | 'submitting' | 'success' | 'error'

  const load = useCallback(async () => {
    try {
      const all = await apiJson('/api/portal/vineyards');
      const v = all.find((p) => String(p.id) === String(id));
      if (!v) { navigate('/portal/dashboard', { replace: true }); return; }
      setVineyard(v);
    } catch {
      navigate('/portal', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  async function submitGeometry() {
    if (!pendingGeometry) return;
    setGeoSubmitStatus('submitting');
    try {
      await apiPost('/api/portal/requests', {
        request_type: 'geometry_update',
        target_id: vineyard.id,
        payload: {
          old_geometry: vineyard.geometry || null,
          new_geometry: pendingGeometry.geometry,
          notes: pendingGeometry.notes || 'Boundary correction submitted via portal',
        },
      });
      setGeoSubmitStatus('success');
      setPendingGeometry(null);
      setEditingGeometry(false);
    } catch {
      setGeoSubmitStatus('error');
    }
  }

  if (loading || !vineyard) {
    return <Shell><p style={{ color: BRAND.textMuted }}>Loading…</p></Shell>;
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'Inter', sans-serif", background: BRAND.eggshell }}>

      {/* ── Left: sticky map pane ── */}
      {vineyard.geometry && (
        <div style={{
          width: '45%', flexShrink: 0, position: 'sticky', top: 0,
          height: '100vh', display: 'flex', flexDirection: 'column',
          borderRight: `1px solid ${BRAND.border}`,
        }}>
          <PortalVineyardMap
            parcels={[vineyard]}
            highlightId={vineyard.id}
            height="100%"
            style={{ flex: 1 }}
            editParcelId={editingGeometry ? vineyard.id : null}
            onGeometrySave={(parcelId, geometry) => {
              setEditingGeometry(false);
              setPendingGeometry({ geometry, notes: '' });
            }}
            onEditCancel={() => setEditingGeometry(false)}
          />
        </div>
      )}

      {/* ── Right: scrollable info pane ── */}
      <div style={{
        flex: 1, overflowY: 'auto', background: BRAND.white,
        padding: '0 32px 36px', minWidth: 0, display: 'flex', flexDirection: 'column',
      }}>
        {/* Sticky back button */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: BRAND.white, borderBottom: `1px solid ${BRAND.border}`,
          padding: '12px 0', marginBottom: 8,
        }}>
          <Link to="/portal/dashboard" style={{ color: BRAND.brownLight, fontSize: 13 }}>← Dashboard</Link>
        </div>

        <h1 style={{
          fontFamily: "'Georgia', serif", fontSize: 22, color: BRAND.brown,
          margin: '16px 0 4px',
        }}>
          {vineyard.vineyard_name || 'Unnamed Parcel'}
        </h1>
        <p style={{ color: BRAND.textMuted, fontSize: 13, marginBottom: 24 }}>
          {vineyard.nested_ava || vineyard.ava_name || '—'} · {Number(vineyard.acres || 0).toFixed(1)} acres
        </p>

        {/* Info */}
        <Section title="Vineyard Info">
          <InfoRow label="AVA" value={vineyard.ava_name || '—'} />
          <InfoRow label="Sub-AVA" value={vineyard.nested_ava || '—'} />
          <InfoRow label="Address" value={[vineyard.situs_address, vineyard.situs_city, vineyard.situs_zip].filter(Boolean).join(', ') || '—'} />
          <InfoRow label="Owner" value={vineyard.owner_name || '—'} />
          <InfoRow label="Varietals" value={vineyard.varietals_list || '—'} />
        </Section>

        {/* Topo stats (read-only) */}
        {vineyard.topo_stats && (
          <Section title="Topography (read-only)">
            <InfoRow label="Elevation" value={`${Number(vineyard.topo_stats.elevation_min_ft).toFixed(0)}–${Number(vineyard.topo_stats.elevation_max_ft).toFixed(0)} ft (avg ${Number(vineyard.topo_stats.elevation_mean_ft).toFixed(0)} ft)`} />
            <InfoRow label="Slope" value={`${Number(vineyard.topo_stats.slope_mean_deg).toFixed(1)}° avg, ${Number(vineyard.topo_stats.slope_max_deg).toFixed(1)}° max`} />
            <InfoRow label="Aspect" value={`${Number(vineyard.topo_stats.aspect_dominant_deg).toFixed(0)}° dominant`} />
          </Section>
        )}

        {/* Blocks */}
        <Section title="Blocks">
          {vineyard.blocks.length === 0 ? (
            <p style={{ color: BRAND.textMuted, fontSize: 13 }}>No blocks recorded.</p>
          ) : (
            <EditableBlocksTable
              parcelId={vineyard.id}
              blocks={vineyard.blocks.slice(0, 1)}
              editMode={editingBlocks}
              onEditCancel={() => setEditingBlocks(false)}
              onEditComplete={() => setEditingBlocks(false)}
            />
          )}
        </Section>

        {/* Request Changes */}
        <Section title="Request Changes">
          <p style={{ color: BRAND.textMuted, fontSize: 13, marginBottom: 16 }}>
            All changes are submitted for admin review before being applied.
          </p>

          {/* Geometry edit flow */}
          {vineyard.geometry && !pendingGeometry && (
            <div style={{ marginBottom: 16 }}>
              {geoSubmitStatus === 'success' ? (
                <p style={{ fontSize: 13, color: '#3a5a1f', fontWeight: 500 }}>✓ Geometry update submitted for review</p>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: BRAND.textMuted, marginBottom: 8 }}>
                    To correct the parcel boundary, click below — the map will enter edit mode so you can drag vertices.
                  </p>
                  <button
                    onClick={() => { setEditingGeometry(true); setGeoSubmitStatus(null); }}
                    disabled={editingGeometry}
                    style={smallBtnStyle}
                  >
                    {editingGeometry ? 'Editing on map…' : 'Edit Boundary'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Pending geometry confirmation */}
          {pendingGeometry && (
            <div style={{
              background: '#fff8f0', border: `1px solid #e8c97a`,
              borderRadius: 8, padding: '14px 16px', marginBottom: 16,
            }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: BRAND.brown, marginBottom: 6 }}>
                ⚠ Review before submitting
              </p>
              <p style={{ fontSize: 12, color: BRAND.textMuted, marginBottom: 10 }}>
                Your boundary change will be sent to admin for approval. Add an optional note explaining the correction.
              </p>
              <textarea
                placeholder="Optional: describe what changed and why"
                value={pendingGeometry.notes}
                onChange={(e) => setPendingGeometry((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6,
                  border: `1px solid ${BRAND.border}`, fontSize: 12,
                  fontFamily: "'Inter', sans-serif", resize: 'vertical', marginBottom: 10,
                }}
              />
              {geoSubmitStatus === 'error' && (
                <p style={{ fontSize: 12, color: BRAND.burgundy, marginBottom: 8 }}>Submission failed — try again.</p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={submitGeometry} disabled={geoSubmitStatus === 'submitting'} style={smallBtnStyle}>
                  {geoSubmitStatus === 'submitting' ? 'Submitting…' : 'Submit for Review'}
                </button>
                <button
                  onClick={() => { setPendingGeometry(null); setGeoSubmitStatus(null); }}
                  style={{ ...smallBtnStyle, background: 'transparent', color: BRAND.textMuted, border: `1px solid ${BRAND.border}` }}
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {editingBlocks ? (
              <span style={{ fontSize: 13, color: BRAND.textMuted, alignSelf: 'center' }}>
                Editing block info above…
              </span>
            ) : (
              <button onClick={() => setEditingBlocks(true)} style={smallBtnStyle}>
                Edit Block Info
              </button>
            )}
          </div>

          <ParcelHistorySection parcelId={vineyard.id} />
        </Section>
      </div>
    </div>
  );
}

function RequestButton({ vineyard, type, label }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const payload = type === 'vineyard_varietals'
        ? { varietals_list: value }
        : type === 'vineyard_blocks'
          ? { notes: value }
          : { notes: value, geometry_description: value };

      await apiPost('/api/portal/requests', {
        request_type: type,
        target_id: vineyard.id,
        payload,
      });
      setDone(true);
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return <span style={{ fontSize: 13, color: '#3a5a1f', fontWeight: 500 }}>✓ Submitted</span>;
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={smallBtnStyle}>
        {label}
      </button>
    );
  }

  return (
    <div style={{ width: '100%', marginBottom: 8 }}>
      <label style={{ fontSize: 12, color: BRAND.textMuted, marginBottom: 4, display: 'block' }}>
        {type === 'vineyard_varietals' ? 'New varietals list' : 'Describe the requested changes'}
      </label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        style={{
          width: '100%', padding: '8px 12px', borderRadius: 6,
          border: `1px solid ${BRAND.border}`, fontSize: 13,
          fontFamily: "'Inter', sans-serif", resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={handleSubmit} disabled={submitting || !value.trim()} style={smallBtnStyle}>
          {submitting ? '…' : 'Submit'}
        </button>
        <button onClick={() => setOpen(false)} style={{ ...smallBtnStyle, background: 'transparent', color: BRAND.textMuted, border: `1px solid ${BRAND.border}` }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: BRAND.eggshell, fontFamily: "'Inter', sans-serif" }}>
      <div style={{
        maxWidth: 700, margin: '0 auto', padding: '40px 20px',
        background: BRAND.white, minHeight: '100vh',
        borderLeft: `1px solid ${BRAND.border}`, borderRight: `1px solid ${BRAND.border}`,
      }}>
        {children}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{
      background: BRAND.eggshell, borderRadius: 10, padding: '20px 16px',
      border: `1px solid ${BRAND.border}`, marginBottom: 20,
    }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: BRAND.brown, marginBottom: 12 }}>{title}</h2>
      {children}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 6, fontSize: 13 }}>
      <span style={{ color: BRAND.textMuted, minWidth: 80, flexShrink: 0 }}>{label}</span>
      <span style={{ color: BRAND.text }}>{value}</span>
    </div>
  );
}


const smallBtnStyle = {
  padding: '6px 16px',
  borderRadius: 6,
  border: 'none',
  background: BRAND.brown,
  color: BRAND.white,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
