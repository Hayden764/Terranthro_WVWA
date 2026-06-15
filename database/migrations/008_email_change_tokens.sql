-- Migration 008: Email change verification tokens
-- Allows winery accounts to securely change their login email address

CREATE TABLE IF NOT EXISTS email_change_tokens (
    id              SERIAL PRIMARY KEY,
    account_id      INTEGER NOT NULL REFERENCES winery_accounts(id) ON DELETE CASCADE,
    new_email       VARCHAR(255) NOT NULL,
    token_hash      VARCHAR(64) NOT NULL UNIQUE,   -- sha256 of the raw token
    expires_at      TIMESTAMP NOT NULL,
    used            BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ect_account ON email_change_tokens(account_id);
CREATE INDEX IF NOT EXISTS idx_ect_expires ON email_change_tokens(expires_at);
