import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { alpha, ink, muted, border, parchment, crimson, TOKENS } from '../../styles/tokens';
import { apiJson, apiFetch } from '../../lib/api';
import EditableBlocksTable from '../../components/EditableBlocksTable';
import ParcelHistorySection from '../../components/ParcelHistorySection';
import TerroirDataChips from '../../components/TerroirDataChips';
import PortalVineyardMap from '../../components/PortalVineyardMap';
import SplitVineyardModal from '../../components/admin/SplitVineyardModal';
import SplitParcelModal from '../../components/admin/SplitParcelModal';

export default function AdminVineyardBlockDetail() {
  const { parcelId } = useParams();
  const navigate = useNavigate();

  const [parcel, setParcel] = useState(null);
  const [siblings, setSiblings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingBlocks, setEditingBlocks] = useState(false);
  const [applyStatus, setApplyStatus] = useState(null);
  const [showSplit, setShowSplit] = useState(false);
  const [showSplitParcel, setShowSplitParcel] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, sibs] = await Promise.all([
        apiJson(`/api/admin/vineyards/${parcelId}/blocks`),
        apiJson(`/api/admin/vineyards/${parcelId}/siblings`),
      ]);
      setParcel(data.parcel);
      setSiblings(sibs);
    } catch {
      navigate('/admin/blocks', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [parcelId, navigate]);

  useEffect(() => { load(); }, [load]);

  async function handleDirectApply(payload) {
    const res = await apiFetch(`/api/admin/vineyards/${parcelId}/blocks/apply`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Server error');
    }
    setApplyStatus('success');
    setEditingBlocks(false);
    const fresh = await apiJson(`/api/admin/vineyards/${parcelId}/blocks`);
    setParcel(fresh.parcel);
    // Refresh sibling block counts too
    const sibs = await apiJson(`/api/admin/vineyards/${parcelId}/siblings`);
    setSiblings(sibs);
  }

  if (loading || !parcel) {
    return (
      <div style={{ minHeight: '100vh', background: parchment, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-sans)' }}>
        <p style={{ color: muted }}>Loading…</p>
      </div>
    );
  }

  const ts = parcel.topo_stats;
  const blocks = parcel.blocks || [];
  const hasMultipleParcels = siblings.length > 1;

  // Derive a display label from block names when no explicit parcel_label is set.
  // Single named block → use that name. Multiple → comma-join up to 3 names.
  const derivedBlockLabel = (() => {
    if (parcel.parcel_label && parcel.parcel_label.trim()) return null; // explicit label wins
    const named = blocks.map((b) => b.block_name).filter(Boolean);
    if (named.length === 0) return null;
    if (named.length <= 3) return named.join(', ');
    return `${named.slice(0, 3).join(', ')} +${named.length - 3}`;
  })();

  // Build map parcel list: prefer geometry from the loaded parcel for the active one,
  // and use sibling geometries for the rest. Inject derived label for the active parcel.
  const mapParcels = siblings.map((s) =>
    s.id === parcel.id
      ? {
          ...s,
          geometry: parcel.geometry,
          vineyard_name: parcel.vineyard_name,
          parcel_label: parcel.parcel_label || derivedBlockLabel,
        }
      : s
  );

  const terroirChips = [
    {
      label: 'Blocks',
      value: blocks.length > 0 ? String(blocks.length) : '—',
      tone: 'amber',
      glow: false,
    },
    {
      label: 'Elevation',
      value: ts?.elevation_mean_ft != null ? `${Math.round(Number(ts.elevation_mean_ft))} ft` : '—',
      subValue: ts?.elevation_min_ft != null
        ? `${Math.round(Number(ts.elevation_min_ft))}–${Math.round(Number(ts.elevation_max_ft))} ft range`
        : null,
      tone: 'parchment',
      glow: false,
    },
    {
      label: 'Aspect',
      value: ts?.aspect_dominant_deg != null ? degToCardinal(ts.aspect_dominant_deg) : '—',
      subValue: ts?.aspect_dominant_deg != null
        ? `${Math.round(Number(ts.aspect_dominant_deg))}° dom · ${Math.round(Number(ts.aspect_mean_deg))}° avg`
        : null,
      tone: 'blue',
      glow: true,
    },
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
      {parcel.geometry && (
        <div style={{
          width: '40%', flexShrink: 0, position: 'sticky', top: 0,
          height: '100vh', display: 'flex', flexDirection: 'column',
          borderRight: `1px solid ${border}`,
        }}>
          <PortalVineyardMap
            parcels={mapParcels}
            highlightId={parcel.id}
            height="100%"
            style={{ flex: 1 }}
            onParcelClick={(p) => {
              if (p.id !== parcel.id) navigate(`/admin/blocks/${p.id}`);
            }}
          />
          {/* Split Parcel button — only show when a single polygon */}
          <div style={{
            padding: '8px 12px',
            borderTop: `1px solid ${border}`,
            background: parchment,
          }}>
            <button
              onClick={() => setShowSplitParcel(true)}
              style={{
                width: '100%',
                padding: '7px 12px',
                borderRadius: 6,
                border: `1px solid ${alpha(ink, 0.2)}`,
                background: 'transparent',
                color: muted,
                fontSize: 'var(--type-ui-label-size)',
                fontWeight: 600,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              ✂ Split Parcel Geometry
            </button>
          </div>
        </div>
      )}

      {/* ── Right: scrollable info pane ── */}
      <div style={{
        flex: 1, overflowY: 'auto', background: parchment,
        padding: '0 32px 48px', minWidth: 0,
      }}>
        {/* Sticky nav */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: parchment, borderBottom: `1px solid ${border}`,
          padding: '12px 0', marginBottom: 8,
          display: 'flex', gap: 10, alignItems: 'center',
        }}>
          <Link to="/admin/blocks" style={crumbStyle}>← Block Manager</Link>
          <span style={{ color: alpha(ink, 0.2) }}>|</span>
          <Link to="/admin/dashboard" style={crumbStyle}>Dashboard</Link>
          {parcel.winery_id && (
            <>
              <span style={{ color: alpha(ink, 0.2) }}>|</span>
              <Link
                to={`/admin/wineries/${parcel.winery_id}/bulk-blocks`}
                style={{ ...crumbStyle, color: TOKENS.electricBlue }}
              >
                ⇪ Bulk Import CSV
              </Link>
            </>
          )}
        </div>

        {/* Heading */}
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--type-display-italic-size)',
          color: ink,
          margin: '16px 0 4px',
        }}>
          {parcel.vineyard_name || 'Unnamed Parcel'}
          {parcel.parcel_label && (
            <span style={{
              marginLeft: 12,
              fontSize: 'var(--type-subhead-size)',
              color: TOKENS.amber,
              fontStyle: 'italic',
              fontFamily: 'var(--font-sans)',
            }}>
              · {parcel.parcel_label}
            </span>
          )}
        </h1>
        <p style={{ color: muted, fontSize: 'var(--type-mono-size)', marginBottom: 20 }}>
          {[parcel.nested_ava || parcel.ava_name,
            hasMultipleParcels
              ? `${siblings.length} parcels · ${siblings.reduce((sum, s) => sum + Number(s.acres || 0), 0).toFixed(1)} ac total`
              : (parcel.acres ? `${Number(parcel.acres).toFixed(1)} ac` : null)
          ].filter(Boolean).join(' · ') || '—'}
          {parcel.winery_name !== 'Independent' && (
            <span style={{ marginLeft: 8 }}>· {parcel.winery_name}</span>
          )}
        </p>

        {/* Parcel picker (only if vineyard has multiple parcels) */}
        {hasMultipleParcels && (
          <ParcelPicker
            siblings={siblings}
            activeId={parcel.id}
            onSelect={(id) => navigate(`/admin/blocks/${id}`)}
            onSplitClick={() => setShowSplit(true)}
          />
        )}

        {/* Vineyard Info */}
        <Section title="Parcel Info">
          <InfoRow label="AVA" value={parcel.ava_name || '—'} />
          <InfoRow label="Sub-AVA" value={parcel.nested_ava || '—'} />
          <InfoRow label="Address" value={[parcel.situs_address, parcel.situs_city, parcel.situs_zip].filter(Boolean).join(', ') || '—'} />
          <InfoRow label="Owner" value={parcel.owner_name || '—'} />
          <InfoRow label="Winery" value={parcel.winery_name} />
          <InfoRow label="Varietals" value={parcel.varietals_list || '—'} />
          <InfoRow label="Acres" value={parcel.acres ? Number(parcel.acres).toFixed(2) : '—'} />
          <InfoRow label="Parcel ID" value={`#${parcel.id}`} />
          <ParcelLabelRow
            parcel={parcel}
            derivedBlockLabel={derivedBlockLabel}
            onSaved={async (newLabel) => {
              setParcel((p) => ({ ...p, parcel_label: newLabel }));
              // Refresh siblings so picker + map labels update too.
              const sibs = await apiJson(`/api/admin/vineyards/${parcelId}/siblings`);
              setSiblings(sibs);
            }}
          />
        </Section>

        {/* Terroir Snapshot */}
        <Section title="Terroir Snapshot">
          <TerroirDataChips chips={terroirChips} columns={2} />
        </Section>

        {/* Topography */}
        {ts && (
          <Section title="Topography">
            <InfoRow label="Elevation" value={`${Math.round(Number(ts.elevation_min_ft))}–${Math.round(Number(ts.elevation_max_ft))} ft (avg ${Math.round(Number(ts.elevation_mean_ft))} ft)`} />
            <InfoRow label="Slope" value={`${Number(ts.slope_mean_deg).toFixed(1)}° avg, ${Number(ts.slope_max_deg).toFixed(1)}° max`} />
            <InfoRow label="Aspect" value={`${degToCardinal(ts.aspect_dominant_deg)} (${Math.round(Number(ts.aspect_dominant_deg))}°)`} />
          </Section>
        )}

        {/* Blocks */}
        <Section title={
          <span>
            Blocks
            {blocks.length > 0 && (
              <span style={{
                marginLeft: 10,
                padding: '2px 9px',
                borderRadius: 10,
                background: alpha(TOKENS.amber, 0.15),
                color: TOKENS.amber,
                fontSize: 'var(--type-ui-label-size)',
                fontWeight: 600,
                verticalAlign: 'middle',
              }}>
                {blocks.length}
              </span>
            )}
          </span>
        }>
          {applyStatus === 'success' && !editingBlocks && (
            <p style={{ color: TOKENS.success, fontSize: 'var(--type-body-size)', marginBottom: 12 }}>
              ✓ Changes applied
            </p>
          )}

          {blocks.length === 0 && !editingBlocks ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <p style={{ color: muted, fontSize: 'var(--type-mono-size)', marginBottom: 12 }}>
                No blocks recorded for this parcel.
              </p>
              <button onClick={() => { setEditingBlocks(true); setApplyStatus(null); }} style={editBtnStyle}>
                + Add Blocks
              </button>
            </div>
          ) : (
            <>
              {!editingBlocks && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <button
                    onClick={() => { setEditingBlocks(true); setApplyStatus(null); }}
                    style={editBtnStyle}
                  >
                    ✎ Edit Blocks
                  </button>
                </div>
              )}
              <EditableBlocksTable
                parcelId={parseInt(parcelId, 10)}
                blocks={blocks}
                editMode={editingBlocks}
                allowDelete={true}
                onDirectApply={handleDirectApply}
                onEditCancel={() => { setEditingBlocks(false); setApplyStatus(null); }}
                onEditComplete={() => { setEditingBlocks(false); }}
              />
            </>
          )}
        </Section>

        {/* Edit History */}
        <Section title="Edit History">
          <ParcelHistorySection parcelId={parseInt(parcelId, 10)} />
        </Section>
      </div>

      {/* Split-parcel-geometry modal */}
      {showSplitParcel && parcel && (
        <SplitParcelModal
          parcel={{ ...parcel, geometry: parcel.geometry }}
          blocks={parcel.blocks || []}
          onClose={() => setShowSplitParcel(false)}
          onApplied={({ parcel_a_id }) => {
            setShowSplitParcel(false);
            navigate(`/admin/blocks/${parcel_a_id}`, { replace: true });
          }}
        />
      )}

      {/* Split-vineyard modal */}
      {showSplit && (
        <SplitVineyardModal
          parcelId={parcel.id}
          siblings={siblings}
          currentName={parcel.vineyard_name}
          onClose={() => setShowSplit(false)}
          onApplied={async () => {
            setShowSplit(false);
            // Reload parcel + siblings; this parcel may now be in a smaller group.
            await load();
          }}
        />
      )}
    </div>
  );
}

/* ── Parcel picker ── */
function ParcelPicker({ siblings, activeId, onSelect, onSplitClick }) {
  return (
    <div style={{
      background: alpha(ink, 0.03),
      border: `1px solid ${border}`,
      borderRadius: 10,
      padding: '12px 14px',
      marginBottom: 20,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 8, gap: 8, flexWrap: 'wrap',
      }}>
        <p style={{
          margin: 0,
          fontSize: 'var(--type-ui-label-size)',
          fontWeight: 600,
          color: muted,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          Parcels in this vineyard ({siblings.length})
        </p>
        {onSplitClick && (
          <button
            onClick={onSplitClick}
            title="Rename a subset of these parcels to break this vineyard into multiple vineyards"
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: `1px solid ${alpha(TOKENS.amber, 0.4)}`,
              background: alpha(TOKENS.amber, 0.12),
              color: TOKENS.amber,
              fontSize: 'var(--type-mono-size)',
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            ⎇ Split Vineyard
          </button>
        )}
      </div>
      <div style={{
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        maxHeight: 140,
        overflowY: 'auto',
      }}>
        {siblings.map((s, idx) => {
          const isActive = s.id === activeId;
          const customLabel = s.parcel_label && s.parcel_label.trim();
          const fallbackLabel = `#${idx + 1}`;
          const tooltipBase = s.situs_address || `Parcel #${s.id}`;
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              title={`${customLabel ? `${customLabel} \u2014 ` : ''}${tooltipBase}${s.acres ? ` · ${Number(s.acres).toFixed(1)} ac` : ''}${s.block_count > 0 ? ` · ${s.block_count} blocks` : ''}`}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: isActive
                  ? `1px solid ${TOKENS.crimson}`
                  : `1px solid ${border}`,
                background: isActive ? TOKENS.crimson : 'transparent',
                color: isActive ? parchment : ink,
                fontSize: 'var(--type-mono-size)',
                fontFamily: 'var(--font-sans)',
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>{customLabel || fallbackLabel}</span>
              {s.block_count > 0 && (
                <span style={{
                  display: 'inline-block',
                  padding: '0 6px',
                  borderRadius: 8,
                  background: isActive ? alpha(parchment, 0.2) : alpha(TOKENS.amber, 0.18),
                  color: isActive ? parchment : TOKENS.amber,
                  fontSize: 10,
                  fontWeight: 700,
                }}>
                  {s.block_count}
                </span>
              )}
              <span style={{ color: isActive ? alpha(parchment, 0.75) : muted, fontSize: 11 }}>
                {s.acres ? `${Number(s.acres).toFixed(1)}ac` : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Helpers ── */
function degToCardinal(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(Number(deg) / 22.5) % 16];
}

function Section({ title, children }) {
  return (
    <div style={{
      background: parchment, borderRadius: 10, padding: '20px 16px',
      border: `1px solid ${border}`, marginBottom: 20,
    }}>
      <h2 style={{ fontSize: 'var(--type-subhead-size)', fontWeight: 600, color: ink, margin: '0 0 14px' }}>
        {title}
      </h2>
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

/**
 * Per-parcel display label editor. Saves via PATCH and bubbles the new value
 * up so the heading, picker, and map can refresh.
 */
function ParcelLabelRow({ parcel, derivedBlockLabel, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(parcel.parcel_label || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Re-seed when the parcel changes (navigation between siblings).
  useEffect(() => {
    setValue(parcel.parcel_label || '');
    setEditing(false);
    setError(null);
  }, [parcel.id, parcel.parcel_label]);

  // When user opens the editor with no label, pre-fill with block-derived suggestion.
  function openEditor() {
    if (!parcel.parcel_label && derivedBlockLabel) {
      setValue(derivedBlockLabel);
    }
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const trimmed = value.trim();
      const res = await apiFetch(`/api/admin/vineyards/${parcel.id}/label`, {
        method: 'PATCH',
        body: JSON.stringify({ parcel_label: trimmed || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Server error');
      }
      setEditing(false);
      onSaved?.(trimmed || null);
    } catch (e) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 6, fontSize: 'var(--type-mono-size)', alignItems: 'center' }}>
      <span style={{ color: muted, minWidth: 80, flexShrink: 0 }}>Block Label</span>
      {editing ? (
        <>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. Block 7B, West Hill A…"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') { setEditing(false); setValue(parcel.parcel_label || ''); }
            }}
            style={{
              flex: 1,
              maxWidth: 280,
              padding: '4px 8px',
              border: `1px solid ${border}`,
              borderRadius: 4,
              background: parchment,
              color: ink,
              fontSize: 'var(--type-mono-size)',
              fontFamily: 'var(--font-sans)',
            }}
          />
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: '4px 10px', borderRadius: 4, border: 'none',
              background: TOKENS.amber, color: ink, fontWeight: 600,
              fontSize: 11, cursor: saving ? 'wait' : 'pointer',
            }}
          >
            {saving ? '…' : 'Save'}
          </button>
          <button
            onClick={() => { setEditing(false); setValue(parcel.parcel_label || ''); setError(null); }}
            style={{
              padding: '4px 10px', borderRadius: 4,
              border: `1px solid ${border}`, background: 'transparent',
              color: muted, fontSize: 11, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          {error && <span style={{ color: crimson, fontSize: 11 }}>{error}</span>}
        </>
      ) : (
        <>
          <span style={{
            color: (parcel.parcel_label || derivedBlockLabel) ? ink : muted,
            fontStyle: parcel.parcel_label ? 'normal' : 'italic',
          }}>
            {parcel.parcel_label || (derivedBlockLabel
              ? <span title="Auto-derived from block names — click Edit to confirm">{derivedBlockLabel} <span style={{ color: TOKENS.amber, fontSize: 10 }}>(from blocks)</span></span>
              : 'not set'
            )}
          </span>
          <button
            onClick={openEditor}
            title="Set a custom label that will appear on the map and parcel picker"
            style={{
              padding: '2px 8px', borderRadius: 4,
              border: `1px solid ${alpha(TOKENS.electricBlue, 0.35)}`,
              background: 'transparent',
              color: TOKENS.electricBlue, fontSize: 11,
              fontFamily: 'var(--font-sans)', cursor: 'pointer',
            }}
          >
            ✎ {parcel.parcel_label ? 'Edit' : derivedBlockLabel ? 'Confirm' : 'Set'}
          </button>
        </>
      )}
    </div>
  );
}

/* ── Styles ── */
const crumbStyle = {
  color: muted,
  fontSize: 'var(--type-mono-size)',
  textDecoration: 'none',
};

const editBtnStyle = {
  padding: '7px 18px',
  borderRadius: 6,
  border: `1px solid ${alpha(TOKENS.electricBlue, 0.35)}`,
  background: alpha(TOKENS.electricBlue, 0.1),
  color: TOKENS.electricBlue,
  fontSize: 'var(--type-mono-size)',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};
