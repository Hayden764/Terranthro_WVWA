-- Migration 021: Winery vineyard sites (v1)
--
-- Each organization can publish a public vineyard page (/w/:site_slug) that
-- reads the same vineyards / vineyard_blocks rows the portal edits — there is
-- no separate copy of the data to keep in sync.
--
--   wineries.site_slug       URL slug for /w/:slug. Backfilled from title.
--   wineries.site_published  Off by default — the winery opts in from the portal.
--   wineries.site_accent     Key into a curated palette (client-side), never a raw hex.
--   vineyards.site_key       Short, permanent, non-enumerable id for
--                            /w/:slug/:site_key. This is the URL a bottle QR code
--                            will point at later, so it must never change once
--                            issued (do not regenerate on rename/split).
--   vineyards.site_hidden    Per-vineyard opt-out from the winery's page.
--
-- Additive and reversible:
--   ALTER TABLE wineries  DROP COLUMN site_slug, DROP COLUMN site_published, DROP COLUMN site_accent;
--   ALTER TABLE vineyards DROP COLUMN site_key,  DROP COLUMN site_hidden;
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE wineries
  ADD COLUMN IF NOT EXISTS site_slug      VARCHAR(80),
  ADD COLUMN IF NOT EXISTS site_published BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS site_accent    VARCHAR(20);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wineries_site_slug ON wineries (site_slug);

-- Backfill slugs from titles; collisions get the row id appended.
WITH base AS (
  SELECT id,
         NULLIF(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(title), '[^a-z0-9]+', '-', 'g')), '') AS s
  FROM wineries
  WHERE site_slug IS NULL AND title IS NOT NULL
), ranked AS (
  SELECT id, s, ROW_NUMBER() OVER (PARTITION BY s ORDER BY id) AS rn FROM base WHERE s IS NOT NULL
)
UPDATE wineries w
SET site_slug = LEFT(CASE WHEN r.rn = 1 THEN r.s ELSE r.s || '-' || w.id END, 80)
FROM ranked r
WHERE w.id = r.id
  AND NOT EXISTS (SELECT 1 FROM wineries o WHERE o.site_slug = r.s AND o.id <> w.id);

ALTER TABLE vineyards
  ADD COLUMN IF NOT EXISTS site_key    VARCHAR(12),
  ADD COLUMN IF NOT EXISTS site_hidden BOOLEAN NOT NULL DEFAULT FALSE;

-- 10 hex chars = 40 bits; plenty for a few thousand vineyards, short enough for a QR.
ALTER TABLE vineyards
  ALTER COLUMN site_key SET DEFAULT SUBSTR(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT), 1, 10);
UPDATE vineyards
  SET site_key = SUBSTR(MD5(RANDOM()::TEXT || id::TEXT || CLOCK_TIMESTAMP()::TEXT), 1, 10)
  WHERE site_key IS NULL;
ALTER TABLE vineyards ALTER COLUMN site_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vineyards_site_key ON vineyards (site_key);
