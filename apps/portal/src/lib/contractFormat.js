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

export const STATUS = {
  not_started: { label: 'Not started', color: UNSTARTED },
  in_progress: { label: 'In progress', color: TOKENS.electricBlue },
  complete:    { label: 'Complete', color: TOKENS.vividGreen },
};

/** The target date, or the event the line is due on as the contract words it. */
export const targetText = (m) => (m.target_date ? fmtDate(m.target_date) : m.due_label);

/** Where the line's invoice stands, or null before one is sent. */
export function invoiceText(m) {
  if (m.invoice_paid_on) return { text: `Paid ${fmtDate(m.invoice_paid_on)}`, color: TOKENS.vividGreen };
  if (m.invoice_sent_on) return { text: `Invoice sent ${fmtDate(m.invoice_sent_on)}`, color: TOKENS.violet };
  return null;
}

/** One stage per line, combining work and billing; ordered furthest along first. */
export const STAGES = [
  { key: 'paid',        label: 'Paid',        color: TOKENS.vividGreen },
  { key: 'invoiced',    label: 'Invoiced',    color: TOKENS.violet },
  { key: 'complete',    label: 'Complete',    color: TOKENS.amber },
  { key: 'in_progress', label: 'In progress', color: TOKENS.electricBlue },
  { key: 'not_started', label: 'Not started', color: UNSTARTED },
];

export function stageOf(m) {
  if (m.invoice_paid_on) return 'paid';
  if (m.invoice_sent_on) return 'invoiced';
  return m.status;
}
