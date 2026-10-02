/**
 * What OWB can do in its portal: accept a delivered milestone, request
 * changes to it (the contract's written rejection), and approve an invoice
 * for payment. The login is shared, so each form asks who is acting; the
 * name is remembered on this browser.
 */
import { useState } from 'react';
import { alpha, crimson, ink, muted, TOKENS } from '@terranthro/shared/styles/tokens.js';
import { btn } from '@terranthro/shared/styles/patterns.js';
import { apiPost } from '@terranthro/shared/lib/api.js';
import { lineLabel, money } from '../../lib/contractFormat';

const NAME_KEY = 'owb-portal-actor-name';

function rememberedName() {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}

function rememberName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // private window / blocked storage — just ask again next time
  }
}

// Light inputs for the parchment portal (the shared INPUT_STYLE is dark).
const field = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6,
  border: `1px solid ${alpha(TOKENS.ink, 0.25)}`, background: alpha(TOKENS.ink, 0.02),
  color: ink, font: 'inherit', fontSize: 'var(--type-body-size)',
};
const ghostBtn = { ...btn('ghost'), color: ink, border: `1px solid ${alpha(TOKENS.ink, 0.35)}` };

/** One confirm-and-submit form: who is acting, plus a reason when needed. */
function ActionForm({ title, explain, needsReason, submitLabel, onSubmit, onCancel }) {
  const [name, setName] = useState(rememberedName);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      rememberName(name.trim());
      await onSubmit({ name: name.trim(), reason: reason.trim() });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{
      marginTop: 10, padding: '14px 16px', borderRadius: 8,
      border: `1px solid ${alpha(TOKENS.ink, 0.2)}`, background: alpha(TOKENS.parchment, 0.6),
    }}>
      <strong style={{ display: 'block', marginBottom: 4 }}>{title}</strong>
      <p style={{ margin: '0 0 10px', color: muted, fontSize: 'var(--type-body-size)', lineHeight: 1.5 }}>{explain}</p>
      {needsReason && (
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ display: 'block', fontSize: 'var(--type-mono-size)', color: muted, marginBottom: 4 }}>
            What needs to change
          </span>
          <textarea required minLength={10} rows={4} value={reason} onChange={(e) => setReason(e.target.value)}
            style={{ ...field, resize: 'vertical' }} />
        </label>
      )}
      <label style={{ display: 'block', marginBottom: 12, maxWidth: 320 }}>
        <span style={{ display: 'block', fontSize: 'var(--type-mono-size)', color: muted, marginBottom: 4 }}>Your name</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" style={field} />
      </label>
      {error && <p style={{ color: crimson, fontSize: 'var(--type-mono-size)', margin: '0 0 10px' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="submit" disabled={busy} style={{ ...btn('primary'), opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} style={ghostBtn}>Cancel</button>
      </div>
    </form>
  );
}

/** Accept / Request changes for a delivered milestone. */
export function ReviewActions({ m, onChanged }) {
  const [mode, setMode] = useState(null);
  const label = lineLabel(m);

  if (!mode) {
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button type="button" onClick={() => setMode('accept')} style={btn('primary')}>Accept {label}</button>
        <button type="button" onClick={() => setMode('changes')} style={ghostBtn}>Request changes</button>
      </div>
    );
  }

  return mode === 'accept' ? (
    <ActionForm
      title={`Accept ${label}: ${m.title}`}
      explain={`Accepting confirms this milestone meets the contract's acceptance criteria. Terranthro will then invoice ${money(m.amount)}.`}
      submitLabel={`Accept ${label}`}
      onSubmit={async ({ name }) => {
        await apiPost(`/api/client/milestones/${m.id}/accept`, { name });
        onChanged();
      }}
      onCancel={() => setMode(null)}
    />
  ) : (
    <ActionForm
      title={`Request changes to ${label}`}
      explain="Describe what doesn't meet the acceptance criteria. This is OWB's written notice of rejection under the contract; Terranthro has 15 business days to revise and re-deliver."
      needsReason
      submitLabel="Send request"
      onSubmit={async ({ name, reason }) => {
        await apiPost(`/api/client/milestones/${m.id}/request-changes`, { name, reason });
        onChanged();
      }}
      onCancel={() => setMode(null)}
    />
  );
}

/** Approve an invoice for payment (shown under the invoice table). */
export function ApproveInvoiceForm({ inv, onChanged, onCancel }) {
  return (
    <ActionForm
      title={`Approve invoice ${inv.invoice_number}`}
      explain={`Confirms ${money(inv.amount)} is approved for payment (Net 30).`}
      submitLabel="Approve for payment"
      onSubmit={async ({ name }) => {
        await apiPost(`/api/client/invoices/${inv.id}/approve`, { name });
        onChanged();
      }}
      onCancel={onCancel}
    />
  );
}
