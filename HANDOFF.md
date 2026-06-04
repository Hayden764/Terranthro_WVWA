# Terranthro Admin Parcel Split Handoff

## Context
- **Feature:** Admin can split a vineyard parcel polygon into two via the UI.
- **Frontend:** React (Vite), MapLibre GL, Mapbox Draw, Turf.js
- **Backend:** Node/Express, PostGIS, `/api/admin/vineyards/:parcelId/split-geometry`
- **Current Date:** May 28, 2026

## Key Files
- `src/pages/EditorPage.jsx` — Main admin editor, split modal integration
- `src/components/admin/SplitParcelModal.jsx` — Modal for split workflow
- `src/components/PortalVineyardMap.jsx` — Map component for drawing/splitting
- `server/src/routes/admin.js` — Backend split endpoint

## Split Workflow
1. **User selects a parcel and clicks “Split Polygon.”**
2. **SplitParcelModal** opens:
   - User draws a split line.
   - Client previews split with Turf.js.
   - User assigns blocks and labels.
   - On confirm, POSTs to `/api/admin/vineyards/:parcelId/split-geometry`.
3. **Backend:**
   - Splits geometry in PostGIS.
   - Creates two new parcels, reassigns blocks, deletes original.
   - Returns `{ parcel_a_id, parcel_b_id }`.
4. **Frontend:**
   - Reloads parcel list, clears selection.

## Known Issues & Fixes
- **404 on split-geometry:**
  - After split, the original parcel is deleted. Do not re-fetch or operate on it.
  - EditorPage reloads all parcels and clears selection after split.
- **MapLibre/Draw layer errors:**
  - Teardown logic in PortalVineyardMap.jsx purges draw artifacts on mode change/unmount.
  - Not a blocker for split workflow.

## Next Steps / Recommendations
- If you want to select or highlight the new parcels after split, fetch them by the returned IDs.
- Always ensure the modal is closed and state is refreshed after a split.
- If you see map layer errors, check for duplicate map/draw control initialization.

## Contact
For further questions, contact the last developer or check the code comments in the files above.
