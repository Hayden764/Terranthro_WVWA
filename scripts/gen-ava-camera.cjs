'use strict';
const fs   = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'public', 'data');

const avas = [
  { slug: 'chehalem-mountains',       file: 'chehalem_mountains.geojson' },
  { slug: 'dundee-hills',             file: 'dundee_hills.geojson' },
  { slug: 'eola-amity-hills',         file: 'eola_amity_hills.geojson' },
  { slug: 'laurelwood-district',      file: 'laurelwood_district.geojson' },
  { slug: 'lower-long-tom',           file: 'lower_long_tom.geojson' },
  { slug: 'mcminnville',              file: 'mcminnville.geojson' },
  { slug: 'mount-pisgah-polk-county', file: 'mount_pisgah_polk_county.geojson' },
  { slug: 'ribbon-ridge',             file: 'ribbon_ridge.geojson' },
  { slug: 'tualatin-hills',           file: 'tualatin_hills.geojson' },
  { slug: 'van-duzer-corridor',       file: 'van_duzer_corridor.geojson' },
  { slug: 'yamhill-carlton',          file: 'yamhill_carlton.geojson' },
];

// Approximate zoom for a ~900px wide viewport given a degree span.
// ln2(360/span) gives zoom where the span fills the whole world width.
// Subtract 1 to compensate for the narrower map viewport (panel takes ~350px).
// Padding multiplier 1.25 adds breathing room around the AVA.
function bboxToZoom(minLng, maxLng, minLat, maxLat) {
  const lngSpan = maxLng - minLng;
  // latitude degrees need scaling by ~cos(lat) to match lng degrees on screen
  const midLat  = (minLat + maxLat) / 2;
  const latSpanScaled = (maxLat - minLat) / Math.cos(midLat * Math.PI / 180);
  const span = Math.max(lngSpan, latSpanScaled) * 1.25; // 25% padding
  const zoom = Math.log2(360 / span) - 1.0;
  return Math.round(zoom * 10) / 10;
}

function scanCoords(coords, bbox) {
  if (typeof coords[0] === 'number') {
    if (coords[0] < bbox.minLng) bbox.minLng = coords[0];
    if (coords[0] > bbox.maxLng) bbox.maxLng = coords[0];
    if (coords[1] < bbox.minLat) bbox.minLat = coords[1];
    if (coords[1] > bbox.maxLat) bbox.maxLat = coords[1];
  } else {
    coords.forEach(c => scanCoords(c, bbox));
  }
}

console.log('export const AVA_CAMERA = {');

for (const ava of avas) {
  const filePath = path.join(dataDir, ava.file);
  const gj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const bbox = { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity };
  const features = gj.features || [gj];
  features.forEach(f => scanCoords(f.geometry.coordinates, bbox));

  const cLng = +((bbox.minLng + bbox.maxLng) / 2).toFixed(4);
  const cLat = +((bbox.minLat + bbox.maxLat) / 2).toFixed(4);
  const zoom = bboxToZoom(bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat);

  console.log(`  '${ava.slug}': { center: [${cLng}, ${cLat}], zoom: ${zoom}, pitch: 40, bearing: 0 },`);
}

console.log('};');
