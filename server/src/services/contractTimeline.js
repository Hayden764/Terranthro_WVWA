/**
 * Contract timeline — builds the payload behind the OWB Portal's Timeline tab
 * (and the admin editor for it) from the migration-030 tables.
 *
 * Dates travel as 'YYYY-MM-DD' strings throughout; DATE columns are cast to
 * text in SQL so node-postgres never shifts them through a local timezone.
 *
 * Derived per line:
 *   amount               base + additional
 *   progress             share of checklist tasks done (null when none)
 *   deemed_acceptance_on delivered_at + the contract's review window in Oregon
 *                        business days — the day the line is accepted if OWB
 *                        sends no rejection (contract §3.3, Exhibit A)
 *   billing              'paid' | 'invoiced' | 'overdue' | 'ready_to_invoice' | null
 */

// ── Oregon business days ─────────────────────────────────────────────────────
// Legal holidays per ORS 187.010; a Saturday holiday is observed the Friday
// before, a Sunday holiday the Monday after.

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));

function nthWeekday(year, month, weekday, n) {
  const first = utc(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utc(year, month, 1 + offset + (n - 1) * 7);
}

function lastWeekday(year, month, weekday) {
  const last = utc(year, month + 1, 0);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return utc(year, month, last.getUTCDate() - offset);
}

function observed(d) {
  const day = d.getUTCDay();
  if (day === 6) return utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1);
  if (day === 0) return utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return d;
}

const holidayCache = new Map();
function oregonHolidays(year) {
  if (!holidayCache.has(year)) {
    const days = [
      observed(utc(year, 0, 1)),        // New Year's Day
      nthWeekday(year, 0, 1, 3),        // Martin Luther King Jr. Day
      nthWeekday(year, 1, 1, 3),        // Presidents Day
      lastWeekday(year, 4, 1),          // Memorial Day
      observed(utc(year, 5, 19)),       // Juneteenth
      observed(utc(year, 6, 4)),        // Independence Day
      nthWeekday(year, 8, 1, 1),        // Labor Day
      observed(utc(year, 10, 11)),      // Veterans Day
      nthWeekday(year, 10, 4, 4),       // Thanksgiving
      observed(utc(year, 11, 25)),      // Christmas
    ];
    holidayCache.set(year, new Set(days.map(iso)));
  }
  return holidayCache.get(year);
}

function isBusinessDay(d) {
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const y = d.getUTCFullYear();
  // A Jan 1 that falls on Saturday is observed on Dec 31 of the year before.
  return !oregonHolidays(y).has(iso(d)) && !oregonHolidays(y + 1).has(iso(d));
}

/** The date `n` Oregon business days after `dateStr` (the start day not counted). */
export function addBusinessDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const cur = utc(y, m - 1, d);
  let left = n;
  while (left > 0) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (isBusinessDay(cur)) left -= 1;
  }
  return iso(cur);
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return iso(utc(y, m - 1, d + n));
}

export function todayIso() {
  // Business dates are Oregon dates.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

// ── Payload ──────────────────────────────────────────────────────────────────

const money = (v) => (v == null ? null : Number(v));

const FILE_COLUMNS = `id, milestone_id, kind, title, filename, content_type, size_bytes, uploaded_at`;

/**
 * Load the full timeline for one contract.
 * Returns null if the contract does not exist.
 */
export async function loadContractTimeline(db, contractId) {
  const { rows: [contract] } = await db.query(
    `SELECT c.id, c.slug, c.title, c.nte_amount, c.effective_date::text,
            c.payment_terms_days, c.review_business_days,
            ca.id AS client_id, ca.name AS client_name
     FROM contracts c JOIN client_accounts ca ON ca.id = c.client_account_id
     WHERE c.id = $1`,
    [contractId]
  );
  if (!contract) return null;

  const [milestonesRes, tasksRes, filesRes, invoicesRes, updatesRes] = await Promise.all([
    db.query(
      `SELECT id, kind, number, sort_order, title, work, base_amount, additional_amount,
              additional_label, due_label, target_date::text, revised_target_date::text,
              delay_reason, status, started_at::text, delivered_at::text, accepted_at::text,
              acceptance, accepted_by, rejected_at::text, rejected_by, rejection_note,
              delivery_note, delivery_emailed_at, updated_at
       FROM contract_milestones WHERE contract_id = $1 ORDER BY sort_order`,
      [contractId]
    ),
    db.query(
      `SELECT t.id, t.milestone_id, t.label, t.done, t.done_at::text, t.sort_order
       FROM contract_tasks t JOIN contract_milestones m ON m.id = t.milestone_id
       WHERE m.contract_id = $1 ORDER BY t.sort_order, t.id`,
      [contractId]
    ),
    db.query(
      `SELECT ${FILE_COLUMNS} FROM contract_files WHERE contract_id = $1 ORDER BY uploaded_at`,
      [contractId]
    ),
    db.query(
      `SELECT id, milestone_id, invoice_number, amount, issued_on::text, due_on::text,
              paid_on::text, approved_on::text, approved_by, file_id, notes
       FROM contract_invoices WHERE contract_id = $1 ORDER BY issued_on, id`,
      [contractId]
    ),
    db.query(
      `SELECT id, milestone_id, body, posted_on::text, created_at
       FROM contract_updates WHERE contract_id = $1 ORDER BY posted_on DESC, id DESC`,
      [contractId]
    ),
  ]);

  const today = todayIso();
  const reviewDays = contract.review_business_days;

  const tasksBy = groupBy(tasksRes.rows, 'milestone_id');
  const filesBy = groupBy(filesRes.rows, 'milestone_id');
  const invoicesBy = groupBy(
    invoicesRes.rows.map((inv) => ({ ...inv, amount: money(inv.amount) })),
    'milestone_id'
  );

  const milestones = milestonesRes.rows.map((m) => {
    const tasks = tasksBy.get(m.id) || [];
    const invoices = invoicesBy.get(m.id) || [];
    const amount = money(m.base_amount) + money(m.additional_amount);

    const deemedOn = m.status === 'delivered' && m.delivered_at
      ? addBusinessDays(m.delivered_at, reviewDays)
      : null;

    let billing = null;
    if (invoices.length) {
      const open = invoices.filter((i) => !i.paid_on);
      if (!open.length) billing = 'paid';
      else billing = open.some((i) => i.due_on < today) ? 'overdue' : 'invoiced';
    } else if (m.status === 'accepted') {
      billing = 'ready_to_invoice';
    }

    return {
      ...m,
      base_amount: money(m.base_amount),
      additional_amount: money(m.additional_amount),
      amount,
      effective_target_date: m.revised_target_date || m.target_date,
      progress: tasks.length ? tasks.filter((t) => t.done).length / tasks.length : null,
      deemed_acceptance_on: deemedOn,
      billing,
      tasks,
      invoices,
      files: filesBy.get(m.id) || [],
    };
  });

  const sum = (xs) => xs.reduce((s, x) => s + x, 0);
  const allInvoices = invoicesRes.rows.map((i) => money(i.amount));
  const paid = sum(invoicesRes.rows.filter((i) => i.paid_on).map((i) => money(i.amount)));
  const invoiced = sum(allInvoices);
  const accepted = milestones.filter((m) => m.status === 'accepted');
  const awaitingInvoice = sum(milestones.filter((m) => m.billing === 'ready_to_invoice').map((m) => m.amount));
  const nte = money(contract.nte_amount);

  const numbered = milestones.filter((m) => m.kind === 'milestone');
  const next = milestones.find((m) => m.status !== 'accepted') || null;

  return {
    contract: { ...contract, nte_amount: nte },
    today,
    totals: {
      nte,
      invoiced,
      paid,
      outstanding: invoiced - paid,
      awaiting_invoice: awaitingInvoice,
      not_yet_billed: nte - invoiced,
      milestones_total: numbered.length,
      milestones_accepted: numbered.filter((m) => m.status === 'accepted').length,
      lines_accepted: accepted.length,
    },
    next_up: next && { id: next.id, number: next.number, title: next.title },
    milestones,
    general_files: filesBy.get(null) || [],
    updates: updatesRes.rows,
  };
}

function groupBy(rows, key) {
  const map = new Map();
  for (const r of rows) {
    const k = r[key] ?? null;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}
