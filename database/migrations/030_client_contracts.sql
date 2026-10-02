-- Migration 030: Client contracts — the OWB Portal's build-out timeline
--
-- A client (OWB first) signs in with one shared login and follows a contract's
-- payment schedule: each line (build-phase hosting, then the numbered
-- milestones) moves
--
--   not_started → in_progress → delivered → accepted
--                                   │  ↑
--                                   └→ revising (OWB rejected it; re-deliver)
--
-- and is then invoiced and paid (contract_invoices). A delivered milestone is
-- deemed accepted 15 business days after delivery unless OWB rejects it — the
-- API computes that date, it is not stored.
--
--   client_accounts      one row per client = one shared login
--   contracts            a signed contract and its not-to-exceed amount
--   contract_milestones  payment-schedule lines (kind = 'hosting' | 'milestone')
--   contract_tasks       checklist under a milestone; drives its % complete
--   contract_files       PDFs shown to the client: invoices, deliverables
--   contract_invoices    one invoice per billed line, optionally with its PDF
--   contract_updates     dated notes on the client's activity feed
--
-- Files are stored in Postgres (bytea): a contract carries a few dozen PDFs.
--
-- Seeded by server/scripts/seed-owb-contract.mjs.
--
-- Additive and reversible:
--   DROP TABLE contract_updates, contract_invoices, contract_files,
--              contract_tasks, contract_milestones, contracts, client_accounts;

BEGIN;

CREATE TABLE client_accounts (
    id                    SERIAL PRIMARY KEY,
    slug                  VARCHAR(40)  NOT NULL UNIQUE,      -- 'owb'
    name                  VARCHAR(200) NOT NULL,             -- 'Oregon Wine Board'
    username              VARCHAR(80)  NOT NULL UNIQUE,      -- stored lower-case
    password_hash         TEXT,
    password_must_change  BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Who is emailed when a milestone is delivered.
    notify_emails         TEXT[]       NOT NULL DEFAULT '{}',
    last_login            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE contracts (
    id                 SERIAL PRIMARY KEY,
    client_account_id  INTEGER      NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
    slug               VARCHAR(80)  NOT NULL UNIQUE,
    title              VARCHAR(200) NOT NULL,
    nte_amount         NUMERIC(12,2) NOT NULL,
    effective_date     DATE,                                 -- set once fully executed
    payment_terms_days INTEGER      NOT NULL DEFAULT 30,
    review_business_days INTEGER    NOT NULL DEFAULT 15,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX contracts_client_idx ON contracts (client_account_id);

CREATE TABLE contract_milestones (
    id                  SERIAL PRIMARY KEY,
    contract_id         INTEGER      NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    kind                VARCHAR(20)  NOT NULL DEFAULT 'milestone'
                          CHECK (kind IN ('hosting', 'milestone')),
    number              INTEGER,                              -- NULL for hosting
    sort_order          INTEGER      NOT NULL,
    title               VARCHAR(200) NOT NULL,
    work                TEXT,                                  -- scope, verbatim from the SOW
    base_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
    additional_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
    additional_label    VARCHAR(120),                          -- e.g. 'terrain + climate'
    due_label           VARCHAR(120),                          -- as written: 'November 2026', 'Upon 2026 OSIP release'
    target_date         DATE,                                  -- for sorting / overdue checks
    revised_target_date DATE,
    delay_reason        TEXT,
    status              VARCHAR(20)  NOT NULL DEFAULT 'not_started'
                          CHECK (status IN ('not_started', 'in_progress', 'delivered', 'revising', 'accepted')),
    started_at          DATE,
    delivered_at        DATE,
    accepted_at         DATE,
    acceptance          VARCHAR(20)
                          CHECK (acceptance IN ('explicit', 'deemed', 'on_execution')),
    delivery_note       TEXT,                                  -- narrative sent with the delivery notice
    delivery_emailed_at TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (contract_id, sort_order)
);
CREATE UNIQUE INDEX contract_milestones_number_idx
    ON contract_milestones (contract_id, number) WHERE number IS NOT NULL;

CREATE TABLE contract_tasks (
    id            SERIAL PRIMARY KEY,
    milestone_id  INTEGER      NOT NULL REFERENCES contract_milestones(id) ON DELETE CASCADE,
    label         VARCHAR(200) NOT NULL,
    done          BOOLEAN      NOT NULL DEFAULT FALSE,
    done_at       DATE,
    sort_order    INTEGER      NOT NULL DEFAULT 0
);
CREATE INDEX contract_tasks_milestone_idx ON contract_tasks (milestone_id);

CREATE TABLE contract_files (
    id            SERIAL PRIMARY KEY,
    contract_id   INTEGER      NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    milestone_id  INTEGER      REFERENCES contract_milestones(id) ON DELETE SET NULL,
    kind          VARCHAR(20)  NOT NULL DEFAULT 'deliverable'
                    CHECK (kind IN ('invoice', 'deliverable', 'notice', 'other')),
    title         VARCHAR(200) NOT NULL,
    filename      VARCHAR(255) NOT NULL,
    content_type  VARCHAR(120) NOT NULL,
    size_bytes    INTEGER      NOT NULL,
    data          BYTEA        NOT NULL,
    uploaded_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX contract_files_contract_idx ON contract_files (contract_id);

CREATE TABLE contract_invoices (
    id              SERIAL PRIMARY KEY,
    contract_id     INTEGER      NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    milestone_id    INTEGER      NOT NULL REFERENCES contract_milestones(id) ON DELETE RESTRICT,
    invoice_number  VARCHAR(60)  NOT NULL,
    amount          NUMERIC(12,2) NOT NULL,
    issued_on       DATE         NOT NULL,
    due_on          DATE         NOT NULL,
    paid_on         DATE,
    file_id         INTEGER      REFERENCES contract_files(id) ON DELETE SET NULL,
    notes           TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (contract_id, invoice_number)
);
CREATE INDEX contract_invoices_milestone_idx ON contract_invoices (milestone_id);

CREATE TABLE contract_updates (
    id            SERIAL PRIMARY KEY,
    contract_id   INTEGER      NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    milestone_id  INTEGER      REFERENCES contract_milestones(id) ON DELETE SET NULL,
    body          TEXT         NOT NULL,
    posted_on     DATE         NOT NULL DEFAULT CURRENT_DATE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX contract_updates_contract_idx ON contract_updates (contract_id, posted_on DESC);

COMMIT;
