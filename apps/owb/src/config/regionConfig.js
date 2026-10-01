/**
 * regionConfig.js — what makes this explorer statewide.
 *
 * The OWB explorer started as a copy of apps/wvwa; everything Willamette-Valley
 * specific there (sub-AVA list, curated cameras, member colouring) is driven
 * from here instead. The AVA list itself is generated from the database by
 * server/scripts/export-owb-avas.mjs.
 */
import { TOKENS } from '@terranthro/shared/styles/tokens.js';
import { OREGON_AVAS, OREGON_BOUNDS } from './oregonAvas.generated';

export const REGION_NAME = 'Oregon';
export const SITE_TITLE = 'Oregon Vineyard Atlas';

// Tree order (each parent followed by its sub-AVAs), so lists that mark
// sub-AVAs with an indent read correctly. Siblings stay alphabetical.
function treeOrder(avas) {
  const bySlug = new Map(avas.map((a) => [a.slug, a]));
  const out = [];
  const visit = (a) => { out.push(a); (a.subAvas || []).forEach((s) => bySlug.has(s) && visit(bySlug.get(s))); };
  avas.filter((a) => !a.parentAva).forEach(visit);
  return out;
}

/** Every AVA touching Oregon, in the shape the map/sidebar code expects. */
export const REGION_AVAS = treeOrder(OREGON_AVAS).map((ava) => ({ ...ava, color: TOKENS.amber }));

/** Outline the map darkens around (merged top-level AVAs). */
export const REGION_BOUNDARY_FILE = '/data/oregon_wine_regions.geojson';

export { OREGON_BOUNDS as REGION_BOUNDS };

/**
 * OWB is the statewide data owner, not a membership body: every organization
 * counts, so "member" means "has an owner on record" (API ?association=all).
 */
export const ASSOCIATION = 'all';
