-- Migration 003: Winery Portal Authentication & Request System
-- Magic-link auth for winery owners, admin accounts, and edit request workflow

-- ─────────────────────────────────────────────
-- Winery accounts (one login per winery)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS winery_accounts (
    id              SERIAL PRIMARY KEY,
    winery_id       INTEGER NOT NULL UNIQUE REFERENCES wineries(id) ON DELETE CASCADE,
    contact_email   VARCHAR(255) NOT NULL UNIQUE,
    email_verified  BOOLEAN DEFAULT FALSE,
    last_login      TIMESTAMP,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_winery ON winery_accounts(winery_id);

-- ─────────────────────────────────────────────
-- Magic-link tokens (short-lived, single-use)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_tokens (
    id          SERIAL PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES winery_accounts(id) ON DELETE CASCADE,
    token_hash  VARCHAR(64) NOT NULL UNIQUE,   -- sha256 of the raw token
    expires_at  TIMESTAMP NOT NULL,
    used        BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_at_account ON auth_tokens(account_id);
CREATE INDEX IF NOT EXISTS idx_at_expires ON auth_tokens(expires_at);

-- ─────────────────────────────────────────────
-- Admin accounts (email + bcrypt password)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_accounts (
    id              SERIAL PRIMARY KEY,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    display_name    VARCHAR(100),
    role            VARCHAR(20) DEFAULT 'admin',  -- 'admin' | 'superadmin'
    last_login      TIMESTAMP,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Edit requests (all winery/vineyard edits go through approval)
-- request_type: 'profile' | 'vineyard_varietals' | 'vineyard_blocks'
--               | 'vineyard_claim' | 'vineyard_new' | 'geometry_update'
-- payload: JSONB with the proposed changes
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edit_requests (
    id              SERIAL PRIMARY KEY,
    winery_id       INTEGER NOT NULL REFERENCES wineries(id) ON DELETE CASCADE,
    account_id      INTEGER NOT NULL REFERENCES winery_accounts(id) ON DELETE CASCADE,
    request_type    VARCHAR(40) NOT NULL,
    target_id       INTEGER,                    -- parcel or block id, NULL for profile edits
    payload         JSONB NOT NULL DEFAULT '{}',
    status          VARCHAR(20) DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
    admin_notes     TEXT,
    reviewed_by     INTEGER REFERENCES admin_accounts(id),
    reviewed_at     TIMESTAMP,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_er_winery   ON edit_requests(winery_id);
CREATE INDEX IF NOT EXISTS idx_er_status   ON edit_requests(status);
CREATE INDEX IF NOT EXISTS idx_er_type     ON edit_requests(request_type);
CREATE INDEX IF NOT EXISTS idx_er_account  ON edit_requests(account_id);

-- ─────────────────────────────────────────────
-- Audit log (records applied changes after approval)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS winery_edit_log (
    id              SERIAL PRIMARY KEY,
    winery_id       INTEGER NOT NULL REFERENCES wineries(id),
    account_id      INTEGER REFERENCES winery_accounts(id),
    admin_id        INTEGER REFERENCES admin_accounts(id),
    request_id      INTEGER REFERENCES edit_requests(id),
    table_name      VARCHAR(60) NOT NULL,
    record_id       INTEGER NOT NULL,
    field_name      VARCHAR(100),
    old_value       TEXT,
    new_value       TEXT,
    action          VARCHAR(20) DEFAULT 'update',  -- 'update' | 'insert' | 'delete'
    edited_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wel_winery ON winery_edit_log(winery_id);
CREATE INDEX IF NOT EXISTS idx_wel_request ON winery_edit_log(request_id);
