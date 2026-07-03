-- 017_portal_usernames_block_notes.sql
-- Portal improvements:
--   1. Distinct usernames for winery/organization portal accounts so we can
--      pre-issue credentials (username + temp password) without depending on a
--      correct email being on file. Login accepts username OR email.
--   2. Password-rotation flags the app code already feature-detects
--      (password_must_change / password_last_changed_at) but that no prior
--      migration created.
--   3. Free-text notes (≤500 chars) on individual vineyard blocks.

-- ── Winery accounts: username + password flags ───────────────────────────────
ALTER TABLE winery_accounts
  ADD COLUMN IF NOT EXISTS username                 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS password_must_change     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS password_last_changed_at TIMESTAMP;

-- Case-insensitive uniqueness for usernames (NULLs allowed for accounts that
-- haven't been assigned one yet).
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_username_lower
  ON winery_accounts (LOWER(username));

-- Accounts can now exist for organizations without an email on file — login no
-- longer strictly requires email. contact_email keeps its UNIQUE constraint,
-- which permits multiple NULLs in Postgres.
ALTER TABLE winery_accounts
  ALTER COLUMN contact_email DROP NOT NULL;

-- ── Vineyard blocks: free-text notes ─────────────────────────────────────────
ALTER TABLE vineyard_blocks
  ADD COLUMN IF NOT EXISTS notes VARCHAR(500);
