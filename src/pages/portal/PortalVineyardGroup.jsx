/**
 * PortalVineyardGroup — shows all parcels that share a vineyard name.
 * Route: /portal/vineyards/group?name=Ribbon+Springs+Vineyard
 *
 * Structure:
 *   - Combined map of all parcels (click highlights a parcel)
 *   - Each parcel is a primary card showing its acreage / address
 *     with its own block table nested underneath (if it has blocks)
 *   - Request-change buttons scoped to each parcel
 */
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { BRAND } from '../../config/brandColors';
import { apiJson, apiPost } from '../../lib/api';
import PortalVineyardMap from '../../components/PortalVineyardMap';
import EditableBlocksTable from '../../components/EditableBlocksTable';
import ParcelHistorySection from '../../components/ParcelHistorySection';

export default function PortalVineyardGroup() {
  const [searchParams] = useSearchParams();
  const name = searchParams.get('name') || '';
  const navigate = useNavigate();
  const [parcels, setParcels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [highlightId, setHighlightId] = useState(null);
  const [editingParcelId, setEditingParcelId] = useState(null);
  const [pendingGeometry, setPendingGeometry] = useState(null); // { parcelId, geometry, notes }
  const [geoSubmitStatus, setGeoSubmitStatus] = useState(null);

  const load = useCallback(async () => {
    try {
      const all = await apiJson('/api/portal/vineyards');
      const group = all.filter(
        (v) => (v.vineyard_name || '').toLowerCase() === name.toLowerCase(),
      );
      if (group.length === 0) {
        navigate('/portal/dashboard', { replace: true });
        return;
      }
      // Sort: parcels with blocks first, then by id
      group.sort((a, b) => (b.blocks?.length || 0) - (a.blocks?.length || 0) || a.id - b.id);
      setParcels(group);
    } catch {
      navigate('/portal', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [name, navigate]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = () => navigate('/portal', { replace: true });
    window.addEventListener('session-expired', handler);
    return () => window.removeEventListener('session-expired', handler);
  }, [navigate]);

  if (loading) {
    return <Shell><p style={{ color: BRAND.textMuted }}>Loading…</p></Shell>;
  }

  const totalAcres = parcels.reduce((s, v) => s + Number(v.acres || 0), 0);
  const totalBlocks = parcels.reduce((s, v) => s + (v.blocks?.length || 0), 0);

  async function submitGeometry() {
    if (!pendingGeometry) return;
    setGeoSubmitStatus('submitting');
    try {
      const currentParcel = parcels.find((p) => p.id === pendingGeometry.parcelId);
      await apiPost('/api/portal/requests', {
        request_type: 'geometry_update',
        target_id: pendingGeometry.parcelId,
        payload: {
          old_geometry: currentParcel?.geometry || null,
          new_geometry: pendingGeometry.geometry,
          notes: pendingGeometry.notes || 'Boundary correction submitted via portal',
        },
      });
      setGeoSubmitStatus('success');
      setPendingGeometry(null);
      setEditingParcelId(null);
    } catch {
      setGeoSubmitStatus('error');
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'Inter', sans-serif", background: BRAND.eggshell }}>

      {/* ── Left: sticky map pane ── */}
      <div style={{
        width: '45%', flexShrink: 0, position: 'sticky', top: 0,
        height: '100vh', display: 'flex', flexDirection: 'column',
        borderRight: `1px solid ${BRAND.border}`,
      }}>
        <PortalVineyardMap
          parcels={parcels}
          highlightId={highlightId}
          height="100%"
          onParcelClick={editingParcelId ? undefined : (parcel) => {
            setHighlightId((prev) => prev === parcel.id ? null : parcel.id);
            document.getElementById(`parcel-${parcel.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
          editParcelId={editingParcelId}
          onGeometrySave={(parcelId, geometry) => {
            setEditingParcelId(null);
            setPendingGeometry({ parcelId, geometry, notes: '' });
            setGeoSubmitStatus(null);
          }}
          onEditCancel={() => setEditingParcelId(null)}
        />
        {!editingParcelId && (
          <p style={{ fontSize: 11, color: BRAND.textMuted, padding: '6px 12px', margin: 0, borderTop: `1px solid ${BRAND.border}`, background: BRAND.white }}>
            Click a parcel to highlight it →
          </p>
        )}
      </div>

      {/* ── Right: scrollable parcel cards ── */}
      <div style={{ flex: 1, overflowY: 'auto', background: BRAND.white, padding: '0 28px 36px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Sticky back button */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: BRAND.white, borderBottom: `1px solid ${BRAND.border}`,
          padding: '12px 0', marginBottom: 8,
        }}>
          <Link to="/portal/dashboard" style={{ color: BRAND.brownLight, fontSize: 13 }}>
            ← Dashboard
          </Link>
        </div>

        <h1 style={{
          fontFamily: "'Georgia', serif", fontSize: 22, color: BRAND.brown,
          margin: '16px 0 4px',
        }}>
          {name}
        </h1>
        <p style={{ color: BRAND.textMuted, fontSize: 13, marginBottom: 24 }}>
          {parcels[0]?.nested_ava || parcels[0]?.ava_name || '—'}
          {' · '}
          {totalAcres.toFixed(1)} acres total
          {' · '}
          {parcels.length} parcel{parcels.length !== 1 ? 's' : ''}
          {totalBlocks > 0 && ` · ${totalBlocks} blocks`}
        </p>

        {/* Per-parcel cards with nested blocks */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {parcels.map((parcel) => (
            <ParcelCard
              key={parcel.id}
              parcel={parcel}
              highlighted={parcel.id === highlightId}
              onHighlight={() => setHighlightId((prev) => prev === parcel.id ? null : parcel.id)}
              onEditGeometry={parcel.geometry ? () => {
                setEditingParcelId(parcel.id);
                setHighlightId(parcel.id);
                setGeoSubmitStatus(null);
              } : undefined}
              isEditing={editingParcelId === parcel.id}
              pendingGeometry={pendingGeometry?.parcelId === parcel.id ? pendingGeometry : null}
              onPendingNotesChange={(notes) => setPendingGeometry((p) => ({ ...p, notes }))}
              onPendingSubmit={submitGeometry}
              onPendingDiscard={() => { setPendingGeometry(null); setGeoSubmitStatus(null); }}
              geoSubmitStatus={pendingGeometry?.parcelId === parcel.id ? geoSubmitStatus : null}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── ParcelCard ─────────────────────────────────── */

function ParcelCard({ parcel, highlighted, onHighlight, onEditGeometry, isEditing,
  pendingGeometry, onPendingNotesChange, onPendingSubmit, onPendingDiscard, geoSubmitStatus }) {
  const [editingBlocks, setEditingBlocks] = useState(false);

  // Cancel block editing if this card loses selection
  useEffect(() => {
    if (!highlighted) setEditingBlocks(false);
  }, [highlighted]);
  const address = [parcel.situs_address, parcel.situs_city, parcel.situs_zip]
    .filter(Boolean).join(', ');

  return (
    <div
      id={`parcel-${parcel.id}`}
      style={{
        borderRadius: 10,
        border: `2px solid ${highlighted ? BRAND.burgundy : BRAND.border}`,
        background: highlighted ? '#fdf5f7' : BRAND.white,
        overflow: 'hidden',
        transition: 'border-color 0.2s, background 0.2s',
      }}
    >
      {/* Parcel header */}
      <div
        style={{
          padding: '14px 16px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
        onClick={onHighlight}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: BRAND.brown }}>
            {parcel.vineyard_name || 'Unnamed Parcel'}
            <span style={{ fontWeight: 400, color: BRAND.textMuted, marginLeft: 8, fontSize: 12 }}>
              #{parcel.id}
            </span>
          </div>
          {address && (
            <div style={{ fontSize: 12, color: BRAND.textMuted, marginTop: 2 }}>{address}</div>
          )}
          <div style={{ fontSize: 12, color: BRAND.textMuted, marginTop: 2 }}>
            {parcel.acres ? `${Number(parcel.acres).toFixed(1)} acres` : 'Acreage unknown'}
            {parcel.nested_ava && ` · ${parcel.nested_ava}`}
          </div>
        </div>
        {highlighted && (
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 10,
            background: BRAND.burgundy, color: '#fff', fontWeight: 600, flexShrink: 0,
          }}>
            on map
          </span>
        )}
      </div>

      {/* Topo stats */}
      {parcel.topo_stats && (
        <div style={{
          margin: '0 16px 12px',
          padding: '8px 12px', borderRadius: 6,
          background: BRAND.eggshell, fontSize: 12, color: BRAND.textMuted,
          display: 'flex', gap: 16, flexWrap: 'wrap',
        }}>
          <span>Elev: {Number(parcel.topo_stats.elevation_min_ft).toFixed(0)}–{Number(parcel.topo_stats.elevation_max_ft).toFixed(0)} ft</span>
          <span>Slope: {Number(parcel.topo_stats.slope_mean_deg).toFixed(1)}° avg</span>
          <span>Aspect: {Number(parcel.topo_stats.aspect_dominant_deg).toFixed(0)}°</span>
        </div>
      )}

      {/* Blocks table — always visible */}
      <div style={{ borderTop: `1px solid ${BRAND.border}`, padding: '0 16px 16px' }}>
        <EditableBlocksTable
          parcelId={parcel.id}
          blocks={(parcel.blocks || []).slice(0, 1)}
          editMode={editingBlocks}
          onEditCancel={() => setEditingBlocks(false)}
          onEditComplete={() => setEditingBlocks(false)}
        />
      </div>

      {/* Actions */}
      <div style={{
        borderTop: `1px solid ${BRAND.border}`, padding: '10px 16px',
        display: 'flex', gap: 8, flexWrap: 'wrap', background: BRAND.eggshell,
      }}>
        {highlighted && (
          editingBlocks ? (
            <span style={{ fontSize: 12, color: BRAND.textMuted, alignSelf: 'center' }}>
              Editing block info above…
            </span>
          ) : (
            <button
              onClick={() => setEditingBlocks(true)}
              style={smallBtnStyle}
            >
              Edit Block Info
            </button>
          )
        )}
        {highlighted && onEditGeometry && !isEditing && !pendingGeometry && (
          <button onClick={onEditGeometry} style={smallBtnStyle}>Edit Boundary</button>
        )}
        {isEditing && (
          <span style={{ fontSize: 12, color: BRAND.textMuted, alignSelf: 'center' }}>Editing on map…</span>
        )}
      </div>

      {/* Edit history — always rendered, lazy-loads on expand */}
      <div style={{ padding: '0 16px' }}>
        <ParcelHistorySection parcelId={parcel.id} />
      </div>

      {/* Pending geometry confirmation */}
      {pendingGeometry && (
        <div style={{
          margin: '0 16px 16px',
          background: '#fff8f0', border: `1px solid #e8c97a`,
          borderRadius: 8, padding: '14px 16px',
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: BRAND.brown, marginBottom: 6 }}>
            ⚠ Review before submitting
          </p>
          <p style={{ fontSize: 12, color: BRAND.textMuted, marginBottom: 10 }}>
            Your boundary change will be sent to admin for approval.
          </p>
          <textarea
            placeholder="Optional: describe what changed and why"
            value={pendingGeometry.notes}
            onChange={(e) => onPendingNotesChange(e.target.value)}
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
          {geoSubmitStatus === 'success' && (
            <p style={{ fontSize: 12, color: '#3a5a1f', marginBottom: 8 }}>✓ Submitted for review</p>
          )}
          {geoSubmitStatus !== 'success' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onPendingSubmit} disabled={geoSubmitStatus === 'submitting'} style={smallBtnStyle}>
                {geoSubmitStatus === 'submitting' ? 'Submitting…' : 'Submit for Review'}
              </button>
              <button
                onClick={onPendingDiscard}
                style={{ ...smallBtnStyle, background: 'transparent', color: BRAND.textMuted, border: `1px solid ${BRAND.border}` }}
              >
                Discard
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Shared sub-components ─────────────────────── */

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


const smallBtnStyle = {
  padding: '5px 12px', borderRadius: 6, border: 'none',
  background: BRAND.brown, color: '#fff', cursor: 'pointer',
  fontSize: 12, fontWeight: 500,
};

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

  if (done) return <span style={{ fontSize: 12, color: '#3a5a1f', fontWeight: 500 }}>✓ Submitted</span>;

  if (!open) {
    return <button onClick={() => setOpen(true)} style={smallBtnStyle}>{label}</button>;
  }

  return (
    <div style={{ width: '100%', marginTop: 4 }}>
      <label style={{ fontSize: 12, color: BRAND.textMuted, marginBottom: 4, display: 'block' }}>
        {type === 'vineyard_varietals' ? 'New varietals list' : 'Describe the requested changes'}
      </label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        style={{
          width: '100%', padding: '8px 10px', borderRadius: 6,
          border: `1px solid ${BRAND.border}`, fontSize: 12,
          fontFamily: "'Inter', sans-serif", resize: 'vertical', boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button onClick={handleSubmit} disabled={submitting || !value.trim()} style={smallBtnStyle}>
          {submitting ? '…' : 'Submit'}
        </button>
        <button
          onClick={() => setOpen(false)}
          style={{ ...smallBtnStyle, background: 'transparent', color: BRAND.textMuted, border: `1px solid ${BRAND.border}` }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
