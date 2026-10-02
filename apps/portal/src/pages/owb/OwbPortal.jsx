import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { alpha, border, crimson, ink, muted, parchment, TOKENS } from '@terranthro/shared/styles/tokens.js';
import { INPUT_STYLE, btn } from '@terranthro/shared/styles/patterns.js';
import { apiJson, apiPost } from '@terranthro/shared/lib/api.js';
import TimelineTab from '../../components/owb/TimelineTab';
import DataTab from '../../components/owb/DataTab';

const TABS = [
  { key: 'timeline', label: 'Build-out timeline' },
  { key: 'data', label: 'Data & reports' },
];

/**
 * OWB Portal — the Oregon Wine Board's view of the statewide mapping contract.
 * /owb/timeline  progress, payment schedule, invoices
 * /owb/data      delivered data and report stats
 */
export default function OwbPortal() {
  const navigate = useNavigate();
  const { tab = 'timeline' } = useParams();
  const [me, setMe] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const account = await apiJson('/api/client/me');
      setMe(account);
      const contracts = await apiJson('/api/client/contracts');
      if (contracts.length) setTimeline(await apiJson(`/api/client/contracts/${contracts[0].id}`));
      else setTimeline({ empty: true });
    } catch (err) {
      if (/authenticated|expired|not found/i.test(err.message)) navigate('/owb', { replace: true });
      else setError(err.message);
    }
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  async function signOut() {
    await apiPost('/api/client/logout', {});
    navigate('/owb', { replace: true });
  }

  if (!TABS.some((t) => t.key === tab)) return null;

  return (
    <div style={{ minHeight: '100vh', background: parchment, fontFamily: 'var(--font-sans)', color: ink }}>
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '28px 16px 64px' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 'var(--type-ui-label-size)', letterSpacing: '0.14em', textTransform: 'uppercase', color: muted }}>
              OWB Portal · Terranthro
            </div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--type-display-medium-size)', margin: '2px 0 0', fontWeight: 600 }}>
              {me?.name || 'Oregon Wine Board'}
            </h1>
          </div>
          <button onClick={signOut} className="tx-link" style={{
            background: 'none', border: `1px solid ${alpha(TOKENS.ink, 0.2)}`, borderRadius: 6,
            padding: '6px 14px', fontSize: 'var(--type-body-size)', color: muted, cursor: 'pointer',
          }}>
            Sign out
          </button>
        </header>

        <nav style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${alpha(TOKENS.ink, 0.15)}`, marginBottom: 24 }}>
          {TABS.map((t) => (
            <Link
              key={t.key}
              to={`/owb/${t.key}`}
              className={`tx-link${tab === t.key ? ' is-active' : ''}`}
              aria-current={tab === t.key ? 'page' : undefined}
              style={{
                padding: '10px 14px', marginBottom: -1, textDecoration: 'none',
                fontSize: 'var(--type-body-size)', fontWeight: tab === t.key ? 600 : 400,
                color: tab === t.key ? ink : muted,
                borderBottom: `2px solid ${tab === t.key ? TOKENS.interactive : 'transparent'}`,
              }}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {me?.password_must_change && <ChangePassword onDone={load} />}

        {error && <p style={{ color: crimson }}>{error}</p>}
        {!timeline && !error && <p style={{ color: muted }}>Loading…</p>}
        {timeline?.empty && <p style={{ color: muted }}>No contract is set up yet.</p>}
        {timeline && !timeline.empty && (
          tab === 'timeline' ? <TimelineTab data={timeline} onChanged={load} /> : <DataTab data={timeline} />
        )}
      </div>
    </div>
  );
}

/** Shown until the shared temporary password has been replaced. */
function ChangePassword({ onDone }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (next !== confirm) return setError('New passwords do not match');
    setSaving(true);
    try {
      await apiPost('/api/client/set-password', { currentPassword: current, password: next });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const field = { ...INPUT_STYLE, flex: '1 1 180px', width: 'auto' };
  return (
    <form onSubmit={submit} style={{
      border: `1px solid ${alpha(TOKENS.amber, 0.5)}`, background: alpha(TOKENS.amber, 0.08),
      borderRadius: 10, padding: '16px 18px', marginBottom: 24,
    }}>
      <strong style={{ display: 'block', marginBottom: 4 }}>Set a new password</strong>
      <p style={{ color: muted, fontSize: 'var(--type-body-size)', margin: '0 0 12px' }}>
        You're signed in with a temporary password. Choose one your team will share (at least 10 characters).
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="password" required placeholder="Temporary password" autoComplete="current-password"
          value={current} onChange={(e) => setCurrent(e.target.value)} className="ds-input" style={field} />
        <input type="password" required minLength={10} placeholder="New password" autoComplete="new-password"
          value={next} onChange={(e) => setNext(e.target.value)} className="ds-input" style={field} />
        <input type="password" required minLength={10} placeholder="Confirm new password" autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} className="ds-input" style={field} />
        <button type="submit" disabled={saving} style={btn('primary')}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      {error && <p style={{ color: crimson, fontSize: 'var(--type-mono-size)', margin: '10px 0 0' }}>{error}</p>}
    </form>
  );
}
