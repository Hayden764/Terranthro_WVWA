import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { alpha, border, crimson, ink, muted, parchment, TOKENS } from '../../styles/tokens';
import { apiJson } from '../../lib/api';

export default function AdminAccountIntel() {
  const navigate = useNavigate();
  const [admin, setAdmin] = useState(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [error, setError] = useState('');

  const loadAccounts = useCallback(async () => {
    try {
      const me = await apiJson('/api/admin/me');
      setAdmin(me);
      if (me.role !== 'superadmin') {
        throw new Error('Superadmin required');
      }

      const data = await apiJson(`/api/admin/intel?search=${encodeURIComponent(search)}`);
      setSummary(data.summary);
      setAccounts(data.accounts);

      setSelectedAccount((current) => {
        if (current && data.accounts.some((account) => account.id === current.id)) {
          return data.accounts.find((account) => account.id === current.id) || data.accounts[0] || null;
        }
        return data.accounts[0] || null;
      });

      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load account intelligence');
      const message = String(err?.message || '');
      if (message.includes('401') || message.includes('403') || message.toLowerCase().includes('not authenticated')) {
        navigate('/admin', { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }, [navigate, search]);

  const loadEvents = useCallback(async () => {
    if (!selectedAccount) {
      setEvents([]);
      return;
    }

    setEventsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '150');
      if (eventTypeFilter) {
        params.set('type', eventTypeFilter);
      }
      const rows = await apiJson(`/api/admin/intel/accounts/${selectedAccount.id}/events?${params.toString()}`);
      setEvents(rows);
    } catch (err) {
      setError(err.message || 'Failed to load events');
    } finally {
      setEventsLoading(false);
    }
  }, [eventTypeFilter, selectedAccount]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { loadEvents(); }, [loadEvents]);

  async function handleSearchSubmit(e) {
    e.preventDefault();
    setSearch(searchDraft.trim());
    setLoading(true);
  }

  function selectAccount(account) {
    setSelectedAccount(account);
    setEventTypeFilter('');
  }

  if (loading && !summary) {
    return <Shell><p style={{ color: TOKENS.muted }}>Loading…</p></Shell>;
  }

  return (
    <Shell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <div>
          <div style={{ marginBottom: 8 }}>
            <Link to="/admin/dashboard" style={{ color: TOKENS.muted, fontSize: 'var(--type-mono-size)' }}>← Admin Dashboard</Link>
          </div>
          <h1 style={{ fontSize: 'var(--type-display-italic-size)', color: TOKENS.parchment, margin: 0 }}>Account Intelligence</h1>
          <p style={{ color: TOKENS.muted, fontSize: 'var(--type-body-size)', marginTop: 2 }}>{admin?.email} ({admin?.role})</p>
        </div>
        <button onClick={loadAccounts} style={outlineBtn}>Refresh</button>
      </div>

      <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Search winery or email…"
          className="ds-input"
          style={searchInput}
        />
        <button type="submit" style={primaryBtn}>Search</button>
      </form>

      {error && <p style={{ color: TOKENS.warning, fontSize: 'var(--type-mono-size)', marginBottom: 16 }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 10, marginBottom: 20 }}>
        <StatCard label="Accounts" value={summary?.total_accounts ?? '—'} />
        <StatCard label="Password set" value={summary?.password_enabled ?? '—'} />
        <StatCard label="Must change" value={summary?.must_change_password ?? '—'} />
        <StatCard label="Active 30d" value={summary?.active_30d ?? '—'} />
        <StatCard label="Logins 7d" value={summary?.successful_logins_7d ?? '—'} />
        <StatCard label="Events 24h" value={summary?.events_24h ?? '—'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 16 }}>
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ margin: 0, color: TOKENS.parchment, fontSize: 'var(--type-body-size)' }}>Winery Accounts</h2>
            <span style={{ color: TOKENS.muted, fontSize: 'var(--type-ui-label-size)' }}>{accounts.length}</span>
          </div>

          <div style={{ maxHeight: '72vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {accounts.length === 0 ? (
              <p style={{ color: TOKENS.muted, fontSize: 'var(--type-mono-size)' }}>No matching accounts.</p>
            ) : accounts.map((account) => {
              const active = selectedAccount?.id === account.id;
              return (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => selectAccount(account)}
                  style={{
                    ...accountCard,
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderColor: active ? alpha(TOKENS.electricBlue, 0.45) : alpha(TOKENS.parchment, 0.08),
                    background: active ? alpha(TOKENS.electricBlue, 0.10) : alpha(TOKENS.parchment, 0.04),
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div>
                      <div style={{ color: TOKENS.parchment, fontWeight: 700, fontSize: 'var(--type-body-size)' }}>{account.winery_name}</div>
                      <div style={{ color: TOKENS.muted, fontSize: 'var(--type-mono-size)', marginTop: 2 }}>{account.contact_email}</div>
                    </div>
                    <span style={{ color: TOKENS.electricBlue, fontSize: 'var(--type-ui-label-size)' }}>View</span>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    <MiniPill tone={account.has_password ? TOKENS.success : TOKENS.warning}>
                      {account.has_password ? 'Password set' : 'No password'}
                    </MiniPill>
                    {account.password_must_change && <MiniPill tone={TOKENS.warning}>Must change</MiniPill>}
                    {account.email_verified && <MiniPill tone={TOKENS.electricBlue}>Verified</MiniPill>}
                  </div>

                  <div style={{ color: alpha(TOKENS.parchment, 0.65), fontSize: 'var(--type-ui-label-size)', marginTop: 10, lineHeight: 1.5 }}>
                    {account.login_count_30d} logins in 30d · {account.failed_logins_30d} failures
                    <br />
                    Last login: {formatDate(account.last_login)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={panelStyle}>
          {selectedAccount ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ margin: 0, color: TOKENS.parchment, fontSize: 'var(--type-display-italic-size)' }}>{selectedAccount.winery_name}</h2>
                  <p style={{ margin: '6px 0 0', color: TOKENS.muted, fontSize: 'var(--type-body-size)' }}>{selectedAccount.contact_email}</p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <MiniPill tone={selectedAccount.has_password ? TOKENS.success : TOKENS.warning}>
                    {selectedAccount.has_password ? 'Password stored' : 'Password missing'}
                  </MiniPill>
                  {selectedAccount.password_must_change && <MiniPill tone={TOKENS.warning}>Must change password</MiniPill>}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 16 }}>
                <InfoBox label="Created" value={formatDate(selectedAccount.created_at)} />
                <InfoBox label="Last login" value={formatDate(selectedAccount.last_login)} />
                <InfoBox label="Password changed" value={formatDate(selectedAccount.password_last_changed_at)} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 18 }}>
                <InfoBox label="Logins 30d" value={selectedAccount.login_count_30d ?? 0} />
                <InfoBox label="Failures 30d" value={selectedAccount.failed_logins_30d ?? 0} />
                <InfoBox label="Last event" value={selectedAccount.last_event_type || '—'} />
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                {['', 'magic_link_requested', 'magic_link_verified', 'password_login', 'password_changed', 'password_reset_completed', 'admin_password_reset', 'email_change_requested', 'email_change_completed'].map((type) => (
                  <button
                    key={type || 'all'}
                    type="button"
                    onClick={() => setEventTypeFilter(type)}
                    style={{
                      ...filterBtn,
                      background: eventTypeFilter === type ? alpha(TOKENS.electricBlue, 0.18) : alpha(TOKENS.parchment, 0.05),
                      color: eventTypeFilter === type ? TOKENS.electricBlue : TOKENS.muted,
                    }}
                  >
                    {type ? prettyEventLabel(type) : 'All events'}
                  </button>
                ))}
              </div>

              <div style={{ maxHeight: '58vh', overflow: 'auto', borderTop: `1px solid ${alpha(TOKENS.parchment, 0.08)}`, paddingTop: 12 }}>
                {eventsLoading ? (
                  <p style={{ color: TOKENS.muted, fontSize: 'var(--type-mono-size)' }}>Loading events…</p>
                ) : events.length === 0 ? (
                  <p style={{ color: TOKENS.muted, fontSize: 'var(--type-mono-size)' }}>No events for this account.</p>
                ) : events.map((event) => (
                  <div key={event.id} style={timelineItem}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ color: TOKENS.parchment, fontWeight: 700 }}>{prettyEventLabel(event.event_type)}</span>
                        <MiniPill tone={event.success ? TOKENS.success : TOKENS.danger}>{event.success ? 'success' : 'failure'}</MiniPill>
                        {event.actor_admin_name && <MiniPill tone={TOKENS.violet}>by {event.actor_admin_name}</MiniPill>}
                      </div>
                      <span style={{ color: TOKENS.muted, fontSize: 'var(--type-ui-label-size)' }}>{formatDate(event.created_at)}</span>
                    </div>
                    <div style={{ color: alpha(TOKENS.parchment, 0.68), fontSize: 'var(--type-body-size)', marginTop: 6 }}>
                      {event.identifier && <span>Identifier: {event.identifier}</span>}
                      {event.ip && <span> · IP {event.ip}</span>}
                    </div>
                    {event.details && Object.keys(event.details).length > 0 && (
                      <pre style={detailsStyle}>{JSON.stringify(event.details, null, 2)}</pre>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p style={{ color: TOKENS.muted, fontSize: 'var(--type-mono-size)' }}>Select an account to inspect its activity.</p>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: TOKENS.ink, fontFamily: 'var(--font-sans)' }}>
      <div style={{ maxWidth: 1380, margin: '0 auto', padding: '32px 20px' }}>
        {children}
      </div>
    </div>
  );
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function prettyEventLabel(value) {
  return String(value).replace(/_/g, ' ');
}

function StatCard({ label, value }) {
  return (
    <div style={statCard}>
      <div style={{ color: TOKENS.muted, fontSize: 'var(--type-ui-label-size)', marginBottom: 6 }}>{label}</div>
      <div style={{ color: TOKENS.parchment, fontSize: 'var(--type-display-italic-size)', lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function InfoBox({ label, value }) {
  return (
    <div style={infoBox}>
      <div style={{ color: TOKENS.muted, fontSize: 'var(--type-ui-label-size)', marginBottom: 6 }}>{label}</div>
      <div style={{ color: TOKENS.parchment, fontSize: 'var(--type-body-size)', lineHeight: 1.45 }}>{value}</div>
    </div>
  );
}

function MiniPill({ tone, children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 999,
      fontSize: 'var(--type-ui-label-size)', fontWeight: 700, background: alpha(tone, 0.12), color: tone,
    }}>
      {children}
    </span>
  );
}

const panelStyle = {
  padding: 16,
  borderRadius: 10,
  background: alpha(TOKENS.parchment, 0.04),
  border: `1px solid ${alpha(TOKENS.parchment, 0.08)}`,
};

const accountCard = {
  padding: 12,
  borderRadius: 10,
  border: `1px solid ${alpha(TOKENS.parchment, 0.08)}`,
  background: alpha(TOKENS.parchment, 0.04),
};

const timelineItem = {
  padding: '12px 0',
  borderBottom: `1px solid ${alpha(TOKENS.parchment, 0.08)}`,
};

const detailsStyle = {
  marginTop: 10,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 'var(--type-mono-size)',
  color: alpha(TOKENS.parchment, 0.82),
  background: alpha(TOKENS.ink, 0.18),
  padding: '10px 12px',
  borderRadius: 8,
  border: `1px solid ${alpha(TOKENS.parchment, 0.08)}`,
};

const statCard = {
  padding: 14,
  borderRadius: 10,
  background: alpha(TOKENS.parchment, 0.04),
  border: `1px solid ${alpha(TOKENS.parchment, 0.08)}`,
};

const infoBox = {
  padding: 12,
  borderRadius: 8,
  background: alpha(TOKENS.parchment, 0.04),
  border: `1px solid ${alpha(TOKENS.parchment, 0.08)}`,
};

const outlineBtn = {
  background: 'transparent',
  border: `1px solid ${alpha(TOKENS.parchment, 0.14)}`,
  borderRadius: 8,
  padding: '8px 14px',
  color: alpha(TOKENS.parchment, 0.8),
  cursor: 'pointer',
};

const primaryBtn = {
  background: TOKENS.electricBlue,
  color: TOKENS.ink,
  border: 'none',
  borderRadius: 8,
  padding: '10px 18px',
  cursor: 'pointer',
  fontWeight: 700,
};

const searchInput = {
  flex: '1 1 320px',
  ...outlineBtn,
  color: TOKENS.parchment,
  background: alpha(TOKENS.parchment, 0.05),
};

const filterBtn = {
  ...outlineBtn,
  padding: '6px 10px',
  fontSize: 'var(--type-ui-label-size)',
};