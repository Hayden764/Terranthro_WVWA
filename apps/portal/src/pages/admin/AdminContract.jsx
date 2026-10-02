/**
 * AdminContract — Terranthro's editor for a client contract. Everything set
 * here shows up in the client's portal (/owb): milestone status and dates,
 * checklists, documents, invoices and the activity feed.
 *
 * Marking a milestone delivered offers to email the client the delivery
 * notice; nothing else emails them.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { alpha, TOKENS } from '@terranthro/shared/styles/tokens.js';
import { apiFetch, apiJson, apiPost, apiUrl } from '@terranthro/shared/lib/api.js';
import { STATUS, billingText, fileSize, fmtDate, lineLabel, money } from '../../lib/contractFormat';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

async function apiPatch(path, body) {
  return apiJson(path, { method: 'PATCH', body: JSON.stringify(body) });
}
async function apiDelete(path) {
  return apiJson(path, { method: 'DELETE' });
}
async function uploadFile(contractId, file, { title, kind, milestoneId }) {
  const qs = new URLSearchParams({ title, kind, filename: file.name });
  if (milestoneId) qs.set('milestone_id', milestoneId);
  const res = await apiFetch(`/api/admin/contracts/${contractId}/files?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
  return data;
}

export default function AdminContract() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);

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

  // Run an action, report failures, then reload.
  const act = useCallback(async (fn) => {
    try {
      await fn();
    } catch (err) {
      alert(err.message);
    }
    await load();
  }, [load]);

  if (!data) return <Shell><p style={{ color: TOKENS.muted }}>Loading…</p></Shell>;
  if (data.empty) return <Shell><p style={{ color: TOKENS.muted }}>No contracts yet — run server/scripts/seed-owb-contract.mjs.</p></Shell>;

  const { contract, totals, milestones, client, updates } = data;

  return (
    <Shell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
        <div>
          <Link to="/admin/dashboard" style={{ color: TOKENS.muted, fontSize: 'var(--type-mono-size)', textDecoration: 'none' }}>← Admin console</Link>
          <h1 style={{ fontSize: 'var(--type-display-italic-size)', color: TOKENS.parchment, margin: '6px 0 2px' }}>{contract.title}</h1>
          <p style={{ color: TOKENS.muted, fontSize: 'var(--type-body-size)', margin: 0 }}>
            {client.name} · {money(totals.invoiced)} invoiced · {money(totals.paid)} paid · {money(totals.not_yet_billed)} not yet invoiced
          </p>
        </div>
        <a href="/owb" target="_blank" rel="noreferrer" style={pillLink(TOKENS.success)}>View as OWB ↗</a>
      </div>

      <ClientSettings contract={contract} client={client} act={act} />

      <h2 style={sectionTitle}>Schedule</h2>
      {milestones.map((m) => (
        <MilestoneEditor
          key={m.id}
          m={m}
          contractId={contract.id}
          notifyEmails={client.notify_emails}
          open={openId === m.id}
          onToggle={() => setOpenId(openId === m.id ? null : m.id)}
          act={act}
        />
      ))}

      <h2 style={sectionTitle}>Activity feed</h2>
      <UpdatesEditor contractId={contract.id} milestones={milestones} updates={updates} act={act} />

      <h2 style={sectionTitle}>Project documents</h2>
      <FilesEditor contractId={contract.id} files={data.general_files} act={act} />
    </Shell>
  );
}

// ─── Client + contract settings ──────────────────────────────────

function ClientSettings({ contract, client, act }) {
  const [emails, setEmails] = useState(client.notify_emails.join(', '));
  const [effective, setEffective] = useState(contract.effective_date || '');
  return (
    <div style={{ ...cardStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 20 }}>
      <label style={{ flex: '2 1 280px' }}>
        <span style={adminLabel}>Delivery emails go to</span>
        <input value={emails} onChange={(e) => setEmails(e.target.value)} style={adminInput} />
      </label>
      <label style={{ flex: '1 1 150px' }}>
        <span style={adminLabel}>Contract effective date</span>
        <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} style={adminInput} />
      </label>
      <button
        style={primaryBtn}
        onClick={() => act(async () => {
          await apiPatch(`/api/admin/contracts/clients/${client.id}`, {
            notify_emails: emails.split(/[,\s]+/).filter(Boolean),
          });
          await apiPatch(`/api/admin/contracts/${contract.id}`, { effective_date: effective || null });
        })}
      >
        Save
      </button>
      <span style={{ ...adminLabel, flexBasis: '100%', margin: 0 }}>
        Shared login <code>{client.username}</code>
        {client.last_login ? ` · last signed in ${new Date(client.last_login).toLocaleString()}` : ' · never signed in'}
      </span>
    </div>
  );
}

// ─── Milestone ───────────────────────────────────────────────────

function MilestoneEditor({ m, contractId, notifyEmails, open, onToggle, act }) {
  const [form, setForm] = useState(() => pick(m));
  useEffect(() => { setForm(pick(m)); }, [m]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const billing = billingText(m);

  async function save() {
    const becameDelivered = form.status === 'delivered' && m.status !== 'delivered';
    const patch = { ...form };
    // Let the server stamp today's date on a status change unless one was typed.
    if (becameDelivered && !form.delivered_at) delete patch.delivered_at;
    if (form.status === 'accepted' && m.status !== 'accepted' && !form.accepted_at) {
      delete patch.accepted_at;
      delete patch.acceptance;
    }
    await act(async () => {
      await apiPatch(`/api/admin/contracts/milestones/${m.id}`, patch);
      if (becameDelivered && m.kind === 'milestone' && notifyEmails.length
          && confirm(`Email the delivery notice for ${lineLabel(m)} to ${notifyEmails.join(', ')}?`)) {
        await apiPost(`/api/admin/contracts/milestones/${m.id}/send-delivery-notice`, {});
      }
    });
  }

  return (
    <div style={{ ...cardStyle, marginBottom: 8, padding: 0 }}>
      <button onClick={onToggle} aria-expanded={open} style={{
        display: 'flex', gap: 12, alignItems: 'center', width: '100%', padding: '12px 14px',
        background: 'none', border: 'none', color: TOKENS.parchment, cursor: 'pointer', textAlign: 'left', font: 'inherit',
      }}>
        <span style={{ minWidth: 56, color: TOKENS.muted, fontWeight: 600, fontSize: 'var(--type-mono-size)' }}>{lineLabel(m)}</span>
        <span style={{ flex: 1, fontSize: 'var(--type-body-size)' }}>
          {m.title}
          {m.tasks.length > 0 && <span style={{ color: TOKENS.muted }}> · {m.tasks.filter((t) => t.done).length}/{m.tasks.length}</span>}
        </span>
        <span style={{ fontSize: 'var(--type-mono-size)', color: alpha(TOKENS.parchment, 0.7) }}>{money(m.amount)}</span>
        <span style={{ ...statusChip, background: alpha(TOKENS.parchment, 0.06) }}>
          <i style={{ ...dot, background: STATUS[m.status].color }} /> {STATUS[m.status].label}
        </span>
        {billing && <span style={{ fontSize: 'var(--type-ui-label-size)', color: alpha(TOKENS.parchment, 0.7) }}>{billing.text}</span>}
      </button>

      {open && (
        <div style={{ padding: '4px 14px 16px', borderTop: `1px solid ${alpha(TOKENS.parchment, 0.06)}` }}>
          <div style={grid}>
            <Field label="Status">
              <select value={form.status} onChange={set('status')} style={adminInput}>
                {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Started"><input type="date" value={form.started_at} onChange={set('started_at')} style={adminInput} /></Field>
            <Field label="Delivered"><input type="date" value={form.delivered_at} onChange={set('delivered_at')} style={adminInput} /></Field>
            <Field label="Accepted"><input type="date" value={form.accepted_at} onChange={set('accepted_at')} style={adminInput} /></Field>
            <Field label="Acceptance">
              <select value={form.acceptance} onChange={set('acceptance')} style={adminInput}>
                <option value="">—</option>
                <option value="explicit">OWB signed off</option>
                <option value="deemed">Deemed (15 business days)</option>
                <option value="on_execution">On contract execution</option>
              </select>
            </Field>
            <Field label="Due (as written)"><input value={form.due_label} onChange={set('due_label')} style={adminInput} /></Field>
            <Field label="Target date"><input type="date" value={form.target_date} onChange={set('target_date')} style={adminInput} /></Field>
            <Field label="Revised target"><input type="date" value={form.revised_target_date} onChange={set('revised_target_date')} style={adminInput} /></Field>
          </div>
          <Field label="Delay reason (shown to OWB when set)">
            <input value={form.delay_reason} onChange={set('delay_reason')} style={adminInput}
              placeholder="e.g. 2026 OSIP imagery released later than expected" />
          </Field>
          <Field label="Delivery notes (narrative of the completed work — in the portal and the delivery email)">
            <textarea value={form.delivery_note} onChange={set('delivery_note')} rows={4} style={{ ...adminInput, resize: 'vertical' }} />
          </Field>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <button style={primaryBtn} onClick={save}>Save milestone</button>
            {m.status === 'delivered' && (
              <>
                <span style={{ fontSize: 'var(--type-mono-size)', color: TOKENS.muted }}>
                  Deemed accepted {fmtDate(m.deemed_acceptance_on)}
                  {m.delivery_emailed_at ? ` · notice emailed ${fmtDate(m.delivery_emailed_at.slice(0, 10))}` : ' · notice not emailed'}
                </span>
                <button style={outlineBtn} onClick={() => confirm(`Email the delivery notice to ${notifyEmails.join(', ')}?`)
                  && act(() => apiPost(`/api/admin/contracts/milestones/${m.id}/send-delivery-notice`, {}))}>
                  {m.delivery_emailed_at ? 'Re-send delivery email' : 'Send delivery email'}
                </button>
              </>
            )}
          </div>

          <h3 style={subTitle}>Checklist</h3>
          <TasksEditor m={m} act={act} />

          <h3 style={subTitle}>Documents</h3>
          <FilesEditor contractId={contractId} milestoneId={m.id} files={m.files.filter((f) => f.kind !== 'invoice')} act={act} />

          <h3 style={subTitle}>Invoice</h3>
          <InvoiceEditor m={m} contractId={contractId} act={act} />
        </div>
      )}
    </div>
  );
}

function pick(m) {
  const keys = ['status', 'started_at', 'delivered_at', 'accepted_at', 'acceptance', 'due_label',
    'target_date', 'revised_target_date', 'delay_reason', 'delivery_note'];
  return Object.fromEntries(keys.map((k) => [k, m[k] ?? '']));
}

function TasksEditor({ m, act }) {
  const [label, setLabel] = useState('');
  return (
    <>
      {m.tasks.map((t) => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
          <input type="checkbox" checked={t.done} id={`task-${t.id}`}
            onChange={(e) => act(() => apiPatch(`/api/admin/contracts/tasks/${t.id}`, { done: e.target.checked }))} />
          <label htmlFor={`task-${t.id}`} style={{ flex: 1, fontSize: 'var(--type-body-size)', color: alpha(TOKENS.parchment, t.done ? 0.55 : 0.9) }}>{t.label}</label>
          <button aria-label={`Remove ${t.label}`} style={xBtn}
            onClick={() => confirm(`Remove "${t.label}"?`) && act(() => apiDelete(`/api/admin/contracts/tasks/${t.id}`))}>×</button>
        </div>
      ))}
      <form style={{ display: 'flex', gap: 8, marginTop: 6 }} onSubmit={(e) => {
        e.preventDefault();
        if (!label.trim()) return;
        act(() => apiPost(`/api/admin/contracts/milestones/${m.id}/tasks`, { label })).then(() => setLabel(''));
      }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add a checklist item" style={adminInput} />
        <button type="submit" style={outlineBtn}>Add</button>
      </form>
    </>
  );
}

function FilesEditor({ contractId, milestoneId, files, act }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [inputKey, setInputKey] = useState(0);
  return (
    <>
      {files.map((f) => (
        <div key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 'var(--type-body-size)' }}>
          <a href={apiUrl(`/api/admin/contracts/files/${f.id}`)} target="_blank" rel="noreferrer" style={{ color: TOKENS.electricBlue, flex: 1 }}>{f.title}</a>
          <span style={{ color: TOKENS.muted, fontSize: 'var(--type-mono-size)' }}>{f.kind} · {fileSize(f.size_bytes)}</span>
          <button aria-label={`Delete ${f.title}`} style={xBtn}
            onClick={() => confirm(`Delete "${f.title}"? OWB will no longer see it.`) && act(() => apiDelete(`/api/admin/contracts/files/${f.id}`))}>×</button>
        </div>
      ))}
      <form style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }} onSubmit={(e) => {
        e.preventDefault();
        if (!file) return;
        act(() => uploadFile(contractId, file, { title: title || file.name, kind: 'deliverable', milestoneId }))
          .then(() => { setFile(null); setTitle(''); setInputKey((k) => k + 1); });
      }}>
        <input key={inputKey} type="file" onChange={(e) => setFile(e.target.files[0] || null)} style={{ ...adminInput, flex: '1 1 200px' }} />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title shown to OWB" style={{ ...adminInput, flex: '1 1 200px' }} />
        <button type="submit" style={outlineBtn} disabled={!file}>Upload</button>
      </form>
    </>
  );
}

function InvoiceEditor({ m, contractId, act }) {
  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState(String(m.amount));
  const [issued, setIssued] = useState(today());
  const [pdf, setPdf] = useState(null);

  async function create() {
    let fileId = null;
    if (pdf) {
      ({ id: fileId } = await uploadFile(contractId, pdf, { title: `Invoice ${number}`, kind: 'invoice', milestoneId: m.id }));
    }
    await apiPost(`/api/admin/contracts/${contractId}/invoices`, {
      milestone_id: m.id, invoice_number: number, amount: Number(amount), issued_on: issued, file_id: fileId,
    });
  }

  return (
    <>
      {m.invoices.map((inv) => (
        <div key={inv.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0', fontSize: 'var(--type-body-size)', color: TOKENS.parchment }}>
          <strong>{inv.invoice_number}</strong>
          <span>{money(inv.amount)}</span>
          <span style={{ color: TOKENS.muted }}>issued {fmtDate(inv.issued_on)} · due {fmtDate(inv.due_on)}</span>
          {inv.file_id
            ? <a href={apiUrl(`/api/admin/contracts/files/${inv.file_id}`)} target="_blank" rel="noreferrer" style={{ color: TOKENS.electricBlue }}>PDF</a>
            : <span style={{ color: TOKENS.warning }}>no PDF</span>}
          {inv.paid_on
            ? <span style={{ color: TOKENS.success }}>paid {fmtDate(inv.paid_on)}</span>
            : (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: TOKENS.muted }}>
                Paid on
                <input type="date" onChange={(e) => e.target.value
                  && act(() => apiPatch(`/api/admin/contracts/invoices/${inv.id}`, { paid_on: e.target.value }))}
                  style={{ ...adminInput, width: 150 }} />
              </label>
            )}
          <button aria-label={`Delete invoice ${inv.invoice_number}`} style={xBtn}
            onClick={() => confirm(`Delete invoice ${inv.invoice_number}?`) && act(() => apiDelete(`/api/admin/contracts/invoices/${inv.id}`))}>×</button>
        </div>
      ))}
      {m.invoices.length === 0 && (
        <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={(e) => {
          e.preventDefault();
          if (m.status !== 'accepted' && !confirm(`${lineLabel(m)} isn't marked accepted yet. Create the invoice anyway?`)) return;
          act(create);
        }}>
          <Field label="Invoice #"><input required value={number} onChange={(e) => setNumber(e.target.value)} style={adminInput} /></Field>
          <Field label="Amount"><input required type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={adminInput} /></Field>
          <Field label="Issued"><input required type="date" value={issued} onChange={(e) => setIssued(e.target.value)} style={adminInput} /></Field>
          <Field label="PDF"><input type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files[0] || null)} style={adminInput} /></Field>
          <button type="submit" style={primaryBtn}>Create invoice</button>
        </form>
      )}
    </>
  );
}

function UpdatesEditor({ contractId, milestones, updates, act }) {
  const [body, setBody] = useState('');
  const [milestoneId, setMilestoneId] = useState('');
  return (
    <div style={cardStyle}>
      <form onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        act(() => apiPost(`/api/admin/contracts/${contractId}/updates`, { body, milestone_id: milestoneId || null }))
          .then(() => setBody(''));
      }}>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Post an update OWB will see…"
          style={{ ...adminInput, resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <select value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)} style={{ ...adminInput, width: 'auto' }}>
            <option value="">General</option>
            {milestones.map((m) => <option key={m.id} value={m.id}>{lineLabel(m)}</option>)}
          </select>
          <button type="submit" style={primaryBtn}>Post</button>
        </div>
      </form>
      {updates.map((u) => (
        <div key={u.id} style={{ display: 'flex', gap: 10, padding: '6px 0', borderTop: `1px solid ${alpha(TOKENS.parchment, 0.06)}`, marginTop: 6, fontSize: 'var(--type-body-size)', color: TOKENS.parchment }}>
          <span style={{ color: TOKENS.muted, minWidth: 90 }}>{fmtDate(u.posted_on)}</span>
          <span style={{ flex: 1, whiteSpace: 'pre-line' }}>{u.body}</span>
          <button aria-label="Delete update" style={xBtn}
            onClick={() => confirm('Delete this update?') && act(() => apiDelete(`/api/admin/contracts/updates/${u.id}`))}>×</button>
        </div>
      ))}
    </div>
  );
}

// ─── Layout + styles (match AdminDashboard) ──────────────────────

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: TOKENS.ink, fontFamily: 'var(--font-sans)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px' }}>{children}</div>
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

const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0 12px' };
const sectionTitle = { fontSize: 'var(--type-body-size)', textTransform: 'uppercase', letterSpacing: '0.12em', color: TOKENS.muted, margin: '24px 0 10px' };
const subTitle = { fontSize: 'var(--type-ui-label-size)', textTransform: 'uppercase', letterSpacing: '0.12em', color: TOKENS.muted, margin: '18px 0 6px' };
const dot = { display: 'inline-block', width: 8, height: 8, borderRadius: 4 };
const statusChip = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px', borderRadius: 10, fontSize: 'var(--type-ui-label-size)', fontWeight: 600, color: TOKENS.parchment, whiteSpace: 'nowrap' };
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
  outline: 'none', colorScheme: 'dark',
};
const pillLink = (color) => ({
  padding: '7px 16px', borderRadius: 6, background: alpha(color, 0.15), color,
  fontSize: 'var(--type-mono-size)', fontWeight: 600, textDecoration: 'none',
  border: `1px solid ${alpha(color, 0.25)}`, whiteSpace: 'nowrap',
});
