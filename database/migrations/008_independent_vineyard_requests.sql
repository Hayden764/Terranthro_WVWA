-- Migration 008: Support admin edit requests for independent vineyards
--
-- Independent vineyards do not always have a linked wineries row.
-- Allow request/audit rows to persist without winery_id in those cases.

ALTER TABLE edit_requests
  ALTER COLUMN winery_id DROP NOT NULL;

ALTER TABLE winery_edit_log
  ALTER COLUMN winery_id DROP NOT NULL;