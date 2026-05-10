## Copilot Cloud Agent Prompt — Willamette Valley AVA Tour

Paste everything below the line into the "Jumpstart your project with Copilot" box.

---

Build a Vite + React 18 + TypeScript (strict mode) single-page app called "Willamette Valley AVA Tour" — a cinematic scrollytelling map of the 11 sub-AVAs of Oregon's Willamette Valley. As the user scrolls a left-side rail of "scenes," a sticky full-viewport MapLibre map smoothly flies between AVAs.

Stack (use exactly this):
- Vite + React 18 + TypeScript (strict mode enabled in `tsconfig.json`)
- Tailwind CSS 3 + PostCSS + Autoprefixer
- MapLibre GL JS v5 (no Mapbox token; use the free style https://tiles.openfreemap.org/styles/positron)
- No backend, no router, no auth, no database, no testing framework, no ESLint/Prettier config beyond Vite defaults, no GitHub Actions
- Deploy target: Vercel (static)

Project structure:
```
src/
  App.tsx
  main.tsx
  types.ts                 // AVA, AVAStats, CameraPreset, Variety types
  components/
    TourMap.tsx            // sticky MapLibre map; exposes flyTo(avaId)
    ScrollRail.tsx         // left-side scroll container of scenes
    AVAScene.tsx           // one scene: name, blurb, stat chips
    StatChip.tsx
  data/
    avas.ts                // typed array of AVA, exported as `const avas: AVA[]`
  hooks/
    useActiveScene.ts      // IntersectionObserver -> active AVA id
  styles/
    tokens.css             // CSS custom properties (placeholder, will be replaced)
    globals.css
public/
  data/                    // AVA geojson files go here later
tailwind.config.js
postcss.config.js
vite.config.ts
tsconfig.json
vercel.json                // SPA rewrite
README.md
```

Types (`src/types.ts`):
```ts
export type Variety = { name: string; percent: number };

export type AVAStats = {
  established: number;
  wineries: number;
  vineyards: number;
  totalAreaAcres: number;
  plantedAreaAcres: number;
  topVarieties: Variety[];
};

export type CameraPreset = {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  duration: number;
};

export type AVA = {
  id: string;
  name: string;
  geojsonUrl: string;
  camera: CameraPreset;
  stats: AVAStats;
  blurb: string;
};
```

Behavior:
- Map is `position: sticky; top: 0; height: 100vh` on the right ~70% of the viewport
- Left ~30% is a vertically scrolling rail; each `<AVAScene>` is a full-viewport-height section
- An IntersectionObserver (threshold ~0.5) detects the active scene and calls `map.flyTo(scene.camera)` with `essential: true`, `speed: 0.6`, `curve: 1.4`
- Clicking an AVA polygon on the map smooth-scrolls that scene into view (two-way binding via shared active-id state lifted to App)
- Render all AVA polygons as semi-transparent fills + outlines + persistent text labels; highlight the active AVA with stronger fill/outline opacity

Seed `src/data/avas.ts` with placeholder entries for all 11 AVAs: Dundee Hills, Yamhill-Carlton, Eola-Amity Hills, Chehalem Mountains, Ribbon Ridge, McMinnville, Van Duzer Corridor, Laurelwood District, Tualatin Hills, Lower Long Tom, Mount Pisgah Polk County. Use this shape:
```ts
{
  id: "dundee_hills",
  name: "Dundee Hills",
  geojsonUrl: "/data/dundee_hills.geojson",
  camera: { center: [-123.07, 45.27], zoom: 11.5, pitch: 60, bearing: 30, duration: 3500 },
  stats: { established: 1983, wineries: 0, vineyards: 0, totalAreaAcres: 0, plantedAreaAcres: 0, topVarieties: [] },
  blurb: "TODO"
}
```

Design system rules:
- Define CSS custom properties in `tokens.css`: `--color-bg`, `--color-surface`, `--color-text`, `--color-text-muted`, `--color-accent`, `--color-ava-fill`, `--color-ava-outline`, `--font-display`, `--font-body`. Use neutral placeholder values.
- Expose tokens via `tailwind.config.js` `theme.extend.colors` and `theme.extend.fontFamily` so all styling flows from tokens
- Never hardcode hex colors in components — always reference tokens via Tailwind classes or `var(--token)`

Out of scope (do not add):
- No vineyard, winery, parcel, climate, topography, or terrain layers
- No login, accounts, search backend, admin tools, or API routes
- No charting library — use inline SVG if needed
- No state management library — `useState` + props is fine
- No `any` types — prefer `unknown` + narrowing where unavoidable

Deliverables:
- Working `npm run dev` with all 11 placeholder scenes scrolling and the map flying between camera presets
- `npm run build` succeeds with no TypeScript errors
- `vercel.json` configured for SPA static hosting
- `README.md` with: prerequisites, install/dev/build commands, project structure overview, and an "Adding or editing an AVA" section explaining the `avas.ts` shape and where to drop geojson files
