import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { BRAND } from '../../config/brandColors';
import { apiJson, apiPost, apiFetch } from '../../lib/api';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [admin, setAdmin] = useState(null);
  const [requests, setRequests] = useState([]);
  const [accounts, setAccounts] = useState([]);
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
      const [reqs, accts] = await Promise.all([
        apiJson(requestUrl),
        apiJson('/api/admin/accounts'),
      ]);
      setRequests(reqs);
      setAccounts(accts);
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

  if (loading) {
    return <Shell><p style={{ color: '#888' }}>Loading…</p></Shell>;
  }

  return (
    <Shell>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, color: '#e0e0e0', margin: 0 }}>Admin Console</h1>
          <p style={{ color: '#888', fontSize: 12, marginTop: 2 }}>{admin?.email} ({admin?.role})</p>
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
              background: tab === t ? '#4a90d9' : 'rgba(255,255,255,0.05)',
              color: tab === t ? '#fff' : '#aaa',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
        {/* Editor shortcut — navigates to the full-screen parcel editor */}
        <Link
          to="/admin/editor"
          style={{
            marginLeft: 'auto',
            padding: '7px 18px', borderRadius: 6,
            background: 'rgba(99,102,241,0.15)',
            color: '#818cf8',
            fontSize: 13, fontWeight: 600,
            textDecoration: 'none',
            border: '1px solid rgba(99,102,241,0.25)',
          }}
        >
          ✎ Parcel Editor
        </Link>
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
                  background: filter === s ? (s === 'flagged' ? 'rgba(234,179,8,0.2)' : 'rgba(74,144,217,0.2)') : 'transparent',
                  color: filter === s ? (s === 'flagged' ? '#eab308' : '#4a90d9') : '#888',
                  fontSize: 12, cursor: 'pointer', textTransform: 'capitalize',
                }}
              >
                {s === 'flagged' ? '⚑ flagged' : s}
              </button>
            ))}
          </div>

          {requests.length === 0 ? (
            <p style={{ color: '#888', fontSize: 13 }}>No {filter} requests.</p>
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
                    e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
                    e.currentTarget.style.borderColor = 'rgba(74,144,217,0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                  }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 14, color: '#e0e0e0' }}>
                          {r.request_type.replace(/_/g, ' ')}
                        </span>
                        <span style={{ color: '#666', fontSize: 12, marginLeft: 8 }}>#{r.id}</span>
                        {r.origin === 'admin' && (
                          <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: '#818cf8', background: 'rgba(99,102,241,0.12)', borderRadius: 4, padding: '1px 5px' }}>ADMIN</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {r.flag === 'acreage_change' && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#eab308', background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.25)', borderRadius: 4, padding: '2px 6px' }}>
                            ⚠ Acreage Δ{r.flag_detail?.pct_change != null ? ` ${r.flag_detail.pct_change > 0 ? '+' : ''}${r.flag_detail.pct_change}%` : ''}
                          </span>
                        )}
                        <StatusBadge status={r.status} />
                        <span style={{ fontSize: 11, color: '#4a90d9' }}>View →</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
                      <strong style={{ color: '#ccc' }}>{r.winery_name}</strong>
                      {' · '}{r.contact_email}
                      {r.target_id && <span style={{ color: '#666' }}> · Parcel #{r.target_id}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#555', marginTop: 6 }}>
                      {new Date(r.created_at).toLocaleString()}
                      {r.reviewed_at && ` · reviewed ${new Date(r.reviewed_at).toLocaleString()}`}
                    </div>
                    {r.admin_notes && (
                      <p style={{ fontSize: 11, color: '#888', marginTop: 4, fontStyle: 'italic', margin: '4px 0 0' }}>
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
            <h2 style={{ fontSize: 16, color: '#e0e0e0', margin: 0 }}>Winery Portal Accounts</h2>
            <button onClick={() => setShowNewAccount(!showNewAccount)} style={outlineBtn}>
              {showNewAccount ? 'Cancel' : '+ Add Account'}
            </button>
          </div>

          {showNewAccount && (
            <form onSubmit={handleCreateAccount} style={{ ...cardStyle, marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 100px' }}>
                  <label style={adminLabel}>Winery ID</label>
                  <input
                    type="number" required value={newWineryId}
                    onChange={(e) => setNewWineryId(e.target.value)}
                    style={adminInput}
                  />
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
              <button type="submit" style={{ ...approveBtnStyle, marginTop: 10 }}>Create Account</button>
            </form>
          )}

          {accounts.length === 0 ? (
            <p style={{ color: '#888', fontSize: 13 }}>No winery accounts yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {accounts.map((a) => (
                <div key={a.id} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 14, color: '#e0e0e0' }}>
                        {a.winery_name}
                      </span>
                      <span style={{ color: '#888', fontSize: 12, marginLeft: 8 }}>
                        ID {a.winery_id}
                      </span>
                    </div>
                    <button onClick={() => handleDeleteAccount(a.id)} style={{
                      ...outlineBtn, color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.3)',
                      fontSize: 11, padding: '3px 10px',
                    }}>
                      Remove
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
                    {a.contact_email}
                    {a.email_verified && ' ✓'}
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
    <div style={{ minHeight: '100vh', background: '#1a1a2e', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 20px' }}>
        {children}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const colors = {
    pending: { bg: 'rgba(255,193,7,0.15)', color: '#FFD54F' },
    approved: { bg: 'rgba(76,175,80,0.15)', color: '#81C784' },
    rejected: { bg: 'rgba(244,67,54,0.15)', color: '#EF9A9A' },
  };
  const c = colors[status] || colors.pending;
  return (
    <span style={{
      padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.color, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

const cardStyle = {
  padding: '14px 16px', borderRadius: 8,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.06)',
};

const outlineBtn = {
  background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6, padding: '6px 14px', fontSize: 12,
  color: '#aaa', cursor: 'pointer',
};

const approveBtnStyle = {
  padding: '6px 16px', borderRadius: 6, border: 'none',
  background: '#2e7d32', color: '#fff', fontSize: 12,
  fontWeight: 600, cursor: 'pointer',
};

const adminLabel = { display: 'block', fontSize: 11, color: '#888', marginBottom: 3 };
const adminInput = {
  width: '100%', padding: '8px 10px', borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.10)', fontSize: 13,
  color: '#e0e0e0', background: 'rgba(255,255,255,0.05)',
  outline: 'none',
};
