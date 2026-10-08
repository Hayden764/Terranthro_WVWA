/**
 * AdminContract — Terranthro's editor for a client contract. Each schedule
 * line has a status and the dates its invoice was sent and paid; changes save
 * as you make them and show in the client's portal (/owb). Target dates come
 * from the contract and aren't edited here.
 *
 * Data releases freeze the OWB dataset (blocks with owb_dataset = true) for
 * the client's Data tab: build a draft, check its figures, then publish.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { alpha, TOKENS } from '@terranthro/shared/styles/tokens.js';
import { apiJson, apiPost, apiUrl } from '@terranthro/shared/lib/api.js';
import { STATUS, fmtDate, lineLabel, money, targetText } from '../../lib/contractFormat';

async function apiPatch(path, body) {
  return apiJson(path, { method: 'PATCH', body: JSON.stringify(body) });
}
async function apiDelete(path) {
  return apiJson(path, { method: 'DELETE' });
}

export default function AdminContract() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      const contracts = await apiJson('/api/admin/contracts');
      if (!contracts.length) return setData({ empty: true });
      setData(await apiJson(`/api/admin/contracts/${contracts[0].id}`));
    } catch (err) {
      if (/authenticated|expired/i.test(err.message)) navigate('/admin', { replace: true });
      else alert(err.message);
    }
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  // Run an action, report failures, then reload. Resolves true if it worked.
  const act = useCallback(async (fn) => {
    let ok = true;
    try {
      await fn();
    } catch (err) {
      ok = false;
      alert(err.message);
    }
    await load();
    return ok;
  }, [load]);

  if (!data) return <Shell><p style={{ color: TOKENS.muted }}>Loading…</p></Shell>;
  if (data.empty) return <Shell><p style={{ color: TOKENS.muted }}>No contracts yet — run server/scripts/seed-owb-contract.mjs.</p></Shell>;

  const { contract, totals, milestones, client } = data;

  return (
    <Shell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
        <div>
          <Link to="/admin/dashboard" style={{ color: TOKENS.muted, fontSize: 'var(--type-mono-size)', textDecoration: 'none' }}>← Admin console</Link>
          <h1 style={{ fontSize: 'var(--type-display-italic-size)', color: TOKENS.parchment, margin: '6px 0 2px' }}>{contract.title}</h1>
          <p style={{ color: TOKENS.muted, fontSize: 'var(--type-body-size)', margin: 0 }}>
            {money(totals.paid)} paid · {money(totals.outstanding)} awaiting payment · {money(totals.not_yet_invoiced)} not yet invoiced
          </p>
          <p style={{ color: TOKENS.muted, fontSize: 'var(--type-mono-size)', margin: '4px 0 0' }}>
            {client.name} login <code>{client.username}</code>
            {client.last_login ? ` · last signed in ${new Date(client.last_login).toLocaleString()}` : ' · never signed in'}
          </p>
        </div>
        <a href="/owb" target="_blank" rel="noreferrer" style={pillLink(TOKENS.success)}>View as OWB ↗</a>
      </div>

      <h2 style={sectionTitle}>Schedule</h2>
      <Unpaid milestones={milestones} />
      <div style={{ ...cardStyle, padding: 0 }}>
        {milestones.map((m) => <MilestoneRow key={m.id} m={m} act={act} />)}
      </div>

      <h2 style={sectionTitle}>Data releases</h2>
      <ReleasesEditor contractId={contract.id} milestones={milestones} act={act} />
    </Shell>
  );
}

/** Invoices sent and not yet paid, oldest first. */
function Unpaid({ milestones }) {
  const unpaid = milestones.filter((m) => invoiceState(m) === 'sent')
    .sort((a, b) => a.invoice_sent_on.localeCompare(b.invoice_sent_on));
  return (
    <p style={{
      ...cardStyle, margin: '0 0 10px', fontSize: 'var(--type-body-size)',
      color: unpaid.length ? TOKENS.amber : TOKENS.muted,
      ...(unpaid.length && { border: `1px solid ${alpha(TOKENS.amber, 0.4)}` }),
    }}>
      {unpaid.length
        ? <>Awaiting payment: {unpaid.map((m) => `${lineLabel(m)} ${money(m.amount)} (sent ${fmtDate(m.invoice_sent_on)})`).join(' · ')}</>
        : 'No unpaid invoices.'}
    </p>
  );
}

// ─── Schedule line ───────────────────────────────────────────────

const INVOICE = { none: 'Not invoiced', sent: 'Sent, unpaid', paid: 'Paid' };
const invoiceState = (m) => (m.invoice_paid_on ? 'paid' : m.invoice_sent_on ? 'sent' : 'none');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

function MilestoneRow({ m, act }) {
  const [saved, setSaved] = useState(false);

  async function save(patch) {
    if (await act(() => apiPatch(`/api/admin/contracts/milestones/${m.id}`, patch))) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }

  // Picking an invoice state fills in today's date for any step not dated yet.
  const invoice = invoiceState(m);
  function setInvoice(next) {
    if (next === 'none') {
      if (confirm(`Clear the invoice dates for ${lineLabel(m)}?`)) save({ invoice_sent_on: null, invoice_paid_on: null });
    } else if (next === 'sent') {
      save({ invoice_sent_on: m.invoice_sent_on || today(), invoice_paid_on: null });
    } else {
      save({ invoice_sent_on: m.invoice_sent_on || today(), invoice_paid_on: m.invoice_paid_on || today() });
    }
  }

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'flex-end', padding: '10px 14px',
      borderTop: `1px solid ${alpha(TOKENS.parchment, 0.06)}`,
    }}>
      <span style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', gap: 12, alignSelf: 'center' }}>
        <span style={{ minWidth: 48, color: TOKENS.muted, fontWeight: 600, fontSize: 'var(--type-mono-size)' }}>{lineLabel(m)}</span>
        <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 'var(--type-body-size)', color: TOKENS.parchment }}>{m.title}</span>
        <span style={{ display: 'block', fontSize: 'var(--type-mono-size)', color: TOKENS.muted }}>
          {money(m.amount)} · {m.target_date ? `target ${targetText(m)}` : targetText(m)}
          {saved && <span style={{ color: TOKENS.success }}> · Saved ✓</span>}
        </span>
        </span>
      </span>
      <label style={control}>
        <span style={adminLabel}>Status</span>
        <select value={m.status} onChange={(e) => save({ status: e.target.value })} style={adminInput}>
          {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
      </label>
      <label style={control}>
        <span style={adminLabel}>Invoice</span>
        <select value={invoice} onChange={(e) => setInvoice(e.target.value)} style={{
          ...adminInput,
          ...(invoice === 'sent' && { borderColor: TOKENS.amber, color: TOKENS.amber }),
          ...(invoice === 'paid' && { color: TOKENS.success }),
        }}>
          {Object.entries(INVOICE).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </label>
      <label style={control}>
        <span style={adminLabel}>Sent on</span>
        <input type="date" value={m.invoice_sent_on || ''} disabled={invoice === 'none'}
          onChange={(e) => save({ invoice_sent_on: e.target.value })} style={adminInput} />
      </label>
      <label style={control}>
        <span style={adminLabel}>Paid on</span>
        <input type="date" value={m.invoice_paid_on || ''} disabled={invoice !== 'paid'}
          onChange={(e) => save({ invoice_paid_on: e.target.value })} style={adminInput} />
      </label>
    </div>
  );
}

// ─── Data releases ───────────────────────────────────────────────

function ReleasesEditor({ contractId, milestones, act }) {
  const [info, setInfo] = useState(null);
  const [label, setLabel] = useState('');
  const [milestoneId, setMilestoneId] = useState('');
  const [scope, setScope] = useState([]);
  const [outside, setOutside] = useState(false);
  const [notes, setNotes] = useState('');
  const [building, setBuilding] = useState(false);
  const [viewing, setViewing] = useState(null);

  const reload = useCallback(async () => {
    try {
      setInfo(await apiJson(`/api/admin/contracts/${contractId}/releases`));
    } catch (err) {
      alert(err.message);
    }
  }, [contractId]);
  useEffect(() => { reload(); }, [reload]);

  // Every release action also refreshes the contract (the feed gets a line on publish).
  const run = async (fn) => {
    const ok = await act(fn);
    await reload();
    return ok;
  };

  async function build(e) {
    e.preventDefault();
    setBuilding(true);
    const ok = await run(() => apiPost(`/api/admin/contracts/${contractId}/releases`, {
      label, milestone_id: milestoneId || null, scope_avas: scope, scope_outside_avas: outside, notes,
    }));
    setBuilding(false);
    if (ok) {
      setLabel(''); setMilestoneId(''); setScope([]); setOutside(false); setNotes('');
    }
  }

  if (!info) return <div style={cardStyle}><p style={{ color: TOKENS.muted, margin: 0 }}>Loading…</p></div>;
  const liveTotal = info.live_total;
  const toggle = (slug) => setScope((sc) => (sc.includes(slug) ? sc.filter((x) => x !== slug) : [...sc, slug]));
  const text = { fontSize: 'var(--type-body-size)', color: TOKENS.parchment };

  return (
    <div style={cardStyle}>
      <p style={{ ...text, margin: '0 0 6px' }}>
        Live OWB dataset: <strong>{liveTotal.blocks.toLocaleString()} blocks, {Math.round(liveTotal.acres).toLocaleString()} ac</strong>
        {liveTotal.blocks === 0 && <span style={{ color: TOKENS.muted }}> — set owb_dataset = true on blocks delineated under the contract.</span>}
      </p>
      {info.live_by_ava.length > 0 && (
        <p style={{ ...adminLabel, lineHeight: 1.6 }}>
          {info.live_by_ava.map((r) => `${r.name} ${r.blocks} (${Math.round(r.acres)} ac)`).join(' · ')}
        </p>
      )}

      {info.releases.map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderTop: `1px solid ${alpha(TOKENS.parchment, 0.06)}`, ...text }}>
          <strong style={{ flex: '1 1 220px' }}>
            {r.label}
            <span style={{ color: TOKENS.muted, fontWeight: 400 }}>
              {r.milestone_number != null && ` · M${r.milestone_number}`} · {r.block_count?.toLocaleString()} blocks · {Math.round(r.acres).toLocaleString()} ac
            </span>
          </strong>
          <span style={{ color: r.published_at ? TOKENS.success : TOKENS.warning, fontSize: 'var(--type-mono-size)' }}>
            {r.published_at ? `published ${fmtDate(r.published_at.slice(0, 10))}` : 'draft'}
          </span>
          <button style={outlineBtn} onClick={() => setViewing(viewing === r.id ? null : r.id)}>
            {viewing === r.id ? 'Hide figures' : 'Figures'}
          </button>
          {r.published_at ? (
            <button style={outlineBtn} onClick={() => confirm(`Unpublish "${r.label}"? OWB will stop seeing it.`)
              && run(() => apiPost(`/api/admin/contracts/releases/${r.id}/unpublish`, {}))}>Unpublish</button>
          ) : (
            <>
              <button style={primaryBtn} onClick={() => confirm(`Publish "${r.label}" to OWB? Its figures become part of the record.`)
                && run(() => apiPost(`/api/admin/contracts/releases/${r.id}/publish`, {}))}>Publish</button>
              <button aria-label={`Delete ${r.label}`} style={xBtn} onClick={() => confirm(`Delete draft "${r.label}"?`)
                && run(() => apiDelete(`/api/admin/contracts/releases/${r.id}`))}>×</button>
            </>
          )}
          {viewing === r.id && <ReleaseFigures releaseId={r.id} />}
        </div>
      ))}

      <form onSubmit={build} style={{ borderTop: `1px solid ${alpha(TOKENS.parchment, 0.06)}`, marginTop: 6, paddingTop: 6 }}>
        <h3 style={subTitle}>New release</h3>
        <div style={grid}>
          <Field label="Label (shown to OWB)">
            <input required value={label} onChange={(e) => setLabel(e.target.value)} style={adminInput}
              placeholder="Willamette Valley sub-AVAs, 2024" />
          </Field>
          <Field label="Milestone">
            <select value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)} style={adminInput}>
              <option value="">—</option>
              {milestones.filter((m) => m.kind === 'milestone').map((m) => (
                <option key={m.id} value={m.id}>{lineLabel(m)} {m.title}</option>
              ))}
            </select>
          </Field>
        </div>
        <span style={{ ...adminLabel, marginTop: 10 }}>
          Copy fresh from the live data — blocks in these AVAs (everything else carries forward from the last release)
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '2px 12px' }}>
          {info.avas.map((a) => (
            <label key={a.slug} style={{ ...text, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={scope.includes(a.slug)} onChange={() => toggle(a.slug)} /> {a.name}
            </label>
          ))}
          <label style={{ ...text, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} /> Outside any AVA
          </label>
        </div>
        <Field label="Notes for OWB (optional)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...adminInput, resize: 'vertical' }} />
        </Field>
        <button type="submit" style={{ ...primaryBtn, marginTop: 10 }} disabled={building}>
          {building ? 'Building…' : 'Build draft release'}
        </button>
      </form>
    </div>
  );
}

function ReleaseFigures({ releaseId }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    apiJson(`/api/admin/contracts/releases/${releaseId}/stats`).then(setStats).catch((err) => alert(err.message));
  }, [releaseId]);
  if (!stats) return <p style={{ flexBasis: '100%', color: TOKENS.muted, margin: 0 }}>Loading…</p>;
  const s = stats.summary;
  const csv = (t) => apiUrl(`/api/admin/contracts/releases/${releaseId}/csv/${t}`);
  return (
    <div style={{ flexBasis: '100%', fontSize: 'var(--type-mono-size)', color: alpha(TOKENS.parchment, 0.8), lineHeight: 1.7 }}>
      Headline {s.headline_acres?.toLocaleString()} ac in {s.headline_blocks} blocks · {s.vineyards} vineyards ·
      removed {s.removed_acres} ac · isolated &lt;2 ac excluded {s.small_isolated_acres} ac ({s.small_isolated_blocks}) ·
      {' '}{s.unconfirmed_names} unconfirmed names · {s.needs_field} need field check
      <br />
      Counties: {stats.by_county.map((c) => `${c.county} ${Math.round(c.acres)}`).join(', ') || '—'}
      <br />
      CSV:{' '}
      {['by-ava', 'by-county', 'by-size-class', 'change', 'blocks'].map((t) => (
        <a key={t} href={csv(t)} style={{ color: TOKENS.electricBlue, marginRight: 10 }}>{t}</a>
      ))}
    </div>
  );
}

// ─── Layout + styles (match AdminDashboard) ──────────────────────

function Shell({ children }) {
  return (
    <div className="admin-light" style={{ minHeight: '100vh', background: TOKENS.ink, fontFamily: 'var(--font-sans)' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 20px' }}>{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginTop: 8 }}>
      <span style={adminLabel}>{label}</span>
      {children}
    </label>
  );
}

const control = { flex: '0 0 130px' };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0 12px' };
const sectionTitle = { fontSize: 'var(--type-body-size)', textTransform: 'uppercase', letterSpacing: '0.12em', color: TOKENS.muted, margin: '24px 0 10px' };
const subTitle = { fontSize: 'var(--type-ui-label-size)', textTransform: 'uppercase', letterSpacing: '0.12em', color: TOKENS.muted, margin: '18px 0 6px' };
const cardStyle = {
  padding: '14px 16px', borderRadius: 8,
  background: alpha(TOKENS.parchment, 0.04),
  border: `1px solid ${alpha(TOKENS.parchment, 0.06)}`,
};
const outlineBtn = {
  background: 'transparent', border: `1px solid ${alpha(TOKENS.parchment, 0.12)}`,
  borderRadius: 6, padding: '6px 14px', fontSize: 'var(--type-body-size)',
  color: alpha(TOKENS.parchment, 0.7), cursor: 'pointer', whiteSpace: 'nowrap',
};
const primaryBtn = {
  padding: '7px 16px', borderRadius: 6, border: 'none',
  background: TOKENS.electricBlue, color: TOKENS.ink, fontSize: 'var(--type-body-size)',
  fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
};
const xBtn = { background: 'none', border: 'none', color: TOKENS.muted, fontSize: 18, cursor: 'pointer', lineHeight: 1 };
const adminLabel = { display: 'block', fontSize: 'var(--type-ui-label-size)', color: TOKENS.muted, marginBottom: 3 };
const adminInput = {
  width: '100%', padding: '8px 10px', borderRadius: 6, boxSizing: 'border-box',
  border: `1px solid ${alpha(TOKENS.parchment, 0.10)}`, fontSize: 'var(--type-mono-size)',
  color: TOKENS.parchment, background: alpha(TOKENS.parchment, 0.05),
  outline: 'none',
};
const pillLink = (color) => ({
  padding: '7px 16px', borderRadius: 6, background: alpha(color, 0.15), color,
  fontSize: 'var(--type-mono-size)', fontWeight: 600, textDecoration: 'none',
  border: `1px solid ${alpha(color, 0.25)}`, whiteSpace: 'nowrap',
});
