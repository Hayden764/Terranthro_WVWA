/**
 * Shared vocabulary for contract timelines — used by the OWB Portal and the
 * admin editor so both describe a milestone the same way.
 */
import { alpha, TOKENS } from '@terranthro/shared/styles/tokens.js';

const UNSTARTED = alpha(TOKENS.ink, 0.14);

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const money = (n) => usd.format(Number(n) || 0);

/** 'YYYY-MM-DD' → 'Oct 30, 2026' (no timezone shift). */
export function fmtDate(d, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!d) return '';
  return new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}

export const lineLabel = (m) => (m.number == null ? 'Hosting' : `M${m.number}`);

// Work status, in the client's words.
export const STATUS = {
  not_started: { label: 'Not started', color: UNSTARTED },
  in_progress: { label: 'In progress', color: TOKENS.electricBlue },
  delivered:   { label: 'In OWB review', color: TOKENS.amber },
  revising:    { label: 'Revising', color: TOKENS.crimson },
  accepted:    { label: 'Accepted', color: TOKENS.vividGreen },
};

/**
 * One stage per line, combining work and billing — drives the contract value
 * bar and its legend. Ordered from furthest along to least.
 */
export const STAGES = [
  { key: 'paid',        label: 'Paid',              color: TOKENS.vividGreen },
  { key: 'invoiced',    label: 'Invoiced',          color: TOKENS.violet },
  { key: 'accepted',    label: 'Accepted, to invoice', color: TOKENS.electricBlue },
  { key: 'review',      label: 'In OWB review',     color: TOKENS.amber },
  { key: 'in_progress', label: 'In progress',       color: TOKENS.muted },
  { key: 'not_started', label: 'Not started',       color: UNSTARTED },
];

export function stageOf(m) {
  if (m.billing === 'paid') return 'paid';
  if (m.billing === 'invoiced' || m.billing === 'overdue') return 'invoiced';
  if (m.status === 'accepted') return 'accepted';
  if (m.status === 'delivered') return 'review';
  if (m.status === 'in_progress' || m.status === 'revising') return 'in_progress';
  return 'not_started';
}

/** Short billing line for a schedule row, or null when nothing is billed yet. */
export function billingText(m) {
  const open = m.invoices.find((i) => !i.paid_on);
  if (m.billing === 'paid') {
    const last = m.invoices[m.invoices.length - 1];
    return { text: `Paid ${fmtDate(last.paid_on, { month: 'short', day: 'numeric' })}`, color: TOKENS.vividGreen };
  }
  if (m.billing === 'overdue') return { text: `Invoice past due (${fmtDate(open.due_on, { month: 'short', day: 'numeric' })})`, color: TOKENS.crimson };
  if (m.billing === 'invoiced') {
    const step = open.approved_on ? 'Approved for payment' : 'Invoiced';
    return { text: `${step} · due ${fmtDate(open.due_on, { month: 'short', day: 'numeric' })}`, color: TOKENS.violet };
  }
  if (m.billing === 'ready_to_invoice') return { text: 'Invoice coming', color: TOKENS.electricBlue };
  return null;
}

export const fileSize = (bytes) => (
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
);
