-- Migration 033: Grower data in OWB releases, gated on the grower's consent
--
-- Grower-entered block data (variety, clone, rootstock, year planted, row and
-- vine spacing, vine counts, trellis, fruit buyers, notes) is the grower's.
-- It reaches OWB — and later the grower's associations and research
-- partners — only once the organization has accepted the OWB data terms.
-- Data submitted after accepting is covered automatically; withdrawing stops
-- it from going into future releases (releases already published keep it,
-- as they are frozen).
--
--   data_terms                  versions of the terms text; the portal asks
--                               growers to accept the latest published one
--   organization_data_consents  who accepted which version, when; a row with
--                               withdrawn_at set no longer counts
--   organization_shares_with_owb(org)  true when the organization has an
--                               active acceptance of any published version
--   contract_release_blocks     + organization_id and the grower fields,
--                               filled only for consenting organizations
--
-- The draft terms are inserted unpublished. Publish a version (after review,
-- and OWB approval per Exhibit A) with:
--   UPDATE data_terms SET published_at = NOW() WHERE version = 'owb-2026-10';
--
-- Additive and reversible:
--   ALTER TABLE contract_release_blocks DROP COLUMN organization_id, DROP COLUMN grower_data,
--     DROP COLUMN variety, DROP COLUMN clone, DROP COLUMN rootstock, DROP COLUMN year_planted,
--     DROP COLUMN rows, DROP COLUMN spacing, DROP COLUMN vines_per_acre, DROP COLUMN vines,
--     DROP COLUMN trellis, DROP COLUMN fruit_sold_to, DROP COLUMN grower_notes;
--   DROP FUNCTION organization_shares_with_owb(integer);
--   DROP TABLE organization_data_consents, data_terms;

BEGIN;

CREATE TABLE data_terms (
    version       VARCHAR(40)  PRIMARY KEY,
    title         VARCHAR(200) NOT NULL,
    body          TEXT         NOT NULL,          -- plain text, paragraphs split by blank lines
    published_at  TIMESTAMPTZ,                     -- NULL = draft, not shown to growers
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE organization_data_consents (
    id               SERIAL PRIMARY KEY,
    organization_id  INTEGER      NOT NULL REFERENCES wineries(id) ON DELETE CASCADE,
    terms_version    VARCHAR(40)  NOT NULL REFERENCES data_terms(version),
    accepted_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    accepted_by_account_id INTEGER,                -- winery_accounts.id
    accepted_by_name VARCHAR(120),
    withdrawn_at     TIMESTAMPTZ
);
CREATE INDEX organization_data_consents_org_idx ON organization_data_consents (organization_id);

CREATE FUNCTION organization_shares_with_owb(org INTEGER) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM organization_data_consents c
        JOIN data_terms t ON t.version = c.terms_version
        WHERE c.organization_id = org AND c.withdrawn_at IS NULL AND t.published_at IS NOT NULL
    )
$$;

ALTER TABLE contract_release_blocks
    ADD COLUMN organization_id  INTEGER,
    ADD COLUMN grower_data      BOOLEAN NOT NULL DEFAULT FALSE,  -- organization consented at build time
    ADD COLUMN variety          TEXT,
    ADD COLUMN clone            TEXT,
    ADD COLUMN rootstock        TEXT,
    ADD COLUMN year_planted     INTEGER,
    ADD COLUMN rows             INTEGER,
    ADD COLUMN spacing          TEXT,
    ADD COLUMN vines_per_acre   NUMERIC,
    ADD COLUMN vines            INTEGER,
    ADD COLUMN trellis          TEXT,
    ADD COLUMN fruit_sold_to    TEXT,
    ADD COLUMN grower_notes     TEXT;

INSERT INTO data_terms (version, title, body) VALUES (
    'owb-2026-10',
    'Share your vineyard data with the Oregon Wine Board',
    $terms$The Oregon Wine Board (OWB) is mapping every vineyard in Oregon. Terranthro runs that project for OWB and hosts this portal.

If you agree, the block details you enter here — variety, clone, rootstock, year planted, spacing, vine counts, trellis, fruit buyers and notes — are shared with:
• the Oregon Wine Board, for any OWB purpose, including industry reports, the annual vineyard census and research it commissions;
• the AVA and winegrower associations you belong to; and
• research partners OWB contracts with, such as Oregon State University and the University of Oregon.

Your data is not sold, and is not shown on the public Oregon vineyard map unless you separately choose to show it there.

Your data stays yours. You can stop sharing at any time from Account Settings. New data reports to OWB will no longer include your details; reports already delivered keep the data they were made with.

Vineyard boundaries, acreage and site attributes (terrain, climate, soils) are mapped from public imagery and records and are part of the statewide dataset whether or not you share your details.$terms$
);

COMMIT;
