import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import lineSplit from '@turf/line-split';
import { feature as turfFeature } from '@turf/helpers';
import { alpha, border, crimson, ink, muted, parchment, TOKENS } from '../../styles/tokens';
import { INPUT_STYLE, btn } from '../../styles/patterns';
import { apiJson, apiPost } from '../../lib/api';
import PortalVineyardMap from '../../components/PortalVineyardMap';
import EditableBlocksTable from '../../components/EditableBlocksTable';
import ParcelHistorySection from '../../components/ParcelHistorySection';
import TerroirDataChips from '../../components/TerroirDataChips';

export default function PortalVineyardDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [vineyard, setVineyard] = useState(null);
  const [loading, setLoading] = useState(true);

  // Map ↔ table block selection
  const [selectedBlockId, setSelectedBlockId] = useState(null);

  // Block table edit toggle (parent-owned; button lives in the Blocks header)
  const [editingBlocks, setEditingBlocks] = useState(false);

  // Edit boundary
  const [editingGeometry, setEditingGeometry] = useState(false);
  const [pendingGeometry, setPendingGeometry] = useState(null); // { geometry, notes }
  const [geoSubmitStatus, setGeoSubmitStatus] = useState(null); // null | 'submitting' | 'success' | 'error'

  // Split parcel
  const [splittingParcel, setSplittingParcel] = useState(false);
  const [pendingSplit, setPendingSplit] = useState(null); // { polygon_a, polygon_b, split_line, notes }
  const [splitSubmitStatus, setSplitSubmitStatus] = useState(null);

  // Remove / unlink
  const [removingParcel, setRemovingParcel] = useState(false);
  const [removeAction, setRemoveAction] = useState('unlink'); // 'delete' | 'unlink'
  const [removeNotes, setRemoveNotes] = useState('');
  const [removeSubmitStatus, setRemoveSubmitStatus] = useState(null);

  // Add parcel
  const [addingParcel, setAddingParcel] = useState(false);
  const [pendingAdd, setPendingAdd] = useState(null); // { geometry, vineyard_name, notes }
  const [addSubmitStatus, setAddSubmitStatus] = useState(null);

  // Rename vineyard
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameStatus, setRenameStatus] = useState(null); // null | 'submitting' | 'success' | 'error'

  const load = useCallback(async () => {
    try {
      const v = await apiJson(`/api/portal/vineyards/${id}`);
      setVineyard(v);
    } catch {
      navigate('/portal', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  // Stable references for the map (avoids re-mounting on every parent render).
  const parcelsArg = useMemo(() => (vineyard?.geometry ? [vineyard] : []), [vineyard]);
  // Give every block a stable display name — its own name, or "Block N" by its
  // position in the id-ordered list. Computed once here so the map and table
  // always agree on what a block is called.
  const blocksWithNames = useMemo(
    () => (vineyard?.blocks || []).map((b, i) => ({
      ...b,
      display_name: (b.block_name && b.block_name.trim()) ? b.block_name.trim() : `Block ${i + 1}`,
    })),
    [vineyard]
  );
  const blockFeatures = useMemo(() => blocksWithNames.filter((b) => b.geometry), [blocksWithNames]);

  // A geometry confirmation is awaiting review — hide the map toolbar while so.
  const geometryBusy = Boolean(pendingGeometry || pendingSplit || pendingAdd || removingParcel);

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

  function handleSplitLineSave(parcelId, lineGeometry) {
    setSplittingParcel(false);
    // Use @turf/line-split to compute the two polygon halves
    try {
      const parcelFeature = turfFeature(vineyard.geometry);
      const splitLine = turfFeature(lineGeometry);
      const result = lineSplit(parcelFeature, splitLine);
      if (result.features.length >= 2) {
        setPendingSplit({
          polygon_a: result.features[0].geometry,
          polygon_b: result.features[1].geometry,
          split_line: lineGeometry,
          notes: '',
        });
      } else {
        setPendingSplit({ polygon_a: null, polygon_b: null, split_line: lineGeometry, notes: '' });
      }
    } catch {
      setPendingSplit({ polygon_a: null, polygon_b: null, split_line: lineGeometry, notes: '' });
    }
  }

  async function submitSplit() {
    if (!pendingSplit) return;
    setSplitSubmitStatus('submitting');
    try {
      await apiPost('/api/portal/requests', {
        request_type: 'vineyard_split',
        target_id: vineyard.id,
        payload: {
          original_geometry: vineyard.geometry,
          polygon_a: pendingSplit.polygon_a,
          polygon_b: pendingSplit.polygon_b,
          split_line: pendingSplit.split_line,
          notes: pendingSplit.notes || 'Parcel split requested via portal',
        },
      });
      setSplitSubmitStatus('success');
      setPendingSplit(null);
    } catch {
      setSplitSubmitStatus('error');
    }
  }

  async function submitRemove() {
    setRemoveSubmitStatus('submitting');
    try {
      await apiPost('/api/portal/requests', {
        request_type: 'vineyard_remove',
        target_id: vineyard.id,
        payload: {
          action: removeAction,
          notes: removeNotes || (removeAction === 'delete' ? 'Vines pulled up' : 'No longer owned'),
        },
      });
      setRemoveSubmitStatus('success');
      setRemovingParcel(false);
    } catch {
      setRemoveSubmitStatus('error');
    }
  }

  function startRename() {
    setRenameValue(vineyard.vineyard_name || '');
    setRenameStatus(null);
    setRenaming(true);
  }

  async function submitRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === (vineyard.vineyard_name || '')) {
      setRenaming(false);
      return;
    }
    setRenameStatus('submitting');
    try {
      await apiPost('/api/portal/requests', {
        request_type: 'vineyard_rename',
        target_id: vineyard.id,
        payload: { vineyard_name: trimmed },
      });
      setRenameStatus('success');
      setRenaming(false);
      load(); // rename applies immediately — refresh to show the new name
    } catch {
      setRenameStatus('error');
    }
  }

  async function submitAdd() {
    if (!pendingAdd?.geometry) return;
    setAddSubmitStatus('submitting');
    try {
      await apiPost('/api/portal/requests', {
        request_type: 'vineyard_new',
        target_id: vineyard.winery_id,
        payload: {
          geometry: pendingAdd.geometry,
          vineyard_name: pendingAdd.vineyard_name || '',
          ava_name: vineyard.ava_name || '',
          notes: pendingAdd.notes || 'New parcel requested via portal',
        },
      });
      setAddSubmitStatus('success');
      setPendingAdd(null);
      setAddingParcel(false);
    } catch {
      setAddSubmitStatus('error');
    }
  }

  if (loading || !vineyard) {
    return <Shell><p style={{ color: muted }}>Loading…</p></Shell>;
  }

  const ts = vineyard.topo_stats;
  const blockCount = vineyard.blocks?.length ?? 0;

  const terroirChips = [
    { label: 'Blocks', value: blockCount > 0 ? String(blockCount) : '—', tone: 'amber', glow: false },
    {
      label: 'Elevation',
      value: ts?.elevation_mean_ft != null ? `${Math.round(Number(ts.elevation_mean_ft))} ft` : '—',
      subValue: ts?.elevation_min_ft != null
        ? `${Math.round(Number(ts.elevation_min_ft))}–${Math.round(Number(ts.elevation_max_ft))} ft range`
        : null,
      tone: 'parchment', glow: false,
    },
    {
      label: 'Aspect',
      value: ts?.aspect_dominant_deg != null ? degToCardinal(ts.aspect_dominant_deg) : '—',
      subValue: ts?.aspect_dominant_deg != null
        ? `${Math.round(Number(ts.aspect_dominant_deg))}° dom · ${Math.round(Number(ts.aspect_mean_deg))}° avg`
        : null,
      tone: 'blue', glow: true,
    },
    {
      label: 'Slope',
      value: ts?.slope_mean_deg != null ? `${Number(ts.slope_mean_deg).toFixed(1)}°` : '—',
      subValue: ts?.slope_p10_deg != null
        ? `${Number(ts.slope_p10_deg).toFixed(1)}–${Number(ts.slope_p90_deg).toFixed(1)}° range`
        : null,
      tone: 'green', glow: true,
    },
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'var(--font-sans)', background: parchment }}>

      {/* ── Left: sticky map pane ── */}
      {(vineyard.geometry || addingParcel) && (
        <div style={{
          width: '45%', flexShrink: 0, position: 'sticky', top: 0,
          height: '100vh', display: 'flex', flexDirection: 'column',
          borderRight: `1px solid ${border}`,
        }}>
          <PortalVineyardMap
            parcels={parcelsArg}
            blocks={blockFeatures}
            highlightId={vineyard.id}
            selectedBlockId={selectedBlockId}
            onBlockSelect={setSelectedBlockId}
            height="100%"
            style={{ flex: 1 }}
            editParcelId={editingGeometry ? vineyard.id : null}
            onGeometrySave={(parcelId, geometry) => {
              setEditingGeometry(false);
              setPendingGeometry({ geometry, notes: '' });
            }}
            onEditCancel={() => setEditingGeometry(false)}
            splitParcelId={splittingParcel ? vineyard.id : null}
            onSplitLineSave={handleSplitLineSave}
            onSplitCancel={() => setSplittingParcel(false)}
            addMode={addingParcel}
            onAddSave={(geometry) => {
              setAddingParcel(false);
              setPendingAdd({ geometry, vineyard_name: '', notes: '' });
            }}
            onAddCancel={() => setAddingParcel(false)}
            onStartEditBoundary={geometryBusy || !vineyard.geometry ? undefined : () => { setEditingGeometry(true); setGeoSubmitStatus(null); }}
            onStartSplit={geometryBusy || !vineyard.geometry ? undefined : () => { setSplittingParcel(true); setSplitSubmitStatus(null); }}
            onStartAdd={geometryBusy ? undefined : () => { setAddingParcel(true); setAddSubmitStatus(null); }}
            onRemove={geometryBusy ? undefined : () => { setRemovingParcel(true); setRemoveSubmitStatus(null); setRemoveNotes(''); }}
          />

          {/* Pending geometry-action confirmations — overlaid on the map */}
          {(pendingGeometry || pendingSplit || removingParcel || pendingAdd) && (
            <div style={pendingOverlayStyle}>
              {pendingGeometry && (
                <PendingCard
                  title="⚠ Review boundary change"
                  body="Your boundary change will be sent to admin for approval. Add an optional note explaining the correction."
                  notePlaceholder="Optional: describe what changed and why"
                  noteValue={pendingGeometry.notes}
                  onNote={(v) => setPendingGeometry((p) => ({ ...p, notes: v }))}
                  submitLabel="Submit for Review"
                  submitting={geoSubmitStatus === 'submitting'}
                  error={geoSubmitStatus === 'error'}
                  onSubmit={submitGeometry}
                  onDiscard={() => { setPendingGeometry(null); setGeoSubmitStatus(null); }}
                />
              )}
              {pendingSplit && (
                <PendingCard
                  title="✂ Confirm parcel split"
                  body={pendingSplit.polygon_a
                    ? 'Two sub-parcels were computed from your split line. Add an optional note for the admin.'
                    : 'The split line was recorded. Admin will apply the split manually. Add an optional note below.'}
                  notePlaceholder="Optional: e.g. 'Left half is Pinot Noir, right half is Chardonnay'"
                  noteValue={pendingSplit.notes}
                  onNote={(v) => setPendingSplit((p) => ({ ...p, notes: v }))}
                  submitLabel="Submit Split Request"
                  submitting={splitSubmitStatus === 'submitting'}
                  error={splitSubmitStatus === 'error'}
                  onSubmit={submitSplit}
                  onDiscard={() => { setPendingSplit(null); setSplitSubmitStatus(null); }}
                />
              )}
              {pendingAdd && (
                <PendingCard
                  title="+ Review new parcel"
                  body="Give your new parcel a name and any notes for the admin."
                  extraField={(
                    <input
                      type="text"
                      placeholder="Parcel / vineyard name"
                      value={pendingAdd.vineyard_name}
                      onChange={(e) => setPendingAdd((p) => ({ ...p, vineyard_name: e.target.value }))}
                      className="ds-input"
                      style={{ ...textareaStyle, resize: 'none', marginBottom: 8 }}
                    />
                  )}
                  notePlaceholder="Optional: variety, location notes, etc."
                  noteValue={pendingAdd.notes}
                  onNote={(v) => setPendingAdd((p) => ({ ...p, notes: v }))}
                  submitLabel="Submit for Review"
                  submitDisabled={!pendingAdd.vineyard_name.trim()}
                  submitting={addSubmitStatus === 'submitting'}
                  error={addSubmitStatus === 'error'}
                  onSubmit={submitAdd}
                  onDiscard={() => { setPendingAdd(null); setAddSubmitStatus(null); }}
                />
              )}
              {removingParcel && (
                <div style={{ ...pendingCardStyle, border: `1px solid ${alpha(TOKENS.danger, 0.55)}` }}>
                  <p style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: crimson, marginBottom: 8 }}>Remove this parcel</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    {[
                      { value: 'delete', label: 'Delete — vines have been pulled up or parcel no longer exists' },
                      { value: 'unlink', label: 'Unlink — parcel was sold or is no longer associated with my winery' },
                    ].map(({ value, label }) => (
                      <label key={value} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 'var(--type-mono-size)', cursor: 'pointer' }}>
                        <input type="radio" name="removeAction" value={value} checked={removeAction === value} onChange={() => setRemoveAction(value)} style={{ marginTop: 2, accentColor: crimson }} />
                        <span style={{ color: ink }}>{label}</span>
                      </label>
                    ))}
                  </div>
                  <textarea placeholder="Optional: additional notes for the admin" value={removeNotes} onChange={(e) => setRemoveNotes(e.target.value)} rows={2} className="ds-input" style={textareaStyle} />
                  {removeSubmitStatus === 'error' && <p style={{ fontSize: 'var(--type-body-size)', color: crimson, marginBottom: 8 }}>Submission failed — try again.</p>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={submitRemove} disabled={removeSubmitStatus === 'submitting'} style={{ ...smallBtnStyle, background: crimson }}>
                      {removeSubmitStatus === 'submitting' ? 'Submitting…' : 'Submit Request'}
                    </button>
                    <button onClick={() => { setRemovingParcel(false); setRemoveSubmitStatus(null); setRemoveNotes(''); }} style={discardBtnStyle}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Right: scrollable info pane ── */}
      <div style={{
        flex: 1, overflowY: 'auto', background: parchment,
        padding: '0 32px 36px', minWidth: 0, display: 'flex', flexDirection: 'column',
      }}>
        {/* Sticky back button */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: parchment, borderBottom: `1px solid ${border}`,
          padding: '12px 0', marginBottom: 8,
        }}>
          <Link to="/portal/dashboard" style={{ color: muted, fontSize: 'var(--type-mono-size)' }}>← Dashboard</Link>
        </div>

        {/* Success feedback for geometry actions */}
        <StatusBanner statuses={{
          'Boundary update submitted for review': geoSubmitStatus === 'success',
          'Split request submitted for review': splitSubmitStatus === 'success',
          'New parcel submitted for review': addSubmitStatus === 'success',
          'Removal request submitted for review': removeSubmitStatus === 'success',
        }} />

        {/* Title + rename */}
        {renaming ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 4px' }}>
            <input
              type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus
              className="ds-input" style={{ ...INPUT_STYLE, flex: '1 1 240px', minWidth: 0 }}
              onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(false); }}
            />
            <button onClick={submitRename} disabled={renameStatus === 'submitting'} style={smallBtnStyle}>
              {renameStatus === 'submitting' ? 'Submitting…' : 'Submit for Review'}
            </button>
            <button onClick={() => setRenaming(false)} style={discardBtnStyle}>Cancel</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 4px' }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--type-display-italic-size)', color: ink, margin: 0 }}>
              {vineyard.vineyard_name || 'Unnamed Parcel'}
            </h1>
            <button onClick={startRename} style={editNameBtnStyle} title="Rename this vineyard">✎ Edit name</button>
          </div>
        )}
        {renameStatus === 'success' && (
          <p style={{ fontSize: 'var(--type-mono-size)', color: TOKENS.success, fontWeight: 500, marginTop: 4 }}>
            ✓ Name updated
          </p>
        )}
        {renameStatus === 'error' && (
          <p style={{ fontSize: 'var(--type-mono-size)', color: crimson, marginTop: 4 }}>Submission failed — try again.</p>
        )}
        <p style={{ color: muted, fontSize: 'var(--type-mono-size)', marginBottom: 24, marginTop: 8 }}>
          {vineyard.nested_ava || vineyard.ava_name || '—'} · {Number(vineyard.acres || 0).toFixed(1)} acres
        </p>

        {/* Info */}
        <Section title="Vineyard Info">
          <InfoRow label="AVA" value={vineyard.ava_name || '—'} />
          <InfoRow label="Sub-AVA" value={vineyard.nested_ava || '—'} />
          <InfoRow label="Varietals" value={vineyard.varietals_list || '—'} />
        </Section>

        <Section title="Terroir Snapshot">
          <TerroirDataChips chips={terroirChips} columns={2} />
        </Section>

        {/* Blocks — the editable table, with a prominent Edit control in the header */}
        <Section
          title="Blocks"
          action={vineyard.blocks.length > 0 && !editingBlocks ? (
            <button onClick={() => setEditingBlocks(true)} style={smallBtnStyle}>✎ Edit table</button>
          ) : editingBlocks ? (
            <span style={{ fontSize: 'var(--type-mono-size)', color: muted }}>Editing…</span>
          ) : null}
        >
          {vineyard.blocks.length === 0 ? (
            <p style={{ color: muted, fontSize: 'var(--type-mono-size)' }}>No blocks recorded.</p>
          ) : (
            <EditableBlocksTable
              parcelId={vineyard.id}
              blocks={blocksWithNames}
              editMode={editingBlocks}
              selectedBlockId={selectedBlockId}
              onRowSelect={setSelectedBlockId}
              autoApply
              onEditCancel={() => setEditingBlocks(false)}
              onEditComplete={() => { setEditingBlocks(false); load(); }}
            />
          )}
          {!editingBlocks && (
            <p style={{ fontSize: 'var(--type-mono-size)', color: muted, marginTop: 12 }}>
              Table edits (names, varieties, planting details) save immediately. Boundary changes on the map are reviewed by an admin.
            </p>
          )}
        </Section>

        {/* History (collapsed) */}
        <Section title="History &amp; requests" collapsible defaultOpen={false}>
          <ParcelHistorySection parcelId={vineyard.id} />
        </Section>
      </div>
    </div>
  );
}

/* ── Reusable pending-action card (map overlay) ── */
function PendingCard({ title, body, extraField, notePlaceholder, noteValue, onNote, submitLabel, submitDisabled, submitting, error, onSubmit, onDiscard }) {
  return (
    <div style={pendingCardStyle}>
      <p style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: ink, marginBottom: 6 }}>{title}</p>
      <p style={{ fontSize: 'var(--type-body-size)', color: muted, marginBottom: 10 }}>{body}</p>
      {extraField}
      <textarea placeholder={notePlaceholder} value={noteValue} onChange={(e) => onNote(e.target.value)} rows={2} className="ds-input" style={textareaStyle} />
      {error && <p style={{ fontSize: 'var(--type-body-size)', color: crimson, marginBottom: 8 }}>Submission failed — try again.</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onSubmit} disabled={submitting || submitDisabled} style={smallBtnStyle}>
          {submitting ? 'Submitting…' : submitLabel}
        </button>
        <button onClick={onDiscard} style={discardBtnStyle}>Discard</button>
      </div>
    </div>
  );
}

function StatusBanner({ statuses }) {
  const active = Object.entries(statuses).filter(([, v]) => v).map(([k]) => k);
  if (active.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      {active.map((msg) => (
        <p key={msg} style={{ fontSize: 'var(--type-mono-size)', color: TOKENS.success, fontWeight: 500, margin: '2px 0' }}>✓ {msg}</p>
      ))}
    </div>
  );
}

function degToCardinal(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(Number(deg) / 22.5) % 16];
}

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

function Section({ title, children, action, collapsible = false, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;
  return (
    <div style={{
      background: parchment, borderRadius: 10, padding: '20px 16px',
      border: `1px solid ${border}`, marginBottom: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isOpen ? 12 : 0, gap: 8 }}>
        <h2
          style={{ fontSize: 'var(--type-display-italic-size)', fontWeight: 600, color: ink, margin: 0, cursor: collapsible ? 'pointer' : 'default', userSelect: 'none' }}
          onClick={collapsible ? () => setOpen((o) => !o) : undefined}
        >
          {collapsible && <span style={{ color: muted, marginRight: 6, fontSize: 14 }}>{isOpen ? '▾' : '▸'}</span>}
          {title}
        </h2>
        {action}
      </div>
      {isOpen && children}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 6, fontSize: 'var(--type-mono-size)' }}>
      <span style={{ color: muted, minWidth: 80, flexShrink: 0 }}>{label}</span>
      <span style={{ color: ink }}>{value}</span>
    </div>
  );
}

const smallBtnStyle = {
  ...btn('primary', { padding: '6px 16px' }),
  cursor: 'pointer',
};

const discardBtnStyle = {
  ...smallBtnStyle,
  background: 'transparent',
  color: muted,
  border: `1px solid ${border}`,
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

const pendingOverlayStyle = {
  position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 20,
  maxHeight: 'calc(100% - 24px)', overflowY: 'auto',
};

const pendingCardStyle = {
  background: parchment,
  border: `1px solid ${alpha(TOKENS.warning, 0.55)}`,
  borderRadius: 8,
  padding: '14px 16px',
  marginBottom: 12,
  boxShadow: `0 8px 24px ${alpha(ink, 0.28)}`,
};

const textareaStyle = {
  ...INPUT_STYLE,
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  resize: 'vertical',
  marginBottom: 10,
};
