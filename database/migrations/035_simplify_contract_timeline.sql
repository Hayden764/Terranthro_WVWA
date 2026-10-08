-- Migration 035: A simpler contract timeline
--
-- The OWB Portal's Timeline tab is now just a place to check progress: each
-- schedule line shows its status (not started / in progress / complete), its
-- target date, and when its invoice was sent and paid. Review, acceptance,
-- checklists, documents and the activity feed are handled over email.
--
--   * contract_milestones.invoice_sent_on / invoice_paid_on hold the billing
--     dates directly (backfilled from contract_invoices, which was empty).
--   * status collapses to three values: delivered and accepted become
--     'complete', revising becomes 'in_progress'.
--
-- The old tables and columns (contract_tasks, contract_files,
-- contract_invoices, contract_updates, the started/delivered/accepted dates)
-- are left in place, unused, so nothing is lost.

BEGIN;

ALTER TABLE contract_milestones
    ADD COLUMN invoice_sent_on DATE,
    ADD COLUMN invoice_paid_on DATE;

UPDATE contract_milestones m
SET invoice_sent_on = i.sent, invoice_paid_on = i.paid
FROM (
    SELECT milestone_id, min(issued_on) AS sent,
           CASE WHEN bool_and(paid_on IS NOT NULL) THEN max(paid_on) END AS paid
    FROM contract_invoices WHERE milestone_id IS NOT NULL GROUP BY milestone_id
) i
WHERE i.milestone_id = m.id;

ALTER TABLE contract_milestones DROP CONSTRAINT contract_milestones_status_check;
UPDATE contract_milestones SET status = CASE
    WHEN status IN ('delivered', 'accepted') THEN 'complete'
    WHEN status = 'revising' THEN 'in_progress'
    ELSE status END;
ALTER TABLE contract_milestones ADD CONSTRAINT contract_milestones_status_check
    CHECK (status IN ('not_started', 'in_progress', 'complete'));

COMMIT;
