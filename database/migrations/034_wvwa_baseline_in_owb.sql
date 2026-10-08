-- Migration 034: The WVWA mapping goes into the OWB dataset
--
-- Two changes, both about who the data belongs to:
--
-- 1. vineyard_blocks.grower_supplied — TRUE when the block's planting
--    details (variety, clone, rootstock, year planted, spacing, vines,
--    trellis, notes) were entered by the grower through the portal. Only
--    those wait for the grower to accept the OWB data terms (migration 033).
--    Details Terranthro compiled from public sources (the default, FALSE) go
--    to OWB directly. Grower portal edits set it from now on
--    (services/applyDataRequest.js). Backfilled from the edit-request
--    history: Elk Cove's 2026-07-15 block edit is the only grower-entered
--    planting data so far.
--
-- 2. Every mapped WVWA block (2,597 legacy tax-lot blocks covering Chehalem
--    Mountains, Dundee Hills, Laurelwood District, Ribbon Ridge and
--    Yamhill-Carlton; 1,950 model blocks covering the six western sub-AVAs)
--    joins the OWB dataset as the Willamette Valley baseline. Contract
--    re-delineation (M2/M3) will replace these region by region.
--    Blocks without geometry (the Adelsheim CSV rows) cannot be mapped and
--    stay out until they have boundaries.
--
-- Releases record it too (contract_release_blocks.grower_supplied), so a
-- carried-forward block's details are only dropped when they were the
-- grower's and the grower has stopped sharing.
--
-- Reversible:
--   UPDATE vineyard_blocks SET owb_dataset = FALSE;
--   ALTER TABLE vineyard_blocks DROP COLUMN grower_supplied;
--   ALTER TABLE contract_release_blocks DROP COLUMN grower_supplied;

BEGIN;

ALTER TABLE vineyard_blocks
    ADD COLUMN grower_supplied BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contract_release_blocks
    ADD COLUMN grower_supplied BOOLEAN NOT NULL DEFAULT FALSE;

-- Planting fields a grower changed through the portal (block names aren't
-- grower-owned data, so a rename alone doesn't count).
UPDATE vineyard_blocks SET grower_supplied = TRUE
WHERE id IN (
    SELECT (bc->>'id')::int
    FROM edit_requests r,
         jsonb_array_elements(r.payload->'block_changes') bc,
         jsonb_array_elements(bc->'field_changes') fc
    WHERE r.request_type = 'vineyard_blocks'
      AND r.status IN ('approved', 'auto_applied')
      AND r.origin = 'winery'
      AND r.submitted_by_admin IS NULL
      AND fc->>'field' <> 'block_name'
);

-- Blocks a grower added through the portal.
UPDATE vineyard_blocks SET grower_supplied = TRUE
WHERE id IN (
    SELECT l.record_id
    FROM winery_edit_log l JOIN edit_requests r ON r.id = l.request_id
    WHERE l.table_name = 'vineyard_blocks' AND l.action = 'insert'
      AND r.origin = 'winery' AND r.submitted_by_admin IS NULL
);

UPDATE vineyard_blocks SET owb_dataset = TRUE WHERE geometry IS NOT NULL;

COMMIT;
