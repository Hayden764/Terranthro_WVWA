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
  // siblings = the vineyard's blocks (post-018). Render each block polygon on
  // the map, labeled by block_name.
  const geomBlocks = siblings.filter((s) => s.geometry);
  const hasMultipleBlocks = geomBlocks.length > 1;

  const mapParcels = geomBlocks.length > 0
    ? geomBlocks.map((s) => ({
        ...s,
        vineyard_name: parcel.vineyard_name,
        parcel_label: s.block_name,
      }))
    : [{ id: parcel.id, geometry: parcel.geometry, vineyard_name: parcel.vineyard_name, acres: parcel.acres }];

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
            height="100%"
            style={{ flex: 1 }}
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
              ✂ Split Block Geometry
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
          {parcel.vineyard_name || 'Unnamed Vineyard'}
        </h1>
        <p style={{ color: muted, fontSize: 'var(--type-mono-size)', marginBottom: 20 }}>
          {[parcel.nested_ava || parcel.ava_name,
            hasMultipleBlocks
              ? `${geomBlocks.length} blocks · ${parcel.acres ? Number(parcel.acres).toFixed(1) : geomBlocks.reduce((sum, s) => sum + Number(s.acres || 0), 0).toFixed(1)} ac`
              : (parcel.acres ? `${Number(parcel.acres).toFixed(1)} ac` : null)
          ].filter(Boolean).join(' · ') || '—'}
          {parcel.winery_name !== 'Independent' && (
            <span style={{ marginLeft: 8 }}>· {parcel.winery_name}</span>
          )}
        </p>

        {/* Split-vineyard entry point (reassign blocks to new vineyards) */}
        {hasMultipleBlocks && (
          <div style={{ marginBottom: 20 }}>
            <button
              onClick={() => setShowSplit(true)}
              title="Reassign a subset of this vineyard's blocks to new vineyard names"
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: `1px solid ${alpha(TOKENS.amber, 0.4)}`,
                background: alpha(TOKENS.amber, 0.12),
                color: TOKENS.amber,
                fontSize: 'var(--type-mono-size)',
                fontWeight: 600,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
              }}
            >
              ⎇ Split Vineyard
            </button>
          </div>
        )}

        {/* Vineyard Info */}
        <Section title="Vineyard Info">
          <InfoRow label="AVA" value={parcel.ava_name || '—'} />
          <InfoRow label="Sub-AVA" value={parcel.nested_ava || '—'} />
          <InfoRow label="Winery" value={parcel.winery_name} />
          <InfoRow label="Varietals" value={parcel.varietals_list || '—'} />
          <InfoRow label="Acres" value={parcel.acres ? Number(parcel.acres).toFixed(2) : '—'} />
          <InfoRow label="Vineyard ID" value={`#${parcel.id}`} />
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

      {/* Split-block-geometry modal */}
      {showSplitParcel && parcel && (
        <SplitParcelModal
          vineyard={parcel}
          geometryBlocks={geomBlocks}
          onClose={() => setShowSplitParcel(false)}
          onApplied={async () => {
            setShowSplitParcel(false);
            await load();
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
