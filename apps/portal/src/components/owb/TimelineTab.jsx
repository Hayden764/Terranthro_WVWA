/**
 * TimelineTab — the OWB Portal's build-out timeline: where the contract
 * stands, then each schedule line with its target date, status and invoice.
 * Read-only; review and invoicing happen over email.
 */
import { alpha, ink, muted, TOKENS } from '@terranthro/shared/styles/tokens.js';
import {
  STAGES, STATUS, fmtDate, invoiceText, lineLabel, money, stageOf, targetText,
} from '../../lib/contractFormat';

const line = alpha(TOKENS.ink, 0.15);
const card = { border: `1px solid ${line}`, borderRadius: 10, padding: '18px 18px', marginBottom: 20 };
const h2 = { fontSize: 'var(--type-display-italic-size)', fontFamily: 'var(--font-display)', fontWeight: 600, margin: '0 0 12px' };
const small = { fontSize: 'var(--type-mono-size)', color: muted };

export default function TimelineTab({ data }) {
  const { contract, totals, milestones } = data;
  return (
    <>
      <Summary contract={contract} totals={totals} milestones={milestones} />

      <section style={{ marginBottom: 20 }}>
        <h2 style={h2}>Milestones &amp; payment schedule</h2>
        <div style={{ border: `1px solid ${line}`, borderRadius: 10, overflow: 'hidden' }}>
          {milestones.map((m, i) => <Row key={m.id} m={m} first={i === 0} />)}
        </div>
        <p style={{ ...small, marginTop: 8 }}>
          Each line is invoiced once complete; payment terms are Net {contract.payment_terms_days}.
        </p>
      </section>
    </>
  );
}

function Summary({ contract, totals, milestones }) {
  const byStage = Object.fromEntries(STAGES.map((s) => [s.key, 0]));
  for (const m of milestones) byStage[stageOf(m)] += m.amount;

  const stats = [
    { label: 'Contract total', value: money(totals.nte) },
    { label: 'Paid', value: money(totals.paid) },
    { label: 'Invoiced, awaiting payment', value: money(totals.outstanding) },
    { label: 'Not yet invoiced', value: money(totals.not_yet_invoiced) },
  ];

  return (
    <section style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <h2 style={{ ...h2, margin: 0 }}>{contract.title}</h2>
        <span style={small}>
          {totals.milestones_complete} of {totals.milestones_total} milestones complete
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

function Row({ m, first }) {
  const status = STATUS[m.status];
  const invoice = invoiceText(m);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '12px 16px',
      borderTop: first ? 'none' : `1px solid ${line}`,
    }}>
      <span style={{ minWidth: 52, fontSize: 'var(--type-mono-size)', fontWeight: 600, color: muted, fontVariantNumeric: 'tabular-nums' }}>
        {lineLabel(m)}
      </span>
      <span style={{ flex: '1 1 260px', minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 500, fontSize: 'var(--type-body-size)' }}>{m.title}</span>
        <span style={{ ...small, display: 'block', marginTop: 2 }}>
          {m.target_date ? `Target ${targetText(m)}` : targetText(m)}
        </span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 'auto' }}>
        <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(m.amount)}</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px', borderRadius: 10,
          background: alpha(TOKENS.ink, 0.06), fontSize: 'var(--type-ui-label-size)', fontWeight: 600, color: ink, whiteSpace: 'nowrap',
        }}>
          <Dot color={status.color} /> {status.label}
        </span>
        {invoice && <span style={{ ...small, color: ink }}><Dot color={invoice.color} /> {invoice.text}</span>}
      </span>
    </div>
  );
}

function Dot({ color }) {
  return <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: color, verticalAlign: 'middle', marginBottom: 2 }} />;
}
