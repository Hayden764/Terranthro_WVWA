# Handoff: "Regenerate map tiles" admin button

## Goal
Add a one-click **"Publish map tiles"** action to the admin panel that reruns the
vineyard color assignment + PMTiles build and uploads the result to R2, so
DB edits (new vineyard names, winery links, member colors, reshaped footprints)
appear on the live map without a manual local pipeline run + upload.

**Why this exists:** the live map renders from a *static* `vineyard_blocks.pmtiles`
file served from R2/CDN — not a live DB query. Any name/color/footprint change
in the DB is invisible on the map until that file is regenerated and re-uploaded.
Today that's a manual local step (`generate-pmtiles.sh` + hand-run `aws s3 cp`).

---

## ⚠️ Read this first — the make-or-break constraint

**The API server does NOT have the geo toolchain.** Tile generation needs
`tippecanoe` and `ogr2ogr`/`gdal` (see `data-pipeline/scripts/generate-pmtiles.sh`).
The production API (`api.terranthro.com`) is a plain Node service — there is **no
`Dockerfile`/`nixpacks` config** in the repo, so it's on a default Node buildpack
with none of those binaries. A button that naively shells out to
`generate-pmtiles.sh` on the API host **will not work**.

So the FIRST thing to do in the new session is decide the execution model. Three
options, in order of recommendation:

### Option A (recommended): admin endpoint triggers an external CI job
- Button → `POST /api/admin/regenerate-tiles` → triggers a **GitHub Actions
  `workflow_dispatch`** (repo `Hayden764/Terranthro_WVWA`). The workflow runs on a
  runner that installs `tippecanoe`+`gdal`, runs
  `assign-vineyard-colors.py` → `generate-pmtiles.sh` → uploads both `.pmtiles`
  to R2, then done.
- Server stays thin (just kicks off the job + reports status via the GH API).
- Keeps heavy toolchain off the API host. Async by nature — button shows
  "regenerating…", job takes ~1–2 min.
- Needs: a `.github/workflows/regen-tiles.yml`, a GH token with `workflow`
  scope stored as a server env var, and R2 creds as GH Actions secrets.

### Option B: give the API server the toolchain (custom Docker image)
- Add a `Dockerfile` for the server that installs tippecanoe + gdal, switch the
  host to deploy from it, then the endpoint can run the pipeline in a child
  process and upload directly (server already has `aws-sdk` v2).
- Simpler request flow, but a much heavier server image and couples tile-building
  to the API host's CPU/memory. Regeneration blocks or backgrounds on the API box.

### Option C (strategic alternative — consider before building A/B): kill static tiles
- Serve **dynamic vector tiles from PostGIS via `ST_AsMVT`** at
  `GET /api/vineyards/tiles/{z}/{x}/{y}.pbf`, and point the MMapLibre source at that
  instead of `pmtiles://…`. The map becomes **live** — no regeneration, no upload,
  no button, ever. This directly eliminates the user's actual pain ("do I have to
  re-upload every time?").
- Bigger change (new tiled endpoint + frontend source swap in `WVWAMap.jsx`,
  lines ~2490–2600 where the `vineyards-reference` vector source + `source-layer:
  'vineyard_blocks'` layers are set up), and you lose tippecanoe's simplification/
  zoom-dropping (need to handle simplification per-zoom in SQL). But it's the
  "right" long-term answer. **Flag this to the user and let them choose** before
  committing to A/B — they asked for the button, but they may prefer this once they
  see it removes the re-upload loop entirely.

**Recommendation:** confirm with the user which model they want. If they still
want the button (A/B), build **Option A** — it fits the existing PaaS deploy
without re-architecting the server image.

---

## Concrete facts (verified in the codebase)

### Auth — how to gate the new endpoint
- `server/src/routes/admin.js` line **108**: `router.use(requireAdminAuth);`
  Every route defined *after* that line is auto-authenticated. **Define the new
  route after line 108** and it's gated for free. For a destructive/expensive
  action, consider `requireSuperadmin` (imported already; used e.g. line 937).
- Mounted in `server/src/app.js` line 80: `app.use('/api/admin', adminRoutes);`
  (no extra middleware at mount — all gating is inside admin.js).

### The pipeline scripts (the thing being automated)
- `data-pipeline/scripts/assign-vineyard-colors.py` — assigns member identity
  colors into the `vineyard_colors` table (graph-coloring by adjacency). Run
  this BEFORE building tiles so new member vineyards get a color.
- `data-pipeline/scripts/generate-pmtiles.sh` — exports `vineyard_blocks` (joined
  to vineyards/wineries/colors) + winery points from PostGIS, builds
  `vineyard_blocks.pmtiles` and `wineries.pmtiles` into
  `client-wvwa/public/tiles/`. **Currently it only PRINTS the upload command**
  (lines 156–158), it does not upload. The regen job needs to actually run the
  upload after this.
- Both read `DATABASE_URL` (from `server/.env` or env).

### R2 upload — pattern already exists in the repo
- `data-pipeline/scripts/upload-topography-r2.sh` and `upload-terrain-r2.sh` are
  existing R2 upload scripts — model the tiles upload on these.
- `data-pipeline/scripts/download-1m-dem.py` (lines ~446–459) shows the exact R2
  call shape: endpoint `https://{account_id}.r2.cloudflarestorage.com`, passed via
  `aws s3 ... --endpoint-url`. R2 uses the S3 API.
- **Config gap:** `server/.env.example` has `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET=terranthro-data`, `AWS_REGION=us-west-2`
  — but **no R2 account_id / endpoint URL**. That must be added (as a server env
  var for Option B, or a GH Actions secret for Option A). The live tiles bucket +
  the `tiles/` key prefix must match what `VITE_PMTILES_URL` points at.

### Frontend
- `src/components/WVWAMap.jsx` line 36: `PMTILES_URL = import.meta.env.VITE_PMTILES_URL`.
  Baked at build time. As long as the regen job overwrites the **same R2 key**, the
  frontend needs no rebuild — but **CDN/edge cache may need busting** (either a
  cache-purge step, or accept propagation delay). PMTiles are range-requested, so
  a partially-cached old file can corrupt reads — safest to purge or version the key.
- The map source layer is `'vineyard_blocks'` (WVWAMap.jsx lines 794, 2500, 2512,
  2584) with `promoteId: 'vineyard_id'`.

### Admin dashboard (where the button goes)
- `src/pages/admin/AdminDashboard.jsx` — uses `apiJson` / `apiPost` / `apiFetch`
  helpers from `src/lib/api`. Button-based UI (see the existing account cards /
  buttons ~lines 118, 275, 312). Add a "Map Publishing" card with a
  "Publish tiles" button + a status line (last run, in-progress spinner).

---

## Suggested implementation (Option A)

1. **`.github/workflows/regen-tiles.yml`** — `workflow_dispatch` trigger.
   Steps: checkout → install tippecanoe (`brew`/`apt` or a prebuilt action) + gdal
   → `pip install` the data-pipeline deps → run `assign-vineyard-colors.py`
   (`--commit`) → run `generate-pmtiles.sh` → `aws s3 cp` both `.pmtiles` to
   `s3://terranthro-data/tiles/…` with `--endpoint-url` the R2 endpoint →
   (optional) purge CDN cache. `DATABASE_URL` + R2 creds as repo secrets.
2. **Server endpoint** — in `admin.js` after line 108:
   `POST /api/admin/regenerate-tiles` → uses a GH token (server env
   `GITHUB_DISPATCH_TOKEN`) to `POST` the workflow_dispatch via GitHub's REST API
   (`/repos/Hayden764/Terranthro_WVWA/actions/workflows/regen-tiles.yml/dispatches`).
   Return `202 Accepted`. Optionally `GET /api/admin/regenerate-tiles/status`
   that reads the latest workflow run status from the GH API for the UI.
   Log the trigger to `winery_edit_log` or `auth_activity_log` for an audit trail.
3. **Frontend** — add the card + button to `AdminDashboard.jsx`; POST on click,
   poll the status endpoint, show "Publishing… / Published ✓ (timestamp)".
4. **Docs/env** — add the new env vars to `server/.env.example` and document the
   R2 endpoint + GH token setup.

## Verification
- Manually trigger the workflow once from the GitHub UI; confirm it builds and
  the R2 objects update (check `aws s3 ls` against the R2 endpoint, or the file's
  Last-Modified).
- Hit the admin endpoint (authenticated) and confirm it kicks off a run.
- After a run completes, hard-reload the live map (cache-bust) and confirm a
  recently-edited vineyard (e.g. **"Three Wives Vineyard"**, vineyard `id 13988`,
  linked to Remy Wines `winery_id 150`) now renders with its name + member color.
- Confirm a non-superadmin (if you gated with `requireSuperadmin`) gets 403.

## Context / recent history
- The DB was recently migrated to the unified `vineyards` + `vineyard_blocks`
  model (migration 018) and geometry columns constrained to strict `MultiPolygon`
  (migration 019). The map tiles are the last piece that isn't live.
- The user edits vineyards directly in **QGIS against the Supabase Postgres**
  (bypassing the admin approval flow — it's a solo workflow). So this button is
  their "publish to the live map" step after a batch of QGIS edits.
