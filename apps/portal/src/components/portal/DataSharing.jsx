/**
 * Sharing grower data with the Oregon Wine Board (migration 033).
 *
 * <DataSharingPrompt />   dashboard card asking an organization to accept the
 *                         OWB data terms; "Not now" hides it for this session
 * <DataSharingSection />  Account Settings: current status, accept or withdraw
 *
 * Both render nothing until a version of the terms has been published.
 */
import { useEffect, useState } from 'react';
import { alpha, border, crimson, ink, muted, TOKENS } from '@terranthro/shared/styles/tokens.js';
import { btn } from '@terranthro/shared/styles/patterns.js';
import { apiJson, apiPost } from '@terranthro/shared/lib/api.js';

const DISMISS_KEY = 'owb-data-terms-dismissed';

function useDataTerms() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    apiJson('/api/portal/data-terms').then(setStatus).catch(() => setStatus(null));
  }, []);
  return [status, setStatus];
}

function fmt(ts) {
  return ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

function TermsBody({ body }) {
  return body.split(/\n{2,}/).map((para, i) => (
    <p key={i} style={{ margin: '0 0 10px', lineHeight: 1.55, whiteSpace: 'pre-line', fontSize: 'var(--type-body-size)' }}>{para}</p>
  ));
}

/** Name + agree button; calls onAccepted with the new status. */
function AcceptForm({ terms, onAccepted, onCancel }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onAccepted(await apiPost('/api/portal/data-terms/accept', { version: terms.version, name }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 4 }}>
      <label style={{ flex: '1 1 220px' }}>
        <span style={{ display: 'block', fontSize: 'var(--type-mono-size)', color: muted, marginBottom: 4 }}>Your name</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" style={{
          width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6,
          border: `1px solid ${alpha(TOKENS.ink, 0.25)}`, background: 'transparent', color: ink, font: 'inherit',
        }} />
      </label>
      <button type="submit" disabled={busy} style={{ ...btn('primary'), opacity: busy ? 0.7 : 1 }}>
        {busy ? 'Saving…' : 'I agree — share my data'}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} style={{ ...btn('ghost'), color: ink, border: `1px solid ${alpha(TOKENS.ink, 0.35)}` }}>
          Not now
        </button>
      )}
      {error && <p style={{ flexBasis: '100%', color: crimson, margin: 0, fontSize: 'var(--type-mono-size)' }}>{error}</p>}
    </form>
  );
}

export function DataSharingPrompt() {
  const [status, setStatus] = useDataTerms();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [justAccepted, setJustAccepted] = useState(false);

  if (justAccepted) {
    return (
      <div style={{ ...cardStyle, borderColor: alpha(TOKENS.success, 0.5), background: TOKENS.successDim }}>
        Thank you — your vineyard details are now shared with the Oregon Wine Board. You can change this in Account Settings.
      </div>
    );
  }
  if (!status?.needs_acceptance || dismissed) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // storage blocked — hide for this page view only
    }
    setDismissed(true);
  };

  return (
    <div style={cardStyle}>
      <strong style={{ display: 'block', fontSize: 'var(--type-display-italic-size)', fontFamily: 'var(--font-display)', marginBottom: 6 }}>
        {status.terms.title}
      </strong>
      {open ? (
        <>
          <TermsBody body={status.terms.body} />
          <AcceptForm terms={status.terms} onAccepted={(s) => { setStatus(s); setJustAccepted(true); }} onCancel={dismiss} />
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 12px', lineHeight: 1.55, color: ink }}>
            Help the Oregon Wine Board report accurately on Oregon's vineyards by sharing the block details you've
            entered here — variety, clone, planting year and the like. You stay in control and can stop at any time.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setOpen(true)} style={btn('primary')}>Read and decide</button>
            <button onClick={dismiss} style={{ ...btn('ghost'), color: ink, border: `1px solid ${alpha(TOKENS.ink, 0.35)}` }}>Not now</button>
          </div>
        </>
      )}
    </div>
  );
}

export function DataSharingSection() {
  const [status, setStatus] = useDataTerms();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  if (!status?.terms) return null;

  async function withdraw() {
    if (!confirm('Stop sharing your vineyard details with the Oregon Wine Board? Reports already delivered keep the data they were made with.')) return;
    try {
      setStatus(await apiPost('/api/portal/data-terms/withdraw', {}));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <hr style={{ margin: '36px 0', border: 'none', borderTop: `1px solid ${border}` }} />
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--type-display-italic-size)', color: ink, marginBottom: 6 }}>
        Data sharing with the Oregon Wine Board
      </h2>
      {status.sharing && !status.needs_acceptance ? (
        <>
          <p style={{ color: ink, lineHeight: 1.55, margin: '0 0 12px' }}>
            Sharing. Accepted by {status.consent.accepted_by_name} on {fmt(status.consent.accepted_at)}.
          </p>
          <button onClick={() => setReading((r) => !r)} className="tx-link" style={linkBtn}>
            {reading ? 'Hide the terms' : 'Read the terms'}
          </button>
          {reading && <div style={{ marginTop: 10 }}><TermsBody body={status.terms.body} /></div>}
          <div style={{ marginTop: 14 }}>
            <button onClick={withdraw} style={btn('danger')}>Stop sharing</button>
          </div>
        </>
      ) : (
        <>
          <p style={{ color: muted, lineHeight: 1.55, margin: '0 0 12px' }}>
            {status.sharing
              ? 'The terms have been updated since you accepted them. Please review them to keep sharing.'
              : 'Not sharing. Your block details stay private to you.'}
          </p>
          <TermsBody body={status.terms.body} />
          <AcceptForm terms={status.terms} onAccepted={setStatus} />
        </>
      )}
      {error && <p style={{ color: crimson, fontSize: 'var(--type-mono-size)' }}>{error}</p>}
    </div>
  );
}

const cardStyle = {
  background: alpha(TOKENS.electricBlue, 0.06), border: `1px solid ${alpha(TOKENS.electricBlue, 0.35)}`,
  borderRadius: 10, padding: '18px 20px', marginBottom: 24, color: ink,
};
const linkBtn = {
  background: 'none', border: 'none', padding: 0, color: TOKENS.interactive, cursor: 'pointer',
  font: 'inherit', fontSize: 'var(--type-body-size)',
};
