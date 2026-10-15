-- Migration 037: Remove three non-wine organizations, fix a misspelled name
--
-- 1. Delete organizations that are not wine businesses, so they drop out of
--    the OWB organization count:
--      Bed & Breakfasts of Yamhill County (220, recid 407)  — lodging listing
--      Cascadia Getaways (222, recid 6102)                  — lodging listing
--      Closed (1373)                                        — placeholder owner
--                                                             of Tekstura Vineyard
--    Their portal accounts were never used. Tasting rooms, associations and
--    accounts cascade; Tekstura Vineyard (12436) keeps its polygon and name
--    and becomes unowned (winery_id SET NULL). Rows saved in
--    backups/pre_037_removed_orgs_20261015.json.
--
-- 2. "Wlison Vineyard" → "Wilson Vineyard" (organization 1429, its account username,
--    vineyard 12794 and its three blocks).

BEGIN;

DELETE FROM wineries WHERE id IN (220, 222, 1373);

UPDATE wineries
   SET title = 'Wilson Vineyard'
 WHERE id = 1429 AND title = 'Wlison Vineyard';

UPDATE winery_accounts
   SET username = 'wilson-vineyard'
 WHERE winery_id = 1429 AND username = 'wlison-vineyard';

UPDATE vineyards
   SET vineyard_name = 'Wilson Vineyard'
 WHERE id = 12794 AND vineyard_name = 'Wlison Vineyard';

UPDATE vineyard_blocks
   SET vineyard_name = 'Wilson Vineyard'
 WHERE vineyard_id = 12794 AND vineyard_name = 'Wlison Vineyard';

COMMIT;
