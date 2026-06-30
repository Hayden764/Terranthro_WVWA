-- 014_org_membership.sql
-- Phase 2a: WVWA membership flag on organizations (the wineries table).
--
-- Drives map color: green = vineyard linked to a WVWA-member org, gray = everything
-- else (unlinked, or linked to a non-member org once growers are added in Phase 2b).
-- All 243 existing rows are WVWA members, so DEFAULT true backfills them correctly.
ALTER TABLE wineries
  ADD COLUMN IF NOT EXISTS is_wvwa_member BOOLEAN NOT NULL DEFAULT true;
