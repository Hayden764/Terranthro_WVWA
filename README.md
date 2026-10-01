# Terranthro — Willamette Valley Wine Atlas

An interactive geospatial platform for exploring, managing, and editing vineyard parcels, wineries, AVAs, climate data, and topography across the Willamette Valley wine region.

---

## Overview

Terranthro is a full-stack web application built around a MapLibre GL map interface. It combines publicly accessible vineyard and winery data with a private winery owner portal and an internal admin editing system.

**Key capabilities:**
- Interactive parcel and winery map with AVA boundary overlays
- Climate layer (PRISM data) and topography layer (1m DEM terrain COGs)
- Winery owner portal — magic-link auth, edit requests, vineyard claim workflow
- Admin console — batch parcel editor, edit request review with per-op approval editing
- PMTiles-served vector tiles from Cloudflare R2

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, MapLibre GL 5, Vite 5, Tailwind CSS |
| Backend | Node.js, Express 4, PostgreSQL + PostGIS |
| Auth | JWT (httpOnly cookies), bcryptjs, Resend (magic links) |
| Tile Serving | PMTiles via Cloudflare R2 |
| Hosting | Railway (server), Vercel (frontend) |
| Data Pipeline | Python 3 (GDAL, psycopg2, rasterio), Node.js scripts |

---

## Project Structure

One repo, several frontends, one API and one database. Each frontend is its own
Vercel project; growers sign in at a single portal whichever explorer sent them.

```
/
├── apps/
│   ├── wvwa/                # WVWA members explorer → wvwa.terranthro.com
│   │   ├── src/             #   map, sidebar, climate/topo/soil layers
│   │   └── public/data/     #   static AVA boundary GeoJSON the map draws
│   └── portal/              # Grower portal + admin console + winery sites → portal.terranthro.com
│       └── src/pages/       #   portal/, admin/, site/ (/w/:slug), EditorPage
├── packages/
│   └── shared/              # @terranthro/shared: design tokens, base CSS, API client,
│                            #   TerroirDataChips, cross-app URLs (PORTAL_URL)
├── server/                  # Express API (Railway) — shared by every frontend
│   ├── src/routes/          #   ?association=<slug> scopes membership (default wvwa)
│   └── scripts/             #   load-avas.mjs, generate-portal-credentials.mjs
├── database/
│   ├── schema.sql
│   └── migrations/          # incremental migrations (002–026)
└── data-pipeline/scripts/   # Python & Node ingestion / processing scripts
```

Planned: `apps/owb/` — OWB statewide explorer → owb.terranthro.com.

---

## Local Development

### Prerequisites

- Node.js 20+
- PostgreSQL 15+ with PostGIS
- Python 3.11+ (for data pipeline scripts)

### 1. Clone & install

```bash
git clone https://github.com/Hayden764/Terranthro_WVWA.git
cd Terranthro_WVWA

# Frontends (npm workspaces: apps/* + packages/*)
npm install

# Server (not a workspace — Railway builds it on its own)
cd server && npm install && cd ..
```

### 2. Environment variables

**Root `.env`** (Vite — shared by every app via `envDir`):
```env
VITE_MAPTILER_KEY=your_maptiler_key
VITE_API_BASE_URL=https://your-production-server.com
VITE_API_PROXY_TARGET=http://localhost:8000   # points to local Express in dev
VITE_PORTAL_URL=http://localhost:3003         # optional; where explorers send growers to sign in
```

**`server/.env`**:
```env
DATABASE_URL=postgres://user:pass@localhost:5432/terranthro
PORT=8000
NODE_ENV=development

ADMIN_JWT_SECRET=<random 64-char hex>
PORTAL_JWT_SECRET=<random 64-char hex>
PORTAL_BASE_URL=http://localhost:3003   # portal app; magic-link emails point here

RESEND_API_KEY=re_...
EMAIL_FROM=noreply@yourdomain.com

# Optional: Cloudflare R2 for terrain tiles
R2_BUCKET=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

### 3. Database setup

```bash
psql -d terranthro -f database/schema.sql
psql -d terranthro -f database/migrations/002_vineyard_parcel_topo_stats.sql
psql -d terranthro -f database/migrations/003_winery_portal_auth.sql
psql -d terranthro -f database/migrations/004_explode_multipolygons.sql
psql -d terranthro -f database/migrations/005_edit_history.sql
```

### 4. Create an admin account

```bash
# From server/
node -e "
import bcrypt from 'bcryptjs';
const hash = await bcrypt.hash('yourpassword', 12);
console.log(hash);
" --input-type=module
```

Then insert into `admin_accounts`:
```sql
INSERT INTO admin_accounts (email, password_hash, display_name, role)
VALUES ('admin@example.com', '<hash>', 'Admin', 'superadmin');
```

### 5. Run

```bash
# Terminal 1 — Express server
cd server && npm run dev

# Terminal 2 — WVWA explorer (proxies /api → localhost:8000)
npm run dev:wvwa

# Terminal 3 — grower portal + admin
npm run dev:portal
```

Explorer: `http://localhost:3002`
Portal:   `http://localhost:3003`
Server:   `http://localhost:8000`

Build one app with `npm run build:wvwa` / `npm run build:portal` (output in `apps/<app>/dist`).

### Deploying

| App | Vercel root directory | Domain |
|---|---|---|
| `apps/wvwa` | `apps/wvwa` | wvwa.terranthro.com |
| `apps/portal` | `apps/portal` | portal.terranthro.com |

The server deploys from `server/` on Railway (see `railway.toml`).

---

## Application Routes

**Explorer (`apps/wvwa`)**: `/` — the interactive map. Old `/portal/*`, `/admin/*` and `/w/*`
links are redirected to the portal app (`apps/wvwa/vercel.json`).

**Portal (`apps/portal`)**:

| Path | Description |
|---|---|
| `/admin` | Admin login |
| `/admin/dashboard` | Edit request queue, request review |
| `/admin/requests/:id` | Individual request review with diff viewer |
| `/admin/editor` | Batch parcel geometry/metadata editor |
| `/portal` | Winery owner login (magic link) |
| `/portal/dashboard` | Owner dashboard |
| `/portal/vineyards/:id` | Vineyard parcel detail & edit submission |
| `/portal/claim` | Claim an unlinked vineyard parcel |
| `/portal/profile` | Winery profile editor |
| `/portal/site` | Winery vineyard page settings |
| `/w/:slug[/:vineyardKey]` | Public winery vineyard page (`?embed=1` for iframes) |

---

## API

All routes under `/api` are served by the Express server.

| Route | Auth | Description |
|---|---|---|
| `POST /api/auth/magic-link` | Public | Send magic link email |
| `GET /api/auth/verify` | Public | Exchange token for session cookie |
| `GET /api/wineries` | API key | List wineries |
| `GET /api/vineyards` | API key | List vineyard parcels |
| `POST /api/portal/edit-request` | Portal JWT | Submit edit request |
| `POST /api/admin/login` | Public | Admin password login |
| `GET /api/admin/requests` | Admin JWT | List edit requests |
| `POST /api/admin/requests/:id/approve` | Admin JWT | Approve (with optional per-op overrides) |
| `POST /api/admin/requests/:id/reject` | Admin JWT | Reject with notes |
| `POST /api/admin/requests/batch` | Admin JWT | Submit admin batch edit from editor |

---

## Edit Request Workflow

1. **Winery owner** submits an edit via the portal (metadata, geometry, new block, etc.)
2. Request is stored in `edit_requests` with status `pending`
3. **Admin** reviews in the dashboard — sees a diff view, map overlay, and per-field changes
4. For `admin_batch_edit` requests, the reviewer can **exclude individual ops** or **edit field values** before approving
5. On approval, changes are applied to `vineyard_parcels` and logged to `winery_edit_log`

---

## Data Pipeline

Scripts live in `data-pipeline/scripts/`. Most require `DATABASE_URL` in the environment and the `.venv` activated.

| Script | Description |
|---|---|
| `fetch-prism.py` | Download PRISM climate rasters |
| `compute-ava-climate-stats.py` | Aggregate climate stats per AVA |
| `compute-parcel-topo-stats.py` | Compute elevation/slope stats per parcel |
| `download-1m-dem.py` | Download 1m DEM tiles |
| `generate-pmtiles.sh` | Generate PMTiles from PostGIS data |
| `generate-terrain-cogs.py` | Generate Cloud-Optimized GeoTIFFs for terrain |
| `seed-avas.js` | Seed AVA boundaries from TTB GeoJSON |
| `seed-vineyards.py` | Seed vineyard parcels from source datasets |
| `link-yc-wineries.py` | Link Yamhill-Carlton parcels to winery records |
| `remove-overlapping-ref-parcels.py` | Deduplicate overlapping reference parcel sources |
| `update-topo-config.js` | Regenerate topography layer config from DB |

---

## Deployment

- **Frontend**: Vercel — `npm run build` → `dist/`; set `VITE_API_BASE_URL` to your Railway server URL
- **Server**: Railway — set all `server/.env` vars as Railway environment variables; entry point is `server/src/app.js`
- **Tiles**: Upload PMTiles to Cloudflare R2 using `upload-terrain-r2.sh` / `upload-topography-r2.sh`

---

## License

Private — all rights reserved.
