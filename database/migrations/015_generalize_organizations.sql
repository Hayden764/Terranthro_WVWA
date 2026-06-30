-- 015_generalize_organizations.sql
-- Phase 2b: the `wineries` table becomes a general organizations registry.
--
-- It can now hold non-WVWA growers/producers that have no WVWA listing id and no
-- tasting-room point, alongside the existing member wineries. The table keeps its
-- physical name (renaming would touch ~740 frontend recid refs for cosmetic gain);
-- new code can treat it as "organizations".
--
-- Capability flags replace the implicit "every row is a wine producer" assumption.
-- `category` (winery/restaurant/hotel) stays as the listing-type axis; these flags
-- are the producer/grower axis used by the vineyard-ownership model.

-- Growers have no WVWA recid and may have no point location.
ALTER TABLE wineries ALTER COLUMN recid    DROP NOT NULL;
ALTER TABLE wineries ALTER COLUMN location DROP NOT NULL;

ALTER TABLE wineries ADD COLUMN IF NOT EXISTS produces_wine    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE wineries ADD COLUMN IF NOT EXISTS grows_grapes     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE wineries ADD COLUMN IF NOT EXISTS has_tasting_room BOOLEAN NOT NULL DEFAULT false;

-- Backfill the 243 existing rows: all WVWA member wine producers.
-- produces_wine already true via DEFAULT; set tasting-room from the listing category.
UPDATE wineries SET has_tasting_room = true WHERE category IN ('winery', 'tasting');
