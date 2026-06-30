// Vineyard map coloring is driven by WVWA membership, not by dataset.
//   • Member-owned parcels  → green, rendered by the separate "linked" layer.
//   • Everyone else (is_member false / missing) → gray "reference" layers.
// `is_member` is supplied by the API and baked into the PMTiles tileset.

// Non-member (and unknown) parcels render gray. `!= true` catches false, null,
// and absent values so anything not explicitly a member falls through to gray.
const NON_MEMBER_FILTER = ['!=', ['get', 'is_member'], true];

// Interactive (formerly Adelsheim-white) reference layers are retired: members
// are green now, so there is nothing left for this style to show.
export function buildInteractiveReferenceVineyardFilter() {
  return null;
}

// All non-member parcels render in the gray passive-reference style.
export function buildPassiveReferenceVineyardFilter() {
  return NON_MEMBER_FILTER;
}
