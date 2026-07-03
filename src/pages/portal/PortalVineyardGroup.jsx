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
import lineSplit from '@turf/line-split';
import { feature as turfFeature } from '@turf/helpers';
import { border, crimson, ink, muted, parchment, TOKENS } from '../../styles/tokens';
import { INPUT_STYLE, btn } from '../../styles/patterns';
import { apiJson, apiPost } from '../../lib/api';
import PortalVineyardMap from '../../components/PortalVineyardMap';
import EditableBlocksTable from '../../components/EditableBlocksTable';
import ParcelHistorySection from '../../components/ParcelHistorySection';
import TerroirDataChips from '../../components/TerroirDataChips';

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

  // Split parcel
  const [splittingParcelId, setSplittingParcelId] = useState(null);
  const [pendingSplit, setPendingSplit] = useState(null); // { parcelId, polygon_a, polygon_b, split_line, notes }
  const [splitSubmitStatus, setSplitSubmitStatus] = useState(null);

  // Remove / unlink
  const [removingParcelId, setRemovingParcelId] = useState(null);
  const [removeAction, setRemoveAction] = useState('unlink');
  const [removeNotes, setRemoveNotes] = useState('');
  const [removeSubmitStatus, setRemoveSubmitStatus] = useState(null);

  // Add parcel
  const [addingParcel, setAddingParcel] = useState(false);
  const [pendingAdd, setPendingAdd] = useState(null); // { geometry, vineyard_name, notes }
  const [addSubmitStatus, setAddSubmitStatus] = useState(null);

  // Rename vineyard (applies to the whole group)
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameStatus, setRenameStatus] = useState(null); // null | 'submitting' | 'success' | 'error'

  const load = useCallback(async () => {
    try {
      const group = await apiJson(`/api/portal/vineyards/by-name?name=${encodeURIComponent(name)}`);
      if (!group || group.length === 0) {
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
    return <Shell><p style={{ color: muted }}>Loading…</p></Shell>;
  }

  const totalAcres = parcels.reduce((s, v) => s + Number(v.acres || 0), 0);
  const totalBlocks = parcels.reduce((s, v) => s + (v.blocks?.length || 0), 0);

  const meanElevations = parcels
    .map((p) => Number(p.topo_stats?.elevation_mean_ft))
    .filter((n) => Number.isFinite(n));
  const groupElevation = meanElevations.length
    ? `${Math.round(meanElevations.reduce((a, b) => a + b, 0) / meanElevations.length)} ft`
    : null;

  const firstWithClimate = parcels.find((p) => p.gst_f != null || p.growing_season_temp_f != null || p.winkler_index != null || p.gdd != null);
  const gstRaw = firstWithClimate?.gst_f ?? firstWithClimate?.growing_season_temp_f ?? null;
  const winklerRaw = firstWithClimate?.winkler_index ?? firstWithClimate?.gdd ?? null;
  const gstValue = gstRaw != null ? `${Number(gstRaw).toFixed(1)}°F` : null;
  const winklerValue = winklerRaw != null ? Number(winklerRaw).toLocaleString('en-US') : null;

  const firstWithSoil = parcels.find((p) => p.soil_series || p.soil_type || p.soil);
  const soilValue = firstWithSoil?.soil_series || firstWithSoil?.soil_type || firstWithSoil?.soil || null;

  const groupChips = [
    { label: 'Winkler', value: winklerValue || '—', tone: 'blue', glow: true },
    { label: 'GST', value: gstValue || '—', tone: 'green', glow: true },
    { label: 'Soil', value: soilValue || '—', tone: 'amber', glow: false },
    { label: 'Elev', value: groupElevation || '—', tone: 'parchment', glow: false },
  ];

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

  function handleSplitLineSave(parcelId, lineGeometry) {
    setSplittingParcelId(null);
    const parcel = parcels.find((p) => p.id === parcelId);
    try {
      const result = lineSplit(turfFeature(parcel.geometry), turfFeature(lineGeometry));
      if (result.features.length >= 2) {
        setPendingSplit({ parcelId, polygon_a: result.features[0].geometry, polygon_b: result.features[1].geometry, split_line: lineGeometry, notes: '' });
      } else {
        setPendingSplit({ parcelId, polygon_a: null, polygon_b: null, split_line: lineGeometry, notes: '' });
      }
    } catch {
      setPendingSplit({ parcelId, polygon_a: null, polygon_b: null, split_line: lineGeometry, notes: '' });
    }
  }

  async function submitSplit() {
    if (!pendingSplit) return;
    setSplitSubmitStatus('submitting');
    try {
      const parcel = parcels.find((p) => p.id === pendingSplit.parcelId);
      await apiPost('/api/portal/requests', {
        request_type: 'vineyard_split',
        target_id: pendingSplit.parcelId,
        payload: { original_geometry: parcel?.geometry, polygon_a: pendingSplit.polygon_a, polygon_b: pendingSplit.polygon_b, split_line: pendingSplit.split_line, notes: pendingSplit.notes || 'Parcel split requested via portal' },
      });
      setSplitSubmitStatus('success');
      setPendingSplit(null);
    } catch {
      setSplitSubmitStatus('error');
    }
  }

  async function submitRemove() {
    if (!removingParcelId) return;
    setRemoveSubmitStatus('submitting');
    try {
      await apiPost('/api/portal/requests', {
        request_type: 'vineyard_remove',
        target_id: removingParcelId,
        payload: { action: removeAction, notes: removeNotes || (removeAction === 'delete' ? 'Vines pulled up' : 'No longer owned') },
      });
      setRemoveSubmitStatus('success');
      setRemovingParcelId(null);
    } catch {
      setRemoveSubmitStatus('error');
    }
  }

  async function submitAdd() {
    if (!pendingAdd?.geometry) return;
    setAddSubmitStatus('submitting');
    try {
      await apiPost('/api/portal/requests', {
        request_type: 'vineyard_new',
        target_id: parcels[0]?.winery_id,
        payload: { geometry: pendingAdd.geometry, vineyard_name: pendingAdd.vineyard_name || '', ava_name: parcels[0]?.ava_name || '', notes: pendingAdd.notes || 'New parcel requested via portal' },
      });
      setAddSubmitStatus('success');
      setPendingAdd(null);
      setAddingParcel(false);
    } catch {
      setAddSubmitStatus('error');
    }
  }

  function startRename() {
    setRenameValue(name);
    setRenameStatus(null);
    setRenaming(true);
  }

  async function submitRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === name) {
      setRenaming(false);
      return;
    }
    setRenameStatus('submitting');
    try {
      // Rename applies to the whole vineyard group; the backend expands the
      // target parcel to all same-name siblings for this winery.
      await apiPost('/api/portal/requests', {
        request_type: 'vineyard_rename',
        target_id: parcels[0]?.id,
        payload: { vineyard_name: trimmed },
      });
      setRenameStatus('success');
      setRenaming(false);
    } catch {
      setRenameStatus('error');
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'var(--font-sans)', background: parchment }}>

      {/* ── Left: sticky map pane ── */}
      <div style={{
        width: '45%', flexShrink: 0, position: 'sticky', top: 0,
        height: '100vh', display: 'flex', flexDirection: 'column',
        borderRight: `1px solid ${border}`,
      }}>
        <PortalVineyardMap
          parcels={parcels}
          highlightId={highlightId}
          height="100%"
          onParcelClick={(editingParcelId || splittingParcelId || addingParcel) ? undefined : (parcel) => {
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
          splitParcelId={splittingParcelId}
          onSplitLineSave={handleSplitLineSave}
          onSplitCancel={() => setSplittingParcelId(null)}
          addMode={addingParcel}
          onAddSave={(geometry) => { setAddingParcel(false); setPendingAdd({ geometry, vineyard_name: '', notes: '' }); }}
          onAddCancel={() => setAddingParcel(false)}
        />
        {!editingParcelId && !splittingParcelId && !addingParcel && (
          <p style={{ fontSize: 'var(--type-ui-label-size)', color: muted, padding: '6px 12px', margin: 0, borderTop: `1px solid ${border}`, background: parchment }}>
            Click a parcel to highlight it →
          </p>
        )}
      </div>

      {/* ── Right: scrollable parcel cards ── */}
      <div style={{ flex: 1, overflowY: 'auto', background: parchment, padding: '0 28px 36px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Sticky back button */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: parchment, borderBottom: `1px solid ${border}`,
          padding: '12px 0', marginBottom: 8,
        }}>
          <Link to="/portal/dashboard" style={{ color: muted, fontSize: 'var(--type-mono-size)' }}>
            ← Dashboard
          </Link>
        </div>

        {renaming ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 4px' }}>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              className="ds-input"
              style={{ ...INPUT_STYLE, flex: '1 1 240px', minWidth: 0 }}
              onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(false); }}
            />
            <button onClick={submitRename} disabled={renameStatus === 'submitting'} style={smallBtnStyle}>
              {renameStatus === 'submitting' ? 'Submitting…' : 'Submit for Review'}
            </button>
            <button onClick={() => setRenaming(false)} style={{ ...smallBtnStyle, background: 'transparent', color: muted, border: `1px solid ${border}` }}>Cancel</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 4px' }}>
            <h1 style={{
              fontFamily: 'var(--font-display)', fontSize: 'var(--type-display-italic-size)', color: ink, margin: 0,
            }}>
              {name}
            </h1>
            <button onClick={startRename} style={editNameBtnStyle} title="Rename this vineyard">
              ✎ Edit name
            </button>
          </div>
        )}
        {renameStatus === 'success' && (
          <p style={{ fontSize: 'var(--type-mono-size)', color: TOKENS.success, fontWeight: 500, margin: '4px 0 0' }}>
            ✓ Name change submitted for review (applies to all parcels in this vineyard once approved)
          </p>
        )}
        {renameStatus === 'error' && (
          <p style={{ fontSize: 'var(--type-mono-size)', color: crimson, margin: '4px 0 0' }}>Submission failed — try again.</p>
        )}
        <p style={{ color: muted, fontSize: 'var(--type-mono-size)', marginBottom: 24 }}>
          {parcels[0]?.nested_ava || parcels[0]?.ava_name || '—'}
          {' · '}
          {totalAcres.toFixed(1)} acres total
          {' · '}
          {parcels.length} parcel{parcels.length !== 1 ? 's' : ''}
          {totalBlocks > 0 && ` · ${totalBlocks} blocks`}
        </p>

        <div style={{ marginBottom: 18 }}>
          <TerroirDataChips chips={groupChips} />
        </div>

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
              onSplitParcel={parcel.geometry ? () => { setSplittingParcelId(parcel.id); setHighlightId(parcel.id); setSplitSubmitStatus(null); } : undefined}
              isSplitting={splittingParcelId === parcel.id}
              pendingSplit={pendingSplit?.parcelId === parcel.id ? pendingSplit : null}
              onSplitNotesChange={(notes) => setPendingSplit((p) => ({ ...p, notes }))}
              onSplitSubmit={submitSplit}
              onSplitDiscard={() => { setPendingSplit(null); setSplitSubmitStatus(null); }}
              splitSubmitStatus={pendingSplit?.parcelId === parcel.id ? splitSubmitStatus : null}
              onRemoveParcel={() => { setRemovingParcelId(parcel.id); setHighlightId(parcel.id); setRemoveSubmitStatus(null); setRemoveNotes(''); }}
              isRemoving={removingParcelId === parcel.id}
              removeAction={removeAction}
              onRemoveActionChange={setRemoveAction}
              removeNotes={removeNotes}
              onRemoveNotesChange={setRemoveNotes}
              onRemoveSubmit={submitRemove}
              onRemoveCancel={() => { setRemovingParcelId(null); setRemoveSubmitStatus(null); setRemoveNotes(''); }}
              removeSubmitStatus={removingParcelId === parcel.id ? removeSubmitStatus : null}
            />
          ))}

        {/* Add Parcel — group-level (not per-parcel) */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', paddingTop: 8 }}>
          {addingParcel ? (
            <span style={{ fontSize: 'var(--type-mono-size)', color: muted }}>Drawing new parcel on map…</span>
          ) : addSubmitStatus === 'success' ? (
            <span style={{ fontSize: 'var(--type-mono-size)', color: TOKENS.success, fontWeight: 500 }}>✓ New parcel submitted for review</span>
          ) : (
            <button onClick={() => { setAddingParcel(true); setAddSubmitStatus(null); }} style={smallBtnStyle}>
              + Add Parcel
            </button>
          )}
        </div>

        {/* Pending add confirmation */}
        {pendingAdd && (
          <div style={{ background: TOKENS.warningDim, border: `1px solid ${TOKENS.warning}`, borderRadius: 8, padding: '14px 16px' }}>
            <p style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: ink, marginBottom: 6 }}>+ Review new parcel</p>
            <p style={{ fontSize: 'var(--type-body-size)', color: muted, marginBottom: 10 }}>Give the new parcel a name and any notes for the admin.</p>
            <input
              type="text"
              placeholder="Parcel / vineyard name"
              value={pendingAdd.vineyard_name}
              onChange={(e) => setPendingAdd((p) => ({ ...p, vineyard_name: e.target.value }))}
              className="ds-input"
              style={{ ...INPUT_STYLE, width: '100%', boxSizing: 'border-box', padding: '8px 10px', marginBottom: 8 }}
            />
            <textarea
              placeholder="Optional: variety, location notes, etc."
              value={pendingAdd.notes}
              onChange={(e) => setPendingAdd((p) => ({ ...p, notes: e.target.value }))}
              rows={2}
              className="ds-input"
              style={{ ...INPUT_STYLE, width: '100%', boxSizing: 'border-box', padding: '8px 10px', resize: 'vertical', marginBottom: 10 }}
            />
            {addSubmitStatus === 'error' && <p style={{ fontSize: 'var(--type-body-size)', color: crimson, marginBottom: 8 }}>Submission failed — try again.</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={submitAdd} disabled={addSubmitStatus === 'submitting' || !pendingAdd.vineyard_name.trim()} style={smallBtnStyle}>
                {addSubmitStatus === 'submitting' ? 'Submitting…' : 'Submit for Review'}
              </button>
              <button onClick={() => { setPendingAdd(null); setAddSubmitStatus(null); }} style={{ ...smallBtnStyle, background: 'transparent', color: muted, border: `1px solid ${border}` }}>
                Discard
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

/* ── ParcelCard ─────────────────────────────────── */

function ParcelCard({ parcel, highlighted, onHighlight, onEditGeometry, isEditing,
  pendingGeometry, onPendingNotesChange, onPendingSubmit, onPendingDiscard, geoSubmitStatus,
  onSplitParcel, isSplitting, pendingSplit, onSplitNotesChange, onSplitSubmit, onSplitDiscard, splitSubmitStatus,
  onRemoveParcel, isRemoving, removeAction, onRemoveActionChange, removeNotes, onRemoveNotesChange, onRemoveSubmit, onRemoveCancel, removeSubmitStatus,
}) {
  const [editingBlocks, setEditingBlocks] = useState(false);

  // Cancel block editing if this card loses selection
  useEffect(() => {
    if (!highlighted) setEditingBlocks(false);
  }, [highlighted]);
  const address = [parcel.situs_address, parcel.situs_city, parcel.situs_zip]
    .filter(Boolean).join(', ');

  const parcelChips = parcel.topo_stats ? [
    {
      label: 'Elev',
      value: `${Number(parcel.topo_stats.elevation_min_ft).toFixed(0)}-${Number(parcel.topo_stats.elevation_max_ft).toFixed(0)} ft`,
      tone: 'parchment',
      glow: false,
    },
    {
      label: 'Slope',
      value: `${Number(parcel.topo_stats.slope_mean_deg).toFixed(1)}° avg`,
      tone: 'green',
      glow: true,
    },
    {
      label: 'Aspect',
      value: `${Number(parcel.topo_stats.aspect_dominant_deg).toFixed(0)}°`,
      tone: 'blue',
      glow: true,
    },
    {
      label: 'Acres',
      value: parcel.acres ? `${Number(parcel.acres).toFixed(1)} ac` : '—',
      tone: 'amber',
      glow: false,
    },
  ] : null;

  return (
    <div
      id={`parcel-${parcel.id}`}
      style={{
        borderRadius: 10,
        border: `2px solid ${highlighted ? crimson : border}`,
        background: highlighted ? TOKENS.dangerDim : parchment,
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
          <div style={{ fontWeight: 600, fontSize: 'var(--type-body-size)', color: ink }}>
            {parcel.vineyard_name || 'Unnamed Parcel'}
            <span style={{ fontWeight: 400, color: muted, marginLeft: 8, fontSize: 'var(--type-body-size)' }}>
              #{parcel.id}
            </span>
          </div>
          {address && (
            <div style={{ fontSize: 'var(--type-body-size)', color: muted, marginTop: 2 }}>{address}</div>
          )}
          <div style={{ fontSize: 'var(--type-body-size)', color: muted, marginTop: 2 }}>
            {parcel.acres ? `${Number(parcel.acres).toFixed(1)} acres` : 'Acreage unknown'}
            {parcel.nested_ava && ` · ${parcel.nested_ava}`}
          </div>
        </div>
        {highlighted && (
          <span style={{
            fontSize: 'var(--type-ui-label-size)', padding: '2px 8px', borderRadius: 10,
            background: crimson, color: parchment, fontWeight: 600, flexShrink: 0,
          }}>
            on map
          </span>
        )}
      </div>

      {/* Topo stats */}
      {parcelChips && (
        <div style={{ margin: '0 16px 12px' }}>
          <TerroirDataChips chips={parcelChips} />
        </div>
      )}

      {/* Blocks table — always visible */}
      <div style={{ borderTop: `1px solid ${border}`, padding: '0 16px 16px' }}>
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
        borderTop: `1px solid ${border}`, padding: '10px 16px',
        display: 'flex', gap: 8, flexWrap: 'wrap', background: parchment,
      }}>
        {/* Edit Block Info */}
        {editingBlocks ? (
          <span style={{ fontSize: 'var(--type-body-size)', color: muted, alignSelf: 'center' }}>
            Editing block info above…
          </span>
        ) : (
          <button onClick={() => setEditingBlocks(true)} style={smallBtnStyle}>
            Edit Block Info
          </button>
        )}

        {/* Edit Boundary */}
        {onEditGeometry && !isEditing && !pendingGeometry && geoSubmitStatus !== 'success' && (
          <button onClick={onEditGeometry} style={smallBtnStyle}>Edit Boundary</button>
        )}
        {isEditing && (
          <span style={{ fontSize: 'var(--type-body-size)', color: muted, alignSelf: 'center' }}>Editing on map…</span>
        )}
        {geoSubmitStatus === 'success' && (
          <span style={{ fontSize: 'var(--type-body-size)', color: TOKENS.success, fontWeight: 500 }}>✓ Boundary submitted</span>
        )}

        {/* Split Parcel */}
        {onSplitParcel && !pendingSplit && splitSubmitStatus !== 'success' && (
          isSplitting ? (
            <span style={{ fontSize: 'var(--type-body-size)', color: muted, alignSelf: 'center' }}>Drawing split line…</span>
          ) : (
            <button onClick={onSplitParcel} style={smallBtnStyle}>Split Parcel</button>
          )
        )}
        {splitSubmitStatus === 'success' && (
          <span style={{ fontSize: 'var(--type-body-size)', color: TOKENS.success, fontWeight: 500 }}>✓ Split submitted</span>
        )}

        {/* Remove / Unlink */}
        {!isRemoving && removeSubmitStatus !== 'success' && (
          <button
            onClick={onRemoveParcel}
            style={{ ...smallBtnStyle, background: 'transparent', color: crimson, border: `1px solid ${crimson}` }}
          >
            Remove / Unlink
          </button>
        )}
        {removeSubmitStatus === 'success' && (
          <span style={{ fontSize: 'var(--type-body-size)', color: TOKENS.success, fontWeight: 500 }}>✓ Removal submitted</span>
        )}
      </div>

      {/* Remove / unlink confirmation */}
      {isRemoving && (
        <div style={{ margin: '0 16px 16px', background: TOKENS.dangerDim, border: `1px solid ${TOKENS.danger}`, borderRadius: 8, padding: '14px 16px' }}>
          <p style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: crimson, marginBottom: 8 }}>Remove this parcel</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {[
              { value: 'delete', label: 'Delete — vines have been pulled up or parcel no longer exists' },
              { value: 'unlink', label: 'Unlink — parcel was sold or is no longer associated with my winery' },
            ].map(({ value, label }) => (
              <label key={value} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 'var(--type-mono-size)', cursor: 'pointer' }}>
                <input type="radio" name={`removeAction-${parcel.id}`} value={value} checked={removeAction === value} onChange={() => onRemoveActionChange(value)} style={{ marginTop: 2, accentColor: crimson }} />
                <span style={{ color: ink }}>{label}</span>
              </label>
            ))}
          </div>
          <textarea
            placeholder="Optional: additional notes for the admin"
            value={removeNotes}
            onChange={(e) => onRemoveNotesChange(e.target.value)}
            rows={2}
            className="ds-input"
            style={{ ...INPUT_STYLE, width: '100%', boxSizing: 'border-box', padding: '8px 10px', resize: 'vertical', marginBottom: 10 }}
          />
          {removeSubmitStatus === 'error' && <p style={{ fontSize: 'var(--type-body-size)', color: crimson, marginBottom: 8 }}>Submission failed — try again.</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onRemoveSubmit} disabled={removeSubmitStatus === 'submitting'} style={{ ...smallBtnStyle, background: crimson }}>
              {removeSubmitStatus === 'submitting' ? 'Submitting…' : 'Submit Request'}
            </button>
            <button onClick={onRemoveCancel} style={{ ...smallBtnStyle, background: 'transparent', color: muted, border: `1px solid ${border}` }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Split confirmation */}
      {pendingSplit && (
        <div style={{ margin: '0 16px 16px', background: TOKENS.warningDim, border: `1px solid ${TOKENS.warning}`, borderRadius: 8, padding: '14px 16px' }}>
          <p style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: ink, marginBottom: 6 }}>✂ Confirm parcel split</p>
          <p style={{ fontSize: 'var(--type-body-size)', color: muted, marginBottom: 10 }}>
            {pendingSplit.polygon_a ? 'Two sub-parcels were computed from your split line.' : 'Split line recorded — admin will apply manually.'}
          </p>
          <textarea
            placeholder="Optional: e.g. 'Left half is Pinot Noir, right half is Chardonnay'"
            value={pendingSplit.notes}
            onChange={(e) => onSplitNotesChange(e.target.value)}
            rows={2}
            className="ds-input"
            style={{ ...INPUT_STYLE, width: '100%', boxSizing: 'border-box', padding: '8px 10px', resize: 'vertical', marginBottom: 10 }}
          />
          {splitSubmitStatus === 'error' && <p style={{ fontSize: 'var(--type-body-size)', color: crimson, marginBottom: 8 }}>Submission failed — try again.</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onSplitSubmit} disabled={splitSubmitStatus === 'submitting'} style={smallBtnStyle}>
              {splitSubmitStatus === 'submitting' ? 'Submitting…' : 'Submit Split Request'}
            </button>
            <button onClick={onSplitDiscard} style={{ ...smallBtnStyle, background: 'transparent', color: muted, border: `1px solid ${border}` }}>Discard</button>
          </div>
        </div>
      )}

      {/* Edit history — always rendered, lazy-loads on expand */}
      <div style={{ padding: '0 16px' }}>
        <ParcelHistorySection parcelId={parcel.id} />
      </div>

      {/* Pending geometry confirmation */}
      {pendingGeometry && (
        <div style={{
          margin: '0 16px 16px',
          background: TOKENS.warningDim, border: `1px solid ${TOKENS.warning}`,
          borderRadius: 8, padding: '14px 16px',
        }}>
          <p style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: ink, marginBottom: 6 }}>
            ⚠ Review before submitting
          </p>
          <p style={{ fontSize: 'var(--type-body-size)', color: muted, marginBottom: 10 }}>
            Your boundary change will be sent to admin for approval.
          </p>
          <textarea
            placeholder="Optional: describe what changed and why"
            value={pendingGeometry.notes}
            onChange={(e) => onPendingNotesChange(e.target.value)}
            rows={2}
            className="ds-input"
            style={{
              ...INPUT_STYLE,
              width: '100%', boxSizing: 'border-box', padding: '8px 10px',
              resize: 'vertical', marginBottom: 10,
            }}
          />
          {geoSubmitStatus === 'error' && (
            <p style={{ fontSize: 'var(--type-body-size)', color: crimson, marginBottom: 8 }}>Submission failed — try again.</p>
          )}
          {geoSubmitStatus === 'success' && (
            <p style={{ fontSize: 'var(--type-body-size)', color: TOKENS.success, marginBottom: 8 }}>✓ Submitted for review</p>
          )}
          {geoSubmitStatus !== 'success' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onPendingSubmit} disabled={geoSubmitStatus === 'submitting'} style={smallBtnStyle}>
                {geoSubmitStatus === 'submitting' ? 'Submitting…' : 'Submit for Review'}
              </button>
              <button
                onClick={onPendingDiscard}
                style={{ ...smallBtnStyle, background: 'transparent', color: muted, border: `1px solid ${border}` }}
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
    <div style={{ minHeight: '100vh', background: parchment, fontFamily: 'var(--font-sans)' }}>
      <div style={{
        maxWidth: 700, margin: '0 auto', padding: '40px 20px',
        background: parchment, minHeight: '100vh',
        borderLeft: `1px solid ${border}`, borderRight: `1px solid ${border}`,
      }}>
        {children}
      </div>
    </div>
  );
}


const smallBtnStyle = {
  ...btn('primary', { padding: '5px 12px' }),
  cursor: 'pointer',
};

const editNameBtnStyle = {
  background: 'transparent',
  border: `1px solid ${border}`,
  borderRadius: 6,
  color: ink,
  cursor: 'pointer',
  fontSize: 'var(--type-mono-size)',
  fontFamily: 'var(--font-sans)',
  padding: '4px 12px',
  alignSelf: 'center',
  whiteSpace: 'nowrap',
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

  if (done) return <span style={{ fontSize: 'var(--type-body-size)', color: TOKENS.success, fontWeight: 500 }}>✓ Submitted</span>;

  if (!open) {
    return <button onClick={() => setOpen(true)} style={smallBtnStyle}>{label}</button>;
  }

  return (
    <div style={{ width: '100%', marginTop: 4 }}>
      <label style={{ fontSize: 'var(--type-body-size)', color: muted, marginBottom: 4, display: 'block' }}>
        {type === 'vineyard_varietals' ? 'New varietals list' : 'Describe the requested changes'}
      </label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        className="ds-input"
        style={{
          ...INPUT_STYLE,
          width: '100%', padding: '8px 10px',
          resize: 'vertical', boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button onClick={handleSubmit} disabled={submitting || !value.trim()} style={smallBtnStyle}>
          {submitting ? '…' : 'Submit'}
        </button>
        <button
          onClick={() => setOpen(false)}
          style={{ ...smallBtnStyle, background: 'transparent', color: muted, border: `1px solid ${border}` }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
