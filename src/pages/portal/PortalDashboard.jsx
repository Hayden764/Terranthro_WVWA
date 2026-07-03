import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { border, ink, muted, parchment, electricBlue, TOKENS } from '../../styles/tokens';
import { btn } from '../../styles/patterns';
import { apiJson } from '../../lib/api';
import PortalHeader from '../../components/portal/PortalHeader';
import PortalVineyardMap from '../../components/PortalVineyardMap';
import TerroirDataChips from '../../components/TerroirDataChips';
import BulkBlockImport from '../../components/BulkBlockImport';

export default function PortalDashboard() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [vineyards, setVineyards] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkDone, setBulkDone] = useState(null);
  const [hoveredGroup, setHoveredGroup] = useState(null);

  const load = useCallback(async () => {
    try {
      const [p, v, r] = await Promise.all([
        apiJson('/api/portal/profile'),
        apiJson('/api/portal/vineyards'),
        apiJson('/api/portal/requests'),
      ]);
      setProfile(p);
      setVineyards(v);
      setRequests(r);
    } catch {
      navigate('/portal', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = () => navigate('/portal', { replace: true });
    window.addEventListener('session-expired', handler);
    return () => window.removeEventListener('session-expired', handler);
  }, [navigate]);

  if (loading) {
    return <PageShell><p style={{ color: muted }}>Loading…</p></PageShell>;
  }

  const pendingRequests = requests.filter((r) => r.status === 'pending');

  return (
    <PageShell>
      {/* Header bar with profile menu */}
      <PortalHeader title={profile?.title} />

      {/* Quick stats */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
        <StatCard label="Vineyards" value={groupVineyardsByName(vineyards).length} />
        <StatCard label="Total Acres" value={vineyards.reduce((s, v) => s + Number(v.acres || 0), 0).toFixed(1)} />
        <StatCard label="Pending Requests" value={pendingRequests.length} />
      </div>

      {/* Vineyard map */}
      {vineyards.length > 0 && (
        <Section title="Vineyard Map">
          <PortalVineyardMap
            parcels={vineyards}
            height={360}
            onParcelClick={(parcel) => {
              const groups = groupVineyardsByName(vineyards);
              const group = groups.find((g) =>
                g.parcels.some((p) => p.id === parcel.id)
              );
              if (group && group.parcels.length > 1) {
                navigate(`/portal/vineyards/group?name=${encodeURIComponent(group.name)}`);
              } else {
                navigate(`/portal/vineyards/${parcel.id}`);
              }
            }}
          />
          <p style={{ fontSize: 'var(--type-body-size)', color: muted, marginTop: 8 }}>
            Click a parcel to view details.
          </p>
        </Section>
      )}

      {/* Profile section */}
      <Section title="Winery Profile">
        <InfoRow label="Description" value={profile?.description || '—'} />
        <InfoRow label="Phone" value={profile?.phone || '—'} />
        <InfoRow label="Website" value={profile?.url || '—'} />
        <div style={{ marginTop: 12 }}>
          <Link to="/portal/profile" style={actionBtnStyle}>Edit Profile</Link>
        </div>
      </Section>

      {/* Password section — show if not set */}
      {!profile?.has_password && (
        <Section title="Secure Login with a Password">
          <p style={{ color: muted, fontSize: 'var(--type-body-size)', marginBottom: 12 }}>
            Set a password to log in directly without waiting for an email link. Perfect if you're having trouble with email delivery.
          </p>
          <Link to="/portal/settings" style={actionBtnStyle}>Set a Password</Link>
        </Section>
      )}

      {/* Vineyards — grouped by name */}
      <Section title="Linked Vineyards">
        {vineyards.length === 0 ? (
          <p style={{ color: muted, fontSize: 'var(--type-body-size)' }}>No vineyards linked yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {groupVineyardsByName(vineyards).map((group) => {
              const totalAcres = group.parcels.reduce((s, v) => s + Number(v.acres || 0), 0);
              const totalBlocks = group.parcels.reduce((s, v) => s + (v.blocks?.length || 0), 0);
              const ava = group.parcels[0]?.nested_ava || group.parcels[0]?.ava_name || '—';
              const href = group.parcels.length === 1
                ? `/portal/vineyards/${group.parcels[0].id}`
                : `/portal/vineyards/group?name=${encodeURIComponent(group.name)}`;

              // Aggregate topo stats across parcels that have data
              const topoList = group.parcels.map((p) => p.topo_stats).filter(Boolean);
              const topo = topoList.length > 0 ? {
                elevation_mean_ft: topoList.reduce((s, t) => s + Number(t.elevation_mean_ft), 0) / topoList.length,
                slope_mean_deg: topoList.reduce((s, t) => s + Number(t.slope_mean_deg), 0) / topoList.length,
                aspect_dominant_deg: topoList[0].aspect_dominant_deg,
              } : null;

              const terroirChips = [
                { label: 'Acres', value: `${totalAcres.toFixed(1)} ac`, tone: 'amber', glow: false },
                { label: 'Elev', value: topo ? `${Math.round(topo.elevation_mean_ft)} ft` : '—', tone: 'parchment', glow: false },
                { label: 'Slope', value: topo ? `${topo.slope_mean_deg.toFixed(1)}°` : '—', tone: 'green', glow: true },
                { label: 'Aspect', value: topo ? degToCardinal(topo.aspect_dominant_deg) : '—', tone: 'blue', glow: true },
              ];

              const isHovered = hoveredGroup === group.name;
              return (
                <Link
                  key={group.name}
                  to={href}
                  onMouseEnter={() => setHoveredGroup(group.name)}
                  onMouseLeave={() => setHoveredGroup(null)}
                  style={{
                    display: 'block', padding: '14px 16px', borderRadius: 8,
                    border: `1px solid ${isHovered ? electricBlue : border}`, background: parchment,
                    textDecoration: 'none', color: ink,
                    transition: 'border-color 0.12s, color 0.12s',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 'var(--type-display-italic-size)', color: isHovered ? electricBlue : ink }}>{group.name}</div>
                  <div style={{ fontSize: 'var(--type-mono-size)', color: muted, marginTop: 4 }}>
                    {ava}
                    {group.parcels.length > 1 && ` · ${group.parcels.length} parcels`}
                    {totalBlocks > 0 && ` · ${totalBlocks} blocks`}
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <TerroirDataChips chips={terroirChips} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to="/portal/claim" style={actionBtnStyle}>Claim a Vineyard</Link>
          <button onClick={() => setShowBulk(true)} style={actionBtnStyle}>Bulk import blocks (CSV)</button>
        </div>
      </Section>

      {/* Recent requests */}
      <Section title="Recent Requests">
        {requests.length === 0 ? (
          <p style={{ color: muted, fontSize: 'var(--type-body-size)' }}>No requests submitted yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {requests.slice(0, 10).map((r) => (
              <div key={r.id} style={{
                padding: '10px 14px', borderRadius: 6,
                background: parchment, fontSize: 'var(--type-mono-size)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span>
                  <strong>{r.request_type.replace(/_/g, ' ')}</strong>
                  {r.target_id && ` (ID ${r.target_id})`}
                </span>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        )}
      </Section>
      {showBulk && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '40px 16px',
        }} onClick={() => setShowBulk(false)}>
          <div style={{ maxWidth: 720, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            {bulkDone ? (
              <div style={{ background: parchment, padding: 20, borderRadius: 12, border: `1px solid ${border}` }}>
                <h2 style={{ marginTop: 0, color: ink }}>Submitted for review</h2>
                <p style={{ color: muted, fontSize: 'var(--type-mono-size)' }}>
                  Request #{bulkDone.id} is now pending admin approval. You'll see the changes
                  applied once approved.
                </p>
                <button onClick={() => { setShowBulk(false); setBulkDone(null); load(); }}
                  style={{ ...actionBtnStyle, marginTop: 8 }}>Close</button>
              </div>
            ) : (
              <BulkBlockImport
                mode="portal"
                wineryTitle={profile?.title}
                onComplete={(res) => setBulkDone(res)}
                onClose={() => setShowBulk(false)}
              />
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}

/* ── Shared sub-components ─────────────────────────── */

function PageShell({ children }) {
  return (
    <div style={{
      minHeight: '100vh', background: parchment,
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
        {children}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{
      background: parchment, borderRadius: 10, padding: '24px 20px',
      border: `1px solid ${border}`, marginBottom: 24,
    }}>
      <h2 style={{
        fontSize: 'var(--type-display-italic-size)', fontWeight: 600, color: ink,
        marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${border}`,
      }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{
      flex: '1 1 140px', background: parchment, borderRadius: 10,
      padding: '18px 16px', border: `1px solid ${border}`,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 'var(--type-display-medium-size)', fontWeight: 700, color: ink }}>{value}</div>
      <div style={{ fontSize: 'var(--type-body-size)', color: muted, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 'var(--type-body-size)' }}>
      <span style={{ color: muted, minWidth: 100, flexShrink: 0 }}>{label}</span>
      <span style={{ color: ink, wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const colors = {
    pending: { bg: TOKENS.warningDim, color: TOKENS.warning },
    approved: { bg: TOKENS.successDim, color: TOKENS.success },
    rejected: { bg: TOKENS.dangerDim, color: TOKENS.danger },
  };
  const c = colors[status] || colors.pending;
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 12, fontSize: 'var(--type-ui-label-size)', fontWeight: 600,
      background: c.bg, color: c.color, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

const actionBtnStyle = {
  display: 'inline-block',
  ...btn('primary', { padding: '8px 20px' }),
  textDecoration: 'none',
};

/* ── Helpers ─────────────────────────────────────── */

/**
 * Group an array of vineyard parcels by `vineyard_name`.
 * Returns [{name, parcels}] sorted alphabetically.
 */
function groupVineyardsByName(vineyards) {
  const map = new Map();
  for (const v of vineyards) {
    const key = (v.vineyard_name || 'Unnamed Parcel').trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(v);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, parcels]) => ({ name, parcels }));
}

function degToCardinal(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(Number(deg) / 45) % 8];
}
