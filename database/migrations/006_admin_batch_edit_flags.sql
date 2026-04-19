-- Migration 006: Admin batch edits + acreage-change flags
--
-- 1. Add `origin` to edit_requests — distinguishes who submitted:
--       'winery'  = winery portal user
--       'admin'   = admin via parcel editor
--
-- 2. Add `submitted_by_admin` — FK to admin_accounts for admin-origin requests
--
-- 3. Add `flag` + `flag_detail` — data-quality flag surfaced in review UI
--       flag        : NULL | 'acreage_change'  (extensible)
--       flag_detail : JSONB  e.g. { before_acres, after_acres, pct_change }
--
-- 4. New request_type 'admin_batch_edit':
--       payload is { ops: [ { op, parcel_id, ...per-op fields } ] }
--       where op ∈ 'geometry' | 'metadata'
--
-- Because edit_requests.account_id is NOT NULL in the original schema we make
-- submitted_by_admin a separate nullable column; for admin-origin rows the app
-- will set account_id to a placeholder sentinel (0 / NULL workaround handled
-- at INSERT time with a DEFAULT trigger below).
--
-- Simpler: relax account_id to nullable for admin-origin rows.

-- ─────────────────────────────────────────────
-- Relax account_id nullability (admin batch rows have no winery account)
-- ─────────────────────────────────────────────
ALTER TABLE edit_requests
  ALTER COLUMN account_id DROP NOT NULL;

-- ─────────────────────────────────────────────
-- New columns
-- ─────────────────────────────────────────────
ALTER TABLE edit_requests
  ADD COLUMN IF NOT EXISTS origin             VARCHAR(10)  NOT NULL DEFAULT 'winery',
  ADD COLUMN IF NOT EXISTS submitted_by_admin INTEGER      REFERENCES admin_accounts(id),
  ADD COLUMN IF NOT EXISTS flag               VARCHAR(40),
  ADD COLUMN IF NOT EXISTS flag_detail        JSONB;

-- ─────────────────────────────────────────────
-- Backfill: all existing rows are winery-origin
-- ─────────────────────────────────────────────
UPDATE edit_requests SET origin = 'winery' WHERE origin IS NULL OR origin = '';

-- ─────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_er_origin ON edit_requests(origin);
CREATE INDEX IF NOT EXISTS idx_er_flag   ON edit_requests(flag) WHERE flag IS NOT NULL;
