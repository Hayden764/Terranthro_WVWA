import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import lineSplit from '@turf/line-split';
import { lineString, polygon as turfPolygon, feature as turfFeature } from '@turf/helpers';
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

  // Edit boundary
  const [editingGeometry, setEditingGeometry] = useState(false);
  const [editingBlocks, setEditingBlocks] = useState(false);
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
        // Line didn't fully cross the parcel — keep raw for admin to handle
        setPendingSplit({
          polygon_a: null,
          polygon_b: null,
          split_line: lineGeometry,
          notes: '',
        });
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

  const elevationMean = vineyard.topo_stats?.elevation_mean_ft != null
    ? `${Math.round(Number(vineyard.topo_stats.elevation_mean_ft))} ft`
    : null;

  const gst = vineyard.gst_f ?? vineyard.growing_season_temp_f ?? null;
  const gstValue = gst != null ? `${Number(gst).toFixed(1)}°F` : null;

  const winkler = vineyard.winkler_index ?? vineyard.gdd ?? null;
  const winklerValue = winkler != null ? Number(winkler).toLocaleString('en-US') : null;

  const soil = vineyard.soil_series || vineyard.soil_type || vineyard.soil || null;

  const ts = vineyard.topo_stats;
  const blockCount = vineyard.blocks?.length ?? 0;

  const terroirChips = [
    // Top-left: Blocks
    {
      label: 'Blocks',
      value: blockCount > 0 ? String(blockCount) : '—',
      tone: 'amber',
      glow: false,
    },
    // Top-right: Elevation
    {
      label: 'Elevation',
      value: ts?.elevation_mean_ft != null ? `${Math.round(Number(ts.elevation_mean_ft))} ft` : '—',
      subValue: ts?.elevation_min_ft != null
        ? `${Math.round(Number(ts.elevation_min_ft))}–${Math.round(Number(ts.elevation_max_ft))} ft range`
        : null,
      tone: 'parchment',
      glow: false,
    },
    // Bottom-left: Aspect
    {
      label: 'Aspect',
      value: ts?.aspect_dominant_deg != null ? degToCardinal(ts.aspect_dominant_deg) : '—',
      subValue: ts?.aspect_dominant_deg != null
        ? `${Math.round(Number(ts.aspect_dominant_deg))}° dom · ${Math.round(Number(ts.aspect_mean_deg))}° avg`
        : null,
      tone: 'blue',
      glow: true,
    },
    // Bottom-right: Slope
    {
      label: 'Slope',
      value: ts?.slope_mean_deg != null ? `${Number(ts.slope_mean_deg).toFixed(1)}°` : '—',
      subValue: ts?.slope_p10_deg != null
        ? `${Number(ts.slope_p10_deg).toFixed(1)}–${Number(ts.slope_p90_deg).toFixed(1)}° range`
        : null,
      tone: 'green',
      glow: true,
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
            parcels={vineyard.geometry ? [vineyard] : []}
            highlightId={vineyard.id}
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
          />
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
            <button onClick={() => setRenaming(false)} style={discardBtnStyle}>Cancel</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 4px' }}>
            <h1 style={{
              fontFamily: 'var(--font-display)', fontSize: 'var(--type-display-italic-size)', color: ink, margin: 0,
            }}>
              {vineyard.vineyard_name || 'Unnamed Parcel'}
            </h1>
            <button
              onClick={startRename}
              style={editNameBtnStyle}
              title="Rename this vineyard"
            >
              ✎ Edit name
            </button>
          </div>
        )}
        {renameStatus === 'success' && (
          <p style={{ fontSize: 'var(--type-mono-size)', color: TOKENS.success, fontWeight: 500, marginTop: 4 }}>
            ✓ Name change submitted for review (applies to all parcels in this vineyard once approved)
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
          <InfoRow label="Address" value={[vineyard.situs_address, vineyard.situs_city, vineyard.situs_zip].filter(Boolean).join(', ') || '—'} />
          <InfoRow label="Owner" value={vineyard.owner_name || '—'} />
          <InfoRow label="Varietals" value={vineyard.varietals_list || '—'} />
        </Section>

        <Section title="Terroir Snapshot">
          <TerroirDataChips chips={terroirChips} columns={2} />
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
            <p style={{ color: muted, fontSize: 'var(--type-mono-size)' }}>No blocks recorded.</p>
          ) : (
            <EditableBlocksTable
              parcelId={vineyard.id}
              blocks={vineyard.blocks}
              editMode={editingBlocks}
              onEditCancel={() => setEditingBlocks(false)}
              onEditComplete={() => setEditingBlocks(false)}
            />
          )}
        </Section>

        {/* Request Changes */}
        <Section title="Request Changes">
          <p style={{ color: muted, fontSize: 'var(--type-mono-size)', marginBottom: 16 }}>
            All changes are submitted for admin review before being applied.
          </p>

          {/* Geometry edit flow */}
          {vineyard.geometry && !pendingGeometry && (
            <div style={{ marginBottom: 16 }}>
              {geoSubmitStatus === 'success' ? (
                <p style={{ fontSize: 'var(--type-mono-size)', color: TOKENS.success, fontWeight: 500 }}>✓ Geometry update submitted for review</p>
              ) : (
                <>
                  <p style={{ fontSize: 'var(--type-mono-size)', color: muted, marginBottom: 8 }}>
                    To correct the parcel boundary, click below — the map will enter edit mode so you can drag vertices.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Pending geometry confirmation */}
          {pendingGeometry && (
            <div style={pendingCardStyle}>
              <p style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: ink, marginBottom: 6 }}>
                ⚠ Review before submitting
              </p>
              <p style={{ fontSize: 'var(--type-body-size)', color: muted, marginBottom: 10 }}>
                Your boundary change will be sent to admin for approval. Add an optional note explaining the correction.
              </p>
              <textarea
                placeholder="Optional: describe what changed and why"
                value={pendingGeometry.notes}
                onChange={(e) => setPendingGeometry((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                className="ds-input"
                style={textareaStyle}
              />
              {geoSubmitStatus === 'error' && (
                <p style={{ fontSize: 'var(--type-body-size)', color: crimson, marginBottom: 8 }}>Submission failed — try again.</p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={submitGeometry} disabled={geoSubmitStatus === 'submitting'} style={smallBtnStyle}>
                  {geoSubmitStatus === 'submitting' ? 'Submitting…' : 'Submit for Review'}
                </button>
                <button
                  onClick={() => { setPendingGeometry(null); setGeoSubmitStatus(null); }}
                  style={discardBtnStyle}
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* Pending split confirmation */}
          {pendingSplit && (
            <div style={pendingCardStyle}>
              <p style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: ink, marginBottom: 6 }}>
                ✂ Confirm parcel split
              </p>
              <p style={{ fontSize: 'var(--type-body-size)', color: muted, marginBottom: 10 }}>
                {pendingSplit.polygon_a
                  ? 'Two sub-parcels were computed from your split line. Add an optional note for the admin.'
                  : 'The split line was recorded. Admin will apply the split manually. Add an optional note below.'}
              </p>
              <textarea
                placeholder="Optional: e.g. 'Left half is Pinot Noir, right half is Chardonnay'"
                value={pendingSplit.notes}
                onChange={(e) => setPendingSplit((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                className="ds-input"
                style={textareaStyle}
              />
              {splitSubmitStatus === 'error' && (
                <p style={{ fontSize: 'var(--type-body-size)', color: crimson, marginBottom: 8 }}>Submission failed — try again.</p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={submitSplit} disabled={splitSubmitStatus === 'submitting'} style={smallBtnStyle}>
                  {splitSubmitStatus === 'submitting' ? 'Submitting…' : 'Submit Split Request'}
                </button>
                <button
                  onClick={() => { setPendingSplit(null); setSplitSubmitStatus(null); }}
                  style={discardBtnStyle}
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* Remove / unlink confirmation */}
          {removingParcel && (
            <div style={{ ...pendingCardStyle, borderColor: alpha(TOKENS.danger, 0.35), background: TOKENS.dangerDim, marginBottom: 16 }}>
              <p style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: crimson, marginBottom: 8 }}>
                Remove this parcel
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {[
                  { value: 'delete', label: 'Delete — vines have been pulled up or parcel no longer exists' },
                  { value: 'unlink', label: 'Unlink — parcel was sold or is no longer associated with my winery' },
                ].map(({ value, label }) => (
                  <label key={value} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 'var(--type-mono-size)', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="removeAction"
                      value={value}
                      checked={removeAction === value}
                      onChange={() => setRemoveAction(value)}
                      style={{ marginTop: 2, accentColor: crimson }}
                    />
                    <span style={{ color: ink }}>{label}</span>
                  </label>
                ))}
              </div>
              <textarea
                placeholder="Optional: additional notes for the admin"
                value={removeNotes}
                onChange={(e) => setRemoveNotes(e.target.value)}
                rows={2}
                className="ds-input"
                style={textareaStyle}
              />
              {removeSubmitStatus === 'error' && (
                <p style={{ fontSize: 'var(--type-body-size)', color: crimson, marginBottom: 8 }}>Submission failed — try again.</p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={submitRemove} disabled={removeSubmitStatus === 'submitting'} style={{ ...smallBtnStyle, background: crimson }}>
                  {removeSubmitStatus === 'submitting' ? 'Submitting…' : 'Submit Request'}
                </button>
                <button
                  onClick={() => { setRemovingParcel(false); setRemoveSubmitStatus(null); setRemoveNotes(''); }}
                  style={discardBtnStyle}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Add parcel confirmation */}
          {pendingAdd && (
            <div style={pendingCardStyle}>
              <p style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: ink, marginBottom: 6 }}>
                + Review new parcel
              </p>
              <p style={{ fontSize: 'var(--type-body-size)', color: muted, marginBottom: 10 }}>
                Give your new parcel a name and any notes for the admin.
              </p>
              <input
                type="text"
                placeholder="Parcel / vineyard name"
                value={pendingAdd.vineyard_name}
                onChange={(e) => setPendingAdd((p) => ({ ...p, vineyard_name: e.target.value }))}
                className="ds-input"
                style={{ ...textareaStyle, resize: 'none', marginBottom: 8 }}
              />
              <textarea
                placeholder="Optional: variety, location notes, etc."
                value={pendingAdd.notes}
                onChange={(e) => setPendingAdd((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                className="ds-input"
                style={textareaStyle}
              />
              {addSubmitStatus === 'error' && (
                <p style={{ fontSize: 'var(--type-body-size)', color: crimson, marginBottom: 8 }}>Submission failed — try again.</p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={submitAdd} disabled={addSubmitStatus === 'submitting' || !pendingAdd.vineyard_name.trim()} style={smallBtnStyle}>
                  {addSubmitStatus === 'submitting' ? 'Submitting…' : 'Submit for Review'}
                </button>
                <button
                  onClick={() => { setPendingAdd(null); setAddSubmitStatus(null); }}
                  style={discardBtnStyle}
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* ── Action button row ── */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            {/* Edit Boundary */}
            {vineyard.geometry && !pendingGeometry && geoSubmitStatus !== 'success' && (
              editingGeometry ? (
                <span style={{ fontSize: 'var(--type-mono-size)', color: muted, alignSelf: 'center' }}>Editing on map…</span>
              ) : (
                <button onClick={() => { setEditingGeometry(true); setGeoSubmitStatus(null); }} style={smallBtnStyle}>
                  Edit Boundary
                </button>
              )
            )}

            {/* Edit Block Info */}
            {editingBlocks ? (
              <span style={{ fontSize: 'var(--type-mono-size)', color: muted, alignSelf: 'center' }}>
                Editing block info above…
              </span>
            ) : (
              <button onClick={() => setEditingBlocks(true)} style={smallBtnStyle}>
                Edit Block Info
              </button>
            )}

            {/* Split Parcel */}
            {vineyard.geometry && !pendingSplit && splitSubmitStatus !== 'success' && (
              splittingParcel ? (
                <span style={{ fontSize: 'var(--type-mono-size)', color: muted, alignSelf: 'center' }}>Drawing split line…</span>
              ) : (
                <button onClick={() => { setSplittingParcel(true); setSplitSubmitStatus(null); }} style={smallBtnStyle}>
                  Split Parcel
                </button>
              )
            )}
            {splitSubmitStatus === 'success' && (
              <span style={{ fontSize: 'var(--type-mono-size)', color: TOKENS.success, fontWeight: 500 }}>✓ Split request submitted</span>
            )}

            {/* Add Parcel */}
            {!pendingAdd && addSubmitStatus !== 'success' && (
              addingParcel ? (
                <span style={{ fontSize: 'var(--type-mono-size)', color: muted, alignSelf: 'center' }}>Drawing on map…</span>
              ) : (
                <button onClick={() => { setAddingParcel(true); setAddSubmitStatus(null); }} style={smallBtnStyle}>
                  Add Parcel
                </button>
              )
            )}
            {addSubmitStatus === 'success' && (
              <span style={{ fontSize: 'var(--type-mono-size)', color: TOKENS.success, fontWeight: 500 }}>✓ New parcel submitted for review</span>
            )}

            {/* Remove / Unlink */}
            {!removingParcel && removeSubmitStatus !== 'success' && (
              <button
                onClick={() => { setRemovingParcel(true); setRemoveSubmitStatus(null); setRemoveNotes(''); }}
                style={{ ...smallBtnStyle, background: 'transparent', color: crimson, border: `1px solid ${crimson}` }}
              >
                Remove / Unlink
              </button>
            )}
            {removeSubmitStatus === 'success' && (
              <span style={{ fontSize: 'var(--type-mono-size)', color: TOKENS.success, fontWeight: 500 }}>✓ Removal request submitted</span>
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
    return <span style={{ fontSize: 'var(--type-mono-size)', color: TOKENS.success, fontWeight: 500 }}>✓ Submitted</span>;
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
          width: '100%',
          padding: '8px 12px',
          resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={handleSubmit} disabled={submitting || !value.trim()} style={smallBtnStyle}>
          {submitting ? '…' : 'Submit'}
        </button>
        <button onClick={() => setOpen(false)} style={{ ...smallBtnStyle, background: 'transparent', color: muted, border: `1px solid ${border}` }}>
          Cancel
        </button>
      </div>
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

function Section({ title, children }) {
  return (
    <div style={{
      background: parchment, borderRadius: 10, padding: '20px 16px',
      border: `1px solid ${border}`, marginBottom: 20,
    }}>
      <h2 style={{ fontSize: 'var(--type-display-italic-size)', fontWeight: 600, color: ink, marginBottom: 12 }}>{title}</h2>
      {children}
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

const pendingCardStyle = {
  background: TOKENS.warningDim,
  border: `1px solid ${alpha(TOKENS.warning, 0.45)}`,
  borderRadius: 8,
  padding: '14px 16px',
  marginBottom: 16,
};

const textareaStyle = {
  ...INPUT_STYLE,
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  resize: 'vertical',
  marginBottom: 10,
};
