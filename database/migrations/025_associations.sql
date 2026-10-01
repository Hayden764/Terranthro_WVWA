-- Migration 025: Associations (multi-tenant membership)
--
-- Replaces the single-association flag `wineries.is_wvwa_member` (migration 014)
-- with a registry of associations and a many-to-many membership table, so the
-- same organization can belong to WVWA, a future Umpqua / Southern Oregon
-- association, etc. Each consumer app (WVWA explorer, OWB statewide explorer)
-- asks the API for its own association's members via ?association=<slug>.
--
--   associations               One row per membership body (slug is the API key).
--   organization_associations  organization (wineries.id) ↔ association.
--
-- Transition: `wineries.is_wvwa_member` is kept for one release as a read-only
-- mirror of WVWA membership, maintained by a trigger on organization_associations,
-- so anything not yet migrated (old deploys, ad-hoc scripts) keeps reading the
-- right value. Write membership to organization_associations only. The column
-- and trigger are dropped in a later migration once nothing reads them.
--
-- Additive and reversible:
--   DROP TRIGGER trg_org_assoc_mirror_wvwa ON organization_associations;
--   DROP FUNCTION org_assoc_mirror_wvwa();
--   DROP TABLE organization_associations; DROP TABLE associations;
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS associations (
  id          SERIAL PRIMARY KEY,
  slug        VARCHAR(40)  NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  name        TEXT         NOT NULL,
  -- 'regional' = an AVA/area winery association; 'statewide' = e.g. a state body.
  kind        VARCHAR(20)  NOT NULL DEFAULT 'regional' CHECK (kind IN ('regional', 'statewide')),
  website     TEXT,
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_associations (
  organization_id  INTEGER     NOT NULL REFERENCES wineries(id)     ON DELETE CASCADE,
  association_id   INTEGER     NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  member_since     DATE,
  -- Where the membership fact came from (listing feed, admin, backfill, …).
  source           VARCHAR(40) NOT NULL DEFAULT 'admin',
  created_at       TIMESTAMP   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, association_id)
);

-- The PK covers organization → associations; this covers association → members.
CREATE INDEX IF NOT EXISTS idx_org_assoc_association ON organization_associations (association_id);

INSERT INTO associations (slug, name, kind, website)
VALUES ('wvwa', 'Willamette Valley Wineries Association', 'regional', 'https://www.willamettewines.com')
ON CONFLICT (slug) DO NOTHING;

-- Backfill from the legacy flag.
INSERT INTO organization_associations (organization_id, association_id, source)
SELECT w.id, a.id, 'is_wvwa_member'
FROM wineries w
CROSS JOIN associations a
WHERE a.slug = 'wvwa' AND w.is_wvwa_member
ON CONFLICT DO NOTHING;

-- Keep the legacy column mirroring WVWA membership during the transition.
CREATE OR REPLACE FUNCTION org_assoc_mirror_wvwa() RETURNS trigger AS $$
DECLARE
  wvwa_id INTEGER;
  org_id  INTEGER;
BEGIN
  SELECT id INTO wvwa_id FROM associations WHERE slug = 'wvwa';
  org_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  IF (CASE WHEN TG_OP = 'DELETE' THEN OLD.association_id ELSE NEW.association_id END) = wvwa_id
     OR (TG_OP = 'UPDATE' AND OLD.association_id = wvwa_id) THEN
    UPDATE wineries w
    SET is_wvwa_member = EXISTS (
      SELECT 1 FROM organization_associations oa
      WHERE oa.organization_id = w.id AND oa.association_id = wvwa_id
    )
    WHERE w.id IN (org_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.organization_id END);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_org_assoc_mirror_wvwa ON organization_associations;
CREATE TRIGGER trg_org_assoc_mirror_wvwa
  AFTER INSERT OR UPDATE OR DELETE ON organization_associations
  FOR EACH ROW EXECUTE FUNCTION org_assoc_mirror_wvwa();

-- New organizations no longer default to WVWA members: membership must be an
-- explicit organization_associations row (the 014 DEFAULT true predates growers).
ALTER TABLE wineries ALTER COLUMN is_wvwa_member SET DEFAULT false;

-- Fresh tables have no planner stats; without them the membership subquery
-- used by every tile/parcel request is planned as if it held ~3 rows.
ANALYZE associations;
ANALYZE organization_associations;

COMMIT;
