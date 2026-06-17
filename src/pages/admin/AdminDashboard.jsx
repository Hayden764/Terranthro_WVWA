import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { alpha, ink, muted, TOKENS } from '../../styles/tokens';
import { apiJson, apiPost, apiFetch } from '../../lib/api';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [admin, setAdmin] = useState(null);
  const [requests, setRequests] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [wineries, setWineries] = useState([]);
  const [tab, setTab] = useState('requests');
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);

  // New account form
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [newWineryId, setNewWineryId] = useState('');
  const [newEmail, setNewEmail] = useState('');

  const load = useCallback(async () => {
    try {
      const me = await apiJson('/api/admin/me');
      setAdmin(me);
      // 'flagged' is a pseudo-filter \u2014 query all statuses but filter by flag presence
      const requestUrl = filter === 'flagged'
        ? '/api/admin/requests?flag=acreage_change'
        : `/api/admin/requests?status=${filter}`;
      const [reqs, accts, wineriesList] = await Promise.all([
        apiJson(requestUrl),
        apiJson('/api/admin/accounts'),
        apiJson('/api/admin/vineyards'),
      ]);
      const uniqueWineries = Array.from(
        new Map(
          wineriesList
            .filter((w) => Number.isInteger(w.winery_id))
            .map((w) => [w.winery_id, { winery_id: w.winery_id, winery_name: w.winery_name }])
        ).values()
      ).sort((a, b) => a.winery_name.localeCompare(b.winery_name));
      setRequests(reqs);
      setAccounts(accts);
      setWineries(uniqueWineries);
    } catch {
      navigate('/admin', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [navigate, filter]);

  useEffect(() => { load(); }, [load]);

  async function handleLogout() {
    await apiPost('/api/admin/logout', {});
    navigate('/admin', { replace: true });
  }

  async function handleCreateAccount(e) {
    e.preventDefault();
    try {
      await apiPost('/api/admin/accounts', { winery_id: parseInt(newWineryId, 10), contact_email: newEmail });
      setShowNewAccount(false);
      setNewWineryId('');
      setNewEmail('');
      load();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDeleteAccount(id) {
    if (!confirm('Remove this winery portal account?')) return;
    try {
      await apiFetch(`/api/admin/accounts/${id}`, { method: 'DELETE' });
      load();
    } catch {
      // ignore
    }
  }

  async function handleSetTemporaryPassword(account) {
    const tempPassword = prompt(`Set a temporary password for ${account.contact_email}\n\nMinimum 8 characters:`);
    if (!tempPassword) return;

    if (tempPassword.length < 8) {
      alert('Temporary password must be at least 8 characters.');
      return;
    }

    try {
      await apiPost(`/api/admin/accounts/${account.id}/password`, {
        password: tempPassword,
        temporary: true,
      });
      alert(`Temporary password set for ${account.contact_email}. Send it to them directly.`);
      load();
    } catch (err) {
      alert(err.message || 'Failed to set temporary password.');
    }
  }

  if (loading) {
    return <Shell><p style={{ color: TOKENS.muted }}>Loading…</p></Shell>;
  }

  const availableWineries = wineries.filter(
    (w) => !accounts.some((a) => a.winery_id === w.winery_id)
  );

  return (
    <Shell>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 'var(--type-display-italic-size)', color: TOKENS.parchment, margin: 0 }}>Admin Console</h1>
          <p style={{ color: TOKENS.muted, fontSize: 'var(--type-body-size)', marginTop: 2 }}>{admin?.email} ({admin?.role})</p>
        </div>
        <button onClick={handleLogout} style={outlineBtn}>Sign Out</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, alignItems: 'center' }}>
        {['requests', 'accounts'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 20px', borderRadius: 6, border: 'none',
              background: tab === t ? TOKENS.electricBlue : alpha(TOKENS.parchment, 0.05),
              color: tab === t ? TOKENS.ink : alpha(TOKENS.parchment, 0.65),
              fontSize: 'var(--type-mono-size)', fontWeight: 600, cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
        {/* Block Manager shortcut */}
        <Link
          to="/admin/blocks"
          style={{
            marginLeft: 'auto',
            padding: '7px 18px', borderRadius: 6,
            background: alpha(TOKENS.amber, 0.12),
            color: TOKENS.amber,
            fontSize: 'var(--type-mono-size)', fontWeight: 600,
            textDecoration: 'none',
            border: `1px solid ${alpha(TOKENS.amber, 0.25)}`,
          }}
        >
          ⊞ Block Manager
        </Link>
        {/* Editor shortcut — navigates to the full-screen parcel editor */}
        <Link
          to="/admin/editor"
          style={{
            padding: '7px 18px', borderRadius: 6,
            background: alpha(TOKENS.violet, 0.15),
            color: TOKENS.violet,
            fontSize: 'var(--type-mono-size)', fontWeight: 600,
            textDecoration: 'none',
            border: `1px solid ${alpha(TOKENS.violet, 0.25)}`,
          }}
        >
          ✎ Parcel Editor
        </Link>
        {admin?.role === 'superadmin' && (
          <Link
            to="/admin/intel"
            style={{
              padding: '7px 18px', borderRadius: 6,
              background: alpha(TOKENS.success, 0.15),
              color: TOKENS.success,
              fontSize: 'var(--type-mono-size)', fontWeight: 600,
              textDecoration: 'none',
              border: `1px solid ${alpha(TOKENS.success, 0.25)}`,
            }}
          >
            ⦿ Account Intel
          </Link>
        )}
      </div>

      {/* Requests tab */}
      {tab === 'requests' && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {['pending', 'approved', 'rejected', 'flagged'].map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                style={{
                  padding: '4px 14px', borderRadius: 12, border: 'none',
                  background: filter === s ? (s === 'flagged' ? alpha(TOKENS.warning, 0.2) : alpha(TOKENS.electricBlue, 0.2)) : 'transparent',
                  color: filter === s ? (s === 'flagged' ? TOKENS.warning : TOKENS.electricBlue) : TOKENS.muted,
                  fontSize: 'var(--type-body-size)', cursor: 'pointer', textTransform: 'capitalize',
                }}
              >
                {s === 'flagged' ? '⚑ flagged' : s}
              </button>
            ))}
          </div>

          {requests.length === 0 ? (
            <p style={{ color: TOKENS.muted, fontSize: 'var(--type-mono-size)' }}>No {filter} requests.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {requests.map((r) => (
                <Link
                  key={r.id}
                  to={`/admin/requests/${r.id}`}
                  style={{ textDecoration: 'none', display: 'block' }}
                >
                  <div style={{
                    ...cardStyle,
                    transition: 'background 0.15s, border-color 0.15s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = alpha(TOKENS.parchment, 0.07);
                    e.currentTarget.style.borderColor = alpha(TOKENS.electricBlue, 0.3);
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = alpha(TOKENS.parchment, 0.04);
                    e.currentTarget.style.borderColor = alpha(TOKENS.parchment, 0.06);
                  }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 'var(--type-body-size)', color: TOKENS.parchment }}>
                          {r.request_type.replace(/_/g, ' ')}
                        </span>
                        <span style={{ color: alpha(TOKENS.parchment, 0.35), fontSize: 'var(--type-body-size)', marginLeft: 8 }}>#{r.id}</span>
                        {r.origin === 'admin' && (
                          <span style={{ marginLeft: 6, fontSize: 'var(--type-ui-label-size)', fontWeight: 600, color: TOKENS.violet, background: alpha(TOKENS.violet, 0.12), borderRadius: 4, padding: '1px 5px' }}>ADMIN</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {r.flag === 'acreage_change' && (
                          <span style={{ fontSize: 'var(--type-ui-label-size)', fontWeight: 700, color: TOKENS.warning, background: alpha(TOKENS.warning, 0.12), border: `1px solid ${alpha(TOKENS.warning, 0.25)}`, borderRadius: 4, padding: '2px 6px' }}>
                            ⚠ Acreage Δ{r.flag_detail?.pct_change != null ? ` ${r.flag_detail.pct_change > 0 ? '+' : ''}${r.flag_detail.pct_change}%` : ''}
                          </span>
                        )}
                        <StatusBadge status={r.status} />
                        <span style={{ fontSize: 'var(--type-ui-label-size)', color: TOKENS.electricBlue }}>View →</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 'var(--type-body-size)', color: alpha(TOKENS.parchment, 0.7), marginTop: 4 }}>
                      <strong style={{ color: alpha(TOKENS.parchment, 0.82) }}>{r.winery_name || 'Independent vineyard'}</strong>
                      {r.contact_email && <> {' · '}{r.contact_email}</>}
                      {r.target_id && <span style={{ color: alpha(TOKENS.parchment, 0.35) }}> · Parcel #{r.target_id}</span>}
                    </div>
                    <div style={{ fontSize: 'var(--type-ui-label-size)', color: alpha(TOKENS.parchment, 0.3), marginTop: 6 }}>
                      {new Date(r.created_at).toLocaleString()}
                      {r.reviewed_at && ` · reviewed ${new Date(r.reviewed_at).toLocaleString()}`}
                    </div>
                    {r.admin_notes && (
                      <p style={{ fontSize: 'var(--type-ui-label-size)', color: TOKENS.muted, marginTop: 4, fontStyle: 'italic', margin: '4px 0 0' }}>
                        Note: {r.admin_notes}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {/* Accounts tab */}
      {tab === 'accounts' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 'var(--type-display-italic-size)', color: TOKENS.parchment, margin: 0 }}>Winery Portal Accounts</h2>
            <button onClick={() => setShowNewAccount(!showNewAccount)} style={outlineBtn}>
              {showNewAccount ? 'Cancel' : '+ Add Account'}
            </button>
          </div>

          {showNewAccount && (
            <form onSubmit={handleCreateAccount} style={{ ...cardStyle, marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 auto', minWidth: 200 }}>
                  <label style={adminLabel}>Winery</label>
                  <select
                    required value={newWineryId}
                    onChange={(e) => setNewWineryId(e.target.value)}
                    style={adminInput}
                  >
                    <option value="">Select a winery…</option>
                    {availableWineries.map((w) => (
                      <option key={w.winery_id} value={w.winery_id}>
                        {w.winery_name} (ID {w.winery_id})
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={adminLabel}>Contact Email</label>
                  <input
                    type="email" required value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    style={adminInput}
                  />
                </div>
              </div>
              {availableWineries.length === 0 && (
                <p style={{ color: TOKENS.muted, fontSize: 'var(--type-ui-label-size)', marginTop: 8, marginBottom: 0 }}>
                  All wineries already have a portal email.
                </p>
              )}
              <button type="submit" style={{ ...approveBtnStyle, marginTop: 10 }}>Create Account</button>
            </form>
          )}

          {accounts.length === 0 ? (
            <p style={{ color: TOKENS.muted, fontSize: 'var(--type-mono-size)' }}>No winery accounts yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {accounts.map((a) => (
                <div key={a.id} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 'var(--type-body-size)', color: TOKENS.parchment }}>
                        {a.winery_name}
                      </span>
                      <span style={{ color: TOKENS.muted, fontSize: 'var(--type-body-size)', marginLeft: 8 }}>
                        ID {a.winery_id}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {admin?.role === 'superadmin' && (
                        <button
                          onClick={() => handleSetTemporaryPassword(a)}
                          style={{
                            ...outlineBtn,
                            color: TOKENS.warning,
                            borderColor: alpha(TOKENS.warning, 0.35),
                            fontSize: 'var(--type-ui-label-size)',
                            padding: '3px 10px',
                          }}
                        >
                          Set Temp Password
                        </button>
                      )}
                      <button onClick={() => handleDeleteAccount(a.id)} style={{
                        ...outlineBtn, color: TOKENS.danger, borderColor: alpha(TOKENS.danger, 0.3),
                        fontSize: 'var(--type-ui-label-size)', padding: '3px 10px',
                      }}>
                        Remove
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: 'var(--type-body-size)', color: alpha(TOKENS.parchment, 0.7), marginTop: 4 }}>
                    {a.contact_email}
                    {a.email_verified && ' ✓'}
                    {a.has_password && ' · password set'}
                    {a.last_login && ` · last login ${new Date(a.last_login).toLocaleDateString()}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: TOKENS.ink, fontFamily: 'var(--font-sans)' }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 20px' }}>
        {children}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const colors = {
    pending: { bg: alpha(TOKENS.warning, 0.15), color: TOKENS.warning },
    approved: { bg: alpha(TOKENS.success, 0.15), color: TOKENS.success },
    rejected: { bg: alpha(TOKENS.danger, 0.15), color: TOKENS.danger },
  };
  const c = colors[status] || colors.pending;
  return (
    <span style={{
      padding: '2px 10px', borderRadius: 10, fontSize: 'var(--type-ui-label-size)', fontWeight: 600,
      background: c.bg, color: c.color, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

const cardStyle = {
  padding: '14px 16px', borderRadius: 8,
  background: alpha(TOKENS.parchment, 0.04),
  border: `1px solid ${alpha(TOKENS.parchment, 0.06)}`,
};

const outlineBtn = {
  background: 'transparent', border: `1px solid ${alpha(TOKENS.parchment, 0.12)}`,
  borderRadius: 6, padding: '6px 14px', fontSize: 'var(--type-body-size)',
  color: alpha(TOKENS.parchment, 0.7), cursor: 'pointer',
};

const approveBtnStyle = {
  padding: '6px 16px', borderRadius: 6, border: 'none',
  background: TOKENS.success, color: TOKENS.ink, fontSize: 'var(--type-body-size)',
  fontWeight: 600, cursor: 'pointer',
};

const adminLabel = { display: 'block', fontSize: 'var(--type-ui-label-size)', color: TOKENS.muted, marginBottom: 3 };
const adminInput = {
  width: '100%', padding: '8px 10px', borderRadius: 6,
  border: `1px solid ${alpha(TOKENS.parchment, 0.10)}`, fontSize: 'var(--type-mono-size)',
  color: TOKENS.parchment, background: alpha(TOKENS.parchment, 0.05),
  outline: 'none',
};
