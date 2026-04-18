import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { BRAND } from '../../config/brandColors';
import { apiJson, apiPost } from '../../lib/api';
import PortalVineyardMap from '../../components/PortalVineyardMap';

export default function PortalDashboard() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [vineyards, setVineyards] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

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

  async function handleLogout() {
    await apiPost('/api/auth/logout', {});
    navigate('/portal', { replace: true });
  }

  if (loading) {
    return <PageShell><p style={{ color: BRAND.textMuted }}>Loading…</p></PageShell>;
  }

  const pendingRequests = requests.filter((r) => r.status === 'pending');

  return (
    <PageShell>
      {/* Header bar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 32,
      }}>
        <div>
          <h1 style={{ fontFamily: "'Georgia', serif", fontSize: 24, color: BRAND.brown, margin: 0 }}>
            {profile?.title}
          </h1>
          <p style={{ color: BRAND.textMuted, fontSize: 13, marginTop: 4 }}>Winery Portal</p>
        </div>
        <button onClick={handleLogout} style={linkBtnStyle}>Sign Out</button>
      </div>

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
          <p style={{ fontSize: 12, color: BRAND.textMuted, marginTop: 8 }}>
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

      {/* Vineyards — grouped by name */}
      <Section title="Linked Vineyards">
        {vineyards.length === 0 ? (
          <p style={{ color: BRAND.textMuted, fontSize: 14 }}>No vineyards linked yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {groupVineyardsByName(vineyards).map((group) => {
              const totalAcres = group.parcels.reduce((s, v) => s + Number(v.acres || 0), 0);
              const totalBlocks = group.parcels.reduce((s, v) => s + (v.blocks?.length || 0), 0);
              const ava = group.parcels[0]?.nested_ava || group.parcels[0]?.ava_name || '—';
              const href = group.parcels.length === 1
                ? `/portal/vineyards/${group.parcels[0].id}`
                : `/portal/vineyards/group?name=${encodeURIComponent(group.name)}`;
              return (
                <Link
                  key={group.name}
                  to={href}
                  style={{
                    display: 'block', padding: '14px 16px', borderRadius: 8,
                    border: `1px solid ${BRAND.border}`, background: BRAND.eggshell,
                    textDecoration: 'none', color: BRAND.text,
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{group.name}</div>
                  <div style={{ fontSize: 13, color: BRAND.textMuted, marginTop: 4 }}>
                    {ava} · {totalAcres.toFixed(1)} acres
                    {group.parcels.length > 1 && ` · ${group.parcels.length} parcels`}
                    {totalBlocks > 0 && ` · ${totalBlocks} blocks`}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          <Link to="/portal/claim" style={actionBtnStyle}>Claim a Vineyard</Link>
        </div>
      </Section>

      {/* Recent requests */}
      <Section title="Recent Requests">
        {requests.length === 0 ? (
          <p style={{ color: BRAND.textMuted, fontSize: 14 }}>No requests submitted yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {requests.slice(0, 10).map((r) => (
              <div key={r.id} style={{
                padding: '10px 14px', borderRadius: 6,
                background: BRAND.eggshell, fontSize: 13,
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
    </PageShell>
  );
}

/* ── Shared sub-components ─────────────────────────── */

function PageShell({ children }) {
  return (
    <div style={{
      minHeight: '100vh', background: BRAND.eggshell,
      fontFamily: "'Inter', sans-serif",
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
      background: BRAND.white, borderRadius: 10, padding: '24px 20px',
      border: `1px solid ${BRAND.border}`, marginBottom: 24,
    }}>
      <h2 style={{
        fontSize: 16, fontWeight: 600, color: BRAND.brown,
        marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${BRAND.border}`,
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
      flex: '1 1 140px', background: BRAND.white, borderRadius: 10,
      padding: '18px 16px', border: `1px solid ${BRAND.border}`,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: BRAND.brown }}>{value}</div>
      <div style={{ fontSize: 12, color: BRAND.textMuted, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 14 }}>
      <span style={{ color: BRAND.textMuted, minWidth: 100, flexShrink: 0 }}>{label}</span>
      <span style={{ color: BRAND.text, wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const colors = {
    pending: { bg: '#FFF8E1', color: '#B8860B' },
    approved: { bg: '#f0f9e8', color: '#3a5a1f' },
    rejected: { bg: '#FEF0F0', color: '#A8323A' },
  };
  const c = colors[status] || colors.pending;
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.color, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

const actionBtnStyle = {
  display: 'inline-block',
  padding: '8px 20px',
  borderRadius: 6,
  background: BRAND.brown,
  color: BRAND.white,
  fontSize: 13,
  fontWeight: 600,
  textDecoration: 'none',
  border: 'none',
  cursor: 'pointer',
};

const linkBtnStyle = {
  background: 'none',
  border: `1px solid ${BRAND.border}`,
  borderRadius: 6,
  padding: '6px 16px',
  fontSize: 13,
  color: BRAND.brownLight,
  cursor: 'pointer',
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
