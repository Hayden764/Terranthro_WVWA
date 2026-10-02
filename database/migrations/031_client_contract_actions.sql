-- Migration 031: Let the client act in its portal
--
-- OWB can now, from the OWB Portal:
--   • accept a delivered milestone          → accepted_by
--   • request changes to a delivered one    → rejected_at / rejected_by / rejection_note
--     (the written rejection notice of contract §3.3; status → 'revising')
--   • approve an invoice for payment         → approved_on / approved_by
-- The portal is one shared login, so each action records the name typed by
-- whoever took it.
--
-- contracts.contractor_email is who at Terranthro is emailed when OWB acts
-- (the Contractor's Contract Administrator).
--
-- Additive and reversible:
--   ALTER TABLE contracts DROP COLUMN contractor_email;
--   ALTER TABLE contract_milestones DROP COLUMN accepted_by, DROP COLUMN rejected_at,
--     DROP COLUMN rejected_by, DROP COLUMN rejection_note;
--   ALTER TABLE contract_invoices DROP COLUMN approved_on, DROP COLUMN approved_by;

BEGIN;

ALTER TABLE contracts
    ADD COLUMN contractor_email VARCHAR(200);

ALTER TABLE contract_milestones
    ADD COLUMN accepted_by     VARCHAR(120),
    ADD COLUMN rejected_at     DATE,
    ADD COLUMN rejected_by     VARCHAR(120),
    ADD COLUMN rejection_note  TEXT;

ALTER TABLE contract_invoices
    ADD COLUMN approved_on  DATE,
    ADD COLUMN approved_by  VARCHAR(120);

UPDATE contracts SET contractor_email = 'hayden@terranthro.com'
WHERE slug = 'owb-statewide-vineyard-mapping';

COMMIT;
