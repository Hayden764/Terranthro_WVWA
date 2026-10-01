function getFeatureRings(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return [];

  if (geometry.type === 'Polygon') {
    return geometry.coordinates || [];
  }

  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || []).flat();
  }

  return [];
}

export function getVineyardFeatureBounds(features) {
  if (!Array.isArray(features) || !features.length) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const feature of features) {
    const rings = getFeatureRings(feature);
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }

  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) {
    return null;
  }

  return [[minLng, minLat], [maxLng, maxLat]];
}
