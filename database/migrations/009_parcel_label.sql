-- ─────────────────────────────────────────────
-- 009: Per-parcel display label
--
-- Some vineyards (e.g. Shea Vineyard) have many parcels under one vineyard
-- name. Wineries use their own naming conventions for these (e.g. "Block 7B",
-- "West Hill A"). `parcel_label` is an admin-editable per-parcel display name.
-- When set, it is shown on the map and in the parcel picker instead of the
-- generic "#1, #2, …" auto-numbering.
-- ─────────────────────────────────────────────
ALTER TABLE vineyard_parcels
  ADD COLUMN IF NOT EXISTS parcel_label TEXT;
