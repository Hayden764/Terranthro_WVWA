/**
 * TimelineTab — the OWB Portal's build-out timeline: contract value by stage,
 * anything waiting on OWB (with Accept / Request changes), the full payment
 * schedule (expandable per line), invoices (with Approve), and the activity feed.
 */
import { useState } from 'react';
import { alpha, ink, muted, TOKENS } from '@terranthro/shared/styles/tokens.js';
import { apiUrl } from '@terranthro/shared/lib/api.js';
import {
  STAGES, STATUS, billingText, fileSize, fmtDate, lineLabel, money, stageOf,
} from '../../lib/contractFormat';
import { ApproveInvoiceForm, ReviewActions } from './ClientActions';

const line = alpha(TOKENS.ink, 0.15);
const card = { border: `1px solid ${line}`, borderRadius: 10, padding: '18px 18px', marginBottom: 20 };
const h2 = { fontSize: 'var(--type-display-italic-size)', fontFamily: 'var(--font-display)', fontWeight: 600, margin: '0 0 12px' };
const small = { fontSize: 'var(--type-mono-size)', color: muted };

export default function TimelineTab({ data, onChanged }) {
  const { contract, totals, milestones, updates, general_files: generalFiles } = data;
  const inReview = milestones.filter((m) => m.status === 'delivered');
  const upcoming = milestones.find((m) => m.status === 'in_progress' || m.status === 'revising')
    || milestones.find((m) => m.status === 'not_started');
  const invoices = milestones.flatMap((m) => m.invoices.map((inv) => ({ ...inv, milestone: m })));

  return (
    <>
      <Summary contract={contract} totals={totals} milestones={milestones} />

      {(inReview.length > 0 || upcoming) && (
        <section style={{ ...card, background: alpha(TOKENS.ink, 0.03) }}>
          {inReview.map((m) => (
            <div key={m.id} style={{ marginBottom: 16 }}>
              <p style={{ margin: 0, lineHeight: 1.5 }}>
                <Dot color={TOKENS.amber} /> <strong>{lineLabel(m)} {m.title} is waiting on your review.</strong>{' '}
                Delivered {fmtDate(m.delivered_at)}. It is accepted automatically on{' '}
                <strong>{fmtDate(m.deemed_acceptance_on)}</strong> unless OWB requests changes.
              </p>
              <ReviewActions m={m} onChanged={onChanged} />
            </div>
          ))}
          {upcoming && (
            <p style={{ margin: 0, lineHeight: 1.5 }}>
              <Dot color={TOKENS.electricBlue} /> <strong>Up next:</strong> {lineLabel(upcoming)} {upcoming.title}
              {upcoming.due_label && <span style={{ color: muted }}> · {targetText(upcoming).replace(/^Target/, 'target')}</span>}
            </p>
          )}
        </section>
      )}

      <section style={{ marginBottom: 20 }}>
        <h2 style={h2}>Milestones &amp; payment schedule</h2>
        <div style={{ border: `1px solid ${line}`, borderRadius: 10, overflow: 'hidden' }}>
          {milestones.map((m, i) => <ScheduleRow key={m.id} m={m} first={i === 0} onChanged={onChanged} />)}
        </div>
        <p style={{ ...small, marginTop: 8 }}>
          Each milestone is invoiced once accepted; payment terms are Net {contract.payment_terms_days}.
          A delivered milestone is accepted automatically after {contract.review_business_days} business days
          unless OWB requests changes.
        </p>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        <section style={{ ...card, marginBottom: 0 }}>
          <h2 style={h2}>Invoices</h2>
          {invoices.length === 0 ? (
            <p style={{ ...small, margin: 0 }}>No invoices yet. Each is issued here, with a copy of the PDF, once its milestone is accepted.</p>
          ) : (
            <InvoiceTable invoices={invoices} onChanged={onChanged} />
          )}
        </section>

        <section style={{ ...card, marginBottom: 0 }}>
          <h2 style={h2}>Updates</h2>
          {updates.length === 0 && <p style={{ ...small, margin: 0 }}>No updates posted yet.</p>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {updates.slice(0, 12).map((u) => (
              <li key={u.id} style={{ display: 'flex', gap: 12, padding: '7px 0', borderTop: `1px solid ${alpha(TOKENS.ink, 0.07)}` }}>
                <span style={{ ...small, minWidth: 52, flexShrink: 0 }}>{fmtDate(u.posted_on, { month: 'short', day: 'numeric' })}</span>
                <span style={{ fontSize: 'var(--type-body-size)', lineHeight: 1.45, whiteSpace: 'pre-line' }}>{u.body}</span>
              </li>
            ))}
          </ul>
          {generalFiles.length > 0 && (
            <>
              <h3 style={{ ...small, textTransform: 'uppercase', letterSpacing: '0.12em', margin: '16px 0 6px' }}>Project documents</h3>
              <FileList files={generalFiles} />
            </>
          )}
        </section>
      </div>
    </>
  );
}

// ─── Summary ─────────────────────────────────────────────────────

function Summary({ contract, totals, milestones }) {
  const byStage = Object.fromEntries(STAGES.map((s) => [s.key, 0]));
  for (const m of milestones) byStage[stageOf(m)] += m.amount;

  const stats = [
    { label: 'Contract total', value: money(totals.nte) },
    { label: 'Paid', value: money(totals.paid) },
    { label: 'Invoiced, awaiting payment', value: money(totals.outstanding) },
    { label: 'Not yet invoiced', value: money(totals.not_yet_billed) },
  ];

  return (
    <section style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <h2 style={{ ...h2, margin: 0 }}>{contract.title}</h2>
        <span style={small}>
          {totals.milestones_accepted} of {totals.milestones_total} milestones accepted
          {contract.effective_date && ` · contract effective ${fmtDate(contract.effective_date)}`}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, margin: '16px 0' }}>
        {stats.map((s) => (
          <div key={s.label}>
            <div style={{ fontSize: 26, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
            <div style={small}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Contract value split by stage, weighted by each line's amount. */}
      <div
        role="img"
        aria-label={STAGES.filter((s) => byStage[s.key]).map((s) => `${s.label} ${money(byStage[s.key])}`).join(', ')}
        style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: alpha(TOKENS.ink, 0.08), gap: 2 }}
      >
        {STAGES.map((s) => byStage[s.key] > 0 && (
          <div key={s.key} title={`${s.label}: ${money(byStage[s.key])}`}
            style={{ width: `${(byStage[s.key] / totals.nte) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 10 }}>
        {STAGES.filter((s) => byStage[s.key] > 0).map((s) => (
          <span key={s.key} style={small}>
            <Dot color={s.color} /> {s.label} <span style={{ color: ink, fontVariantNumeric: 'tabular-nums' }}>{money(byStage[s.key])}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

// ─── Schedule ────────────────────────────────────────────────────

function dueText(m) {
  if (m.revised_target_date) return fmtDate(m.revised_target_date, { month: 'long', year: 'numeric' });
  return m.due_label;
}

/** 'Target December 2026', or the event as written ('Upon 2026 OSIP release'). */
function targetText(m) {
  return m.target_date || m.revised_target_date ? `Target ${dueText(m)}` : dueText(m);
}

function ScheduleRow({ m, first, onChanged }) {
  const [open, setOpen] = useState(false);
  const status = STATUS[m.status];
  const billing = billingText(m);
  const doneTasks = m.tasks.filter((t) => t.done).length;
  const detailId = `milestone-${m.id}`;

  return (
    <div style={{ borderTop: first ? 'none' : `1px solid ${line}` }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={detailId}
        className="tx-row"
        style={{
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', width: '100%',
          padding: '12px 16px', background: open ? alpha(TOKENS.ink, 0.03) : 'transparent',
          border: 'none', textAlign: 'left', color: ink, font: 'inherit',
        }}
      >
        <span style={{
          minWidth: 52, fontSize: 'var(--type-mono-size)', fontWeight: 600, color: muted, fontVariantNumeric: 'tabular-nums',
        }}>
          {lineLabel(m)}
        </span>

        <span style={{ flex: '1 1 260px', minWidth: 0 }}>
          <span className="tx-title" style={{ display: 'block', fontWeight: 500, fontSize: 'var(--type-body-size)' }}>{m.title}</span>
          <span style={{ ...small, display: 'block', marginTop: 2 }}>
            {m.status === 'accepted' && m.accepted_at
              ? `Accepted ${fmtDate(m.accepted_at)}${m.accepted_by ? ` by ${m.accepted_by}` : ''}${m.acceptance === 'deemed' ? ' (review period ended)' : ''}`
              : m.status === 'delivered'
                ? `Delivered ${fmtDate(m.delivered_at)} · auto-accepts ${fmtDate(m.deemed_acceptance_on)}`
                : m.status === 'revising' && m.rejected_at
                  ? `Changes requested ${fmtDate(m.rejected_at)} · being revised`
                  : <>
                    {targetText(m)}
                    {m.revised_target_date && m.due_label && <s style={{ marginLeft: 6, opacity: 0.7 }}>{m.due_label}</s>}
                  </>}
          </span>
          {m.tasks.length > 0 && m.status !== 'accepted' && m.status !== 'not_started' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <span style={{ flex: '0 1 160px', height: 4, borderRadius: 2, background: alpha(TOKENS.ink, 0.1), overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${(m.progress || 0) * 100}%`, background: TOKENS.electricBlue }} />
              </span>
              <span style={small}>{doneTasks}/{m.tasks.length}</span>
            </span>
          )}
        </span>

        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 'auto' }}>
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(m.amount)}</span>
          <Pill color={status.color}>{status.label}</Pill>
          {billing && <span style={{ ...small, color: ink }}><Dot color={billing.color} /> {billing.text}</span>}
        </span>
        <span aria-hidden style={{ color: muted, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>›</span>
      </button>

      {open && <MilestoneDetail id={detailId} m={m} onChanged={onChanged} />}
    </div>
  );
}

function MilestoneDetail({ id, m, onChanged }) {
  const sub = { ...small, textTransform: 'uppercase', letterSpacing: '0.12em', margin: '14px 0 6px' };
  return (
    <div id={id} style={{ padding: '4px 16px 18px clamp(16px, 8vw, 82px)', background: alpha(TOKENS.ink, 0.03) }}>
      {m.work && <p style={{ margin: 0, fontSize: 'var(--type-body-size)', lineHeight: 1.55 }}>{m.work}</p>}

      <p style={{ ...small, margin: '8px 0 0' }}>
        {money(m.base_amount)} base
        {m.additional_amount > 0 && ` + ${money(m.additional_amount)} ${m.additional_label || 'additional'}`}
        {m.due_label && ` · Schedule: ${m.due_label}`}
      </p>

      {m.status === 'delivered' && <ReviewActions m={m} onChanged={onChanged} />}

      {m.status === 'revising' && m.rejection_note && (
        <p style={{ margin: '10px 0 0', padding: '8px 12px', borderLeft: `3px solid ${TOKENS.crimson}`, background: alpha(TOKENS.crimson, 0.06), fontSize: 'var(--type-body-size)', whiteSpace: 'pre-line' }}>
          <strong>Changes requested{m.rejected_by ? ` by ${m.rejected_by}` : ''} on {fmtDate(m.rejected_at)}:</strong>{'\n'}{m.rejection_note}
        </p>
      )}

      {m.delay_reason && (
        <p style={{ margin: '10px 0 0', padding: '8px 12px', borderLeft: `3px solid ${TOKENS.amber}`, background: alpha(TOKENS.amber, 0.08), fontSize: 'var(--type-body-size)' }}>
          <strong>Schedule change:</strong> {m.delay_reason}
        </p>
      )}

      {m.tasks.length > 0 && (
        <>
          <h4 style={sub}>Checklist</h4>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, columns: '2 220px', columnGap: 24 }}>
            {m.tasks.map((t) => (
              <li key={t.id} style={{ fontSize: 'var(--type-body-size)', padding: '3px 0', breakInside: 'avoid', color: t.done ? ink : muted }}>
                <span aria-hidden style={{ display: 'inline-block', width: 18, color: t.done ? TOKENS.vividGreen : muted }}>{t.done ? '✓' : '○'}</span>
                <span className="sr-only">{t.done ? 'Done: ' : 'Not done: '}</span>
                {t.label}
              </li>
            ))}
          </ul>
        </>
      )}

      {m.delivery_note && (
        <>
          <h4 style={sub}>Delivery notes</h4>
          <p style={{ margin: 0, fontSize: 'var(--type-body-size)', lineHeight: 1.55, whiteSpace: 'pre-line' }}>{m.delivery_note}</p>
        </>
      )}

      {m.files.length > 0 && (
        <>
          <h4 style={sub}>Documents</h4>
          <FileList files={m.files} />
        </>
      )}
    </div>
  );
}

// ─── Invoices + files ────────────────────────────────────────────

function InvoiceTable({ invoices, onChanged }) {
  const [approving, setApproving] = useState(null);
  const th = { ...small, textAlign: 'left', fontWeight: 500, padding: '4px 8px 6px 0' };
  const td = { fontSize: 'var(--type-body-size)', padding: '7px 8px 7px 0', borderTop: `1px solid ${alpha(TOKENS.ink, 0.07)}`, fontVariantNumeric: 'tabular-nums' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Invoice</th><th style={th}>For</th><th style={{ ...th, textAlign: 'right' }}>Amount</th>
            <th style={th}>Status</th><th style={th}><span className="sr-only">PDF</span></th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id}>
              <td style={td}>{inv.invoice_number}<div style={small}>{fmtDate(inv.issued_on)}</div></td>
              <td style={td}>{lineLabel(inv.milestone)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{money(inv.amount)}</td>
              <td style={td}>
                {inv.paid_on ? `Paid ${fmtDate(inv.paid_on, { month: 'short', day: 'numeric' })}` : (
                  <>
                    Due {fmtDate(inv.due_on, { month: 'short', day: 'numeric' })}
                    <div style={small}>
                      {inv.approved_on
                        ? `Approved ${fmtDate(inv.approved_on, { month: 'short', day: 'numeric' })}${inv.approved_by ? ` by ${inv.approved_by}` : ''}`
                        : (
                          <button type="button" onClick={() => setApproving(inv)} className="tx-link" style={{
                            background: 'none', border: 'none', padding: 0, font: 'inherit', color: TOKENS.interactive, cursor: 'pointer',
                          }}>
                            Approve for payment
                          </button>
                        )}
                    </div>
                  </>
                )}
              </td>
              <td style={td}>
                {inv.file_id && (
                  <a href={apiUrl(`/api/client/files/${inv.file_id}`)} target="_blank" rel="noreferrer"
                    className="tx-link" style={{ color: TOKENS.interactive }}>PDF</a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {approving && (
        <ApproveInvoiceForm
          key={approving.id}
          inv={approving}
          onChanged={() => { setApproving(null); onChanged(); }}
          onCancel={() => setApproving(null)}
        />
      )}
    </div>
  );
}

function FileList({ files }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {files.map((f) => (
        <li key={f.id} style={{ padding: '3px 0', fontSize: 'var(--type-body-size)' }}>
          <a href={apiUrl(`/api/client/files/${f.id}`)} target="_blank" rel="noreferrer"
            className="tx-link" style={{ color: TOKENS.interactive, textDecoration: 'none' }}>
            {f.title}
          </a>
          <span style={{ ...small, marginLeft: 8 }}>{fileSize(f.size_bytes)}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Bits ────────────────────────────────────────────────────────

function Dot({ color }) {
  return <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: color, verticalAlign: 'middle', marginBottom: 2 }} />;
}

function Pill({ color, children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px', borderRadius: 10,
      background: alpha(TOKENS.ink, 0.06), fontSize: 'var(--type-ui-label-size)', fontWeight: 600, color: ink, whiteSpace: 'nowrap',
    }}>
      <Dot color={color} /> {children}
    </span>
  );
}
