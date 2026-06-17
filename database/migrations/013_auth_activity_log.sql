-- 013_auth_activity_log.sql
-- Adds portal/admin auth activity logging plus password lifecycle flags.

ALTER TABLE winery_accounts
  ADD COLUMN IF NOT EXISTS password_must_change BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS password_last_changed_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS auth_activity_log (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES winery_accounts(id) ON DELETE SET NULL,
  winery_id INTEGER REFERENCES wineries(id) ON DELETE SET NULL,
  identifier TEXT,
  actor_admin_id INTEGER REFERENCES admin_accounts(id) ON DELETE SET NULL,
  event_type VARCHAR(80) NOT NULL,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip INET,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_activity_account_created
  ON auth_activity_log(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_activity_event_created
  ON auth_activity_log(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_activity_identifier_created
  ON auth_activity_log(identifier, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_activity_admin_created
  ON auth_activity_log(actor_admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_activity_winery_created
  ON auth_activity_log(winery_id, created_at DESC);