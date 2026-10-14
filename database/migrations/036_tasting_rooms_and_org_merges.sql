-- Migration 036: Tasting rooms, duplicate-organization merges, scoped colours
--
-- 1. tasting_rooms — where a winery pours. One organization can have several
--    (Stoller has the estate and a Newberg wine bar). Seeded from the WVWA
--    listing point of every winery (wineries.location, category 'winery');
--    restaurants and hotels get none. wineries.location is left as is, so the
--    WVWA app keeps working until it reads this table.
--
-- 2. Merge listings that are the same organization:
--      Stoller Wine Bar | Newberg (242)          → Stoller Family Estate (171)
--      Résonance Dundee Hills Tasting Room (160) → Résonance (151)
--      Durant at Red Ridge Farms (241)           → Durant Vineyards (74)
--      Failla Wines Oregon (1325)                → Failla Wines (83)
--      Violet Vines Winery and Vineyard (1338)   → Violet Vines (186)
--    Stoller's and Résonance's second points (10 km and 14 km away) become
--    extra tasting rooms; Durant's is 138 m from the estate, so it is the same
--    room. Vineyards, buyers, release blocks, consents, edit requests and the
--    edit log move to the kept organization; its aliases gain the merged
--    title. The merged rows are deleted (their portal accounts were never
--    used) and recorded in organization_merges so old recids still resolve.
--
-- 3. vineyard_colors gets a scope — the association slug the colouring is for
--    ('wvwa' = members only, 'all' = statewide/OWB) — so each app keeps its own
--    graph colouring. Existing rows are the WVWA run.

BEGIN;

-- ── 1. Tasting rooms ────────────────────────────────────────────────────────
CREATE TABLE tasting_rooms (
    id               SERIAL PRIMARY KEY,
    organization_id  INTEGER NOT NULL REFERENCES wineries(id) ON DELETE CASCADE,
    name             TEXT,                 -- NULL = the organization's own name
    location         geometry(Point, 4326) NOT NULL,
    is_primary       BOOLEAN NOT NULL DEFAULT false,
    source_recid     INTEGER,              -- WVWA listing the point came from
    created_at       TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasting_rooms_org ON tasting_rooms (organization_id);
CREATE INDEX idx_tasting_rooms_location ON tasting_rooms USING gist (location);
CREATE UNIQUE INDEX idx_tasting_rooms_one_primary
    ON tasting_rooms (organization_id) WHERE is_primary;

INSERT INTO tasting_rooms (organization_id, location, is_primary, source_recid)
SELECT id, location, true, recid
FROM wineries
WHERE category = 'winery' AND location IS NOT NULL;

-- ── 2. Merges ───────────────────────────────────────────────────────────────
CREATE TABLE organization_merges (
    merged_id     INTEGER PRIMARY KEY,     -- the deleted wineries.id
    merged_recid  INTEGER,
    merged_title  TEXT NOT NULL,
    kept_id       INTEGER NOT NULL REFERENCES wineries(id) ON DELETE CASCADE,
    merged_at     TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_org_merges_recid ON organization_merges (merged_recid);

CREATE TEMP TABLE merge_pairs (drop_id INTEGER, keep_id INTEGER, room_name TEXT) ON COMMIT DROP;
INSERT INTO merge_pairs VALUES
    (242,  171, 'Stoller Wine Bar | Newberg'),
    (160,  151, 'Résonance Dundee Hills Tasting Room'),
    (241,  74,  NULL),
    (1325, 83,  NULL),
    (1338, 186, NULL);

-- Second tasting rooms (the merged listing's own point).
DELETE FROM tasting_rooms t USING merge_pairs p
WHERE t.organization_id = p.drop_id;
INSERT INTO tasting_rooms (organization_id, name, location, is_primary, source_recid)
SELECT p.keep_id, p.room_name, w.location, false, w.recid
FROM merge_pairs p JOIN wineries w ON w.id = p.drop_id
WHERE p.room_name IS NOT NULL AND w.location IS NOT NULL;

UPDATE vineyards v SET winery_id = p.keep_id
FROM merge_pairs p WHERE v.winery_id = p.drop_id;
UPDATE vineyard_block_buyers b SET buyer_winery_id = p.keep_id
FROM merge_pairs p WHERE b.buyer_winery_id = p.drop_id;
UPDATE contract_release_blocks c SET organization_id = p.keep_id
FROM merge_pairs p WHERE c.organization_id = p.drop_id;
UPDATE edit_requests e SET winery_id = p.keep_id
FROM merge_pairs p WHERE e.winery_id = p.drop_id;
UPDATE winery_edit_log l SET winery_id = p.keep_id
FROM merge_pairs p WHERE l.winery_id = p.drop_id;
-- Consents are keyed per organization; keep the kept org's own if both exist.
UPDATE organization_data_consents c SET organization_id = p.keep_id
FROM merge_pairs p
WHERE c.organization_id = p.drop_id
  AND NOT EXISTS (SELECT 1 FROM organization_data_consents k WHERE k.organization_id = p.keep_id);

UPDATE wineries k
SET aliases = array_append(k.aliases, d.title)
FROM merge_pairs p JOIN wineries d ON d.id = p.drop_id
WHERE k.id = p.keep_id AND NOT d.title = ANY (k.aliases);

INSERT INTO organization_merges (merged_id, merged_recid, merged_title, kept_id)
SELECT d.id, d.recid, d.title, p.keep_id
FROM merge_pairs p JOIN wineries d ON d.id = p.drop_id;

-- Cascades: winery_accounts (+ auth_tokens), organization_associations,
-- leftover consents.
DELETE FROM wineries w USING merge_pairs p WHERE w.id = p.drop_id;

-- ── 3. Scoped vineyard colours ──────────────────────────────────────────────
ALTER TABLE vineyard_colors ADD COLUMN scope VARCHAR(40) NOT NULL DEFAULT 'wvwa';
ALTER TABLE vineyard_colors DROP CONSTRAINT vineyard_colors_pkey;
ALTER TABLE vineyard_colors ADD PRIMARY KEY (scope, vineyard_key);
ALTER TABLE vineyard_colors ALTER COLUMN scope DROP DEFAULT;

COMMIT;
