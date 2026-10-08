/**
 * Contract timeline — the payload behind the OWB Portal's Timeline tab and
 * the admin editor for it.
 *
 * Each schedule line has a status (not_started | in_progress | complete), a
 * target date (or the event it is due on, as the contract words it) and the
 * dates its invoice was sent and paid. Dates travel as 'YYYY-MM-DD' strings;
 * DATE columns are cast to text so node-postgres never shifts them.
 */

const money = (v) => (v == null ? null : Number(v));

/** Load one contract's timeline, or null if it does not exist. */
export async function loadContractTimeline(db, contractId) {
  const { rows: [contract] } = await db.query(
    `SELECT c.id, c.slug, c.title, c.nte_amount, c.effective_date::text, c.payment_terms_days,
            ca.id AS client_id, ca.name AS client_name
     FROM contracts c JOIN client_accounts ca ON ca.id = c.client_account_id
     WHERE c.id = $1`,
    [contractId]
  );
  if (!contract) return null;

  const { rows } = await db.query(
    `SELECT id, kind, number, title, base_amount + additional_amount AS amount,
            due_label, target_date::text, status, invoice_sent_on::text, invoice_paid_on::text
     FROM contract_milestones WHERE contract_id = $1 ORDER BY sort_order`,
    [contractId]
  );
  const milestones = rows.map((m) => ({ ...m, amount: money(m.amount) }));

  const sum = (xs) => xs.reduce((s, m) => s + m.amount, 0);
  const nte = money(contract.nte_amount);
  const paid = sum(milestones.filter((m) => m.invoice_paid_on));
  const invoiced = sum(milestones.filter((m) => m.invoice_sent_on || m.invoice_paid_on));
  const numbered = milestones.filter((m) => m.kind === 'milestone');

  return {
    contract: { ...contract, nte_amount: nte },
    totals: {
      nte,
      paid,
      outstanding: invoiced - paid,
      not_yet_invoiced: nte - invoiced,
      milestones_total: numbered.length,
      milestones_complete: numbered.filter((m) => m.status === 'complete').length,
    },
    milestones,
  };
}
