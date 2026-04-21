-- 007_portal_password_auth.sql
-- Adds optional password authentication to winery portal accounts.
-- Winery owners can set a password via the portal profile page and use it
-- instead of (or alongside) magic-link email login.

ALTER TABLE winery_accounts
  ADD COLUMN IF NOT EXISTS password_hash TEXT DEFAULT NULL;
