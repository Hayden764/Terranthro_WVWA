import { TERROIR_CLASS_COLORS, UNCLASSIFIED_COLOR } from '../config/earthLayersConfig';

/**
 * Text facts for a vineyard's terroir card, as rows for TerroirFactRows.
 * Input is the aggregated group stats built in ExplorerSidebar / WVWAMap from
 * GET /api/vineyards/parcels/:id/topo-stats (terroir + rank of the largest parcel).
 * Numbers belong in TerroirDataChips; only words belong here.
 */
export function terroirFactRows(stats) {
  const t = stats?.terroir;
  const rank = stats?.rank;
  if (!t && !rank) return [];

  // Rank within the vineyard's own AVA, falling back to the whole valley
  const useAva = rank?.elevation_pct != null;
  const scope = useAva ? rank?.ava : 'the valley';
  const elevPct = useAva ? rank?.elevation_pct : rank?.elevation_pct_wv;
  const slopePct = useAva ? rank?.slope_pct : rank?.slope_pct_wv;
  const phrase = (pct, up, down) =>
    pct == null ? null : pct >= 50 ? `${up} than ${pct}%` : `${down} than ${100 - pct}%`;

  const soil = t?.soil_series
    ? `${t.soil_series}${t.soil_texture ? ` ${String(t.soil_texture).toLowerCase()}` : ''}`
    : null;

  return [
    { label: 'Soil', value: soil, sub: t?.soil_drainage || null },
    { label: 'Bedrock', value: t?.bedrock_formation || t?.bedrock_name || null, sub: t?.bedrock_age || null },
    {
      label: 'Origin',
      value: t?.origin || null,
      swatch: t?.origin ? (TERROIR_CLASS_COLORS[t.origin] ?? UNCLASSIFIED_COLOR) : null,
    },
    { label: 'Elevation', value: phrase(elevPct, 'Higher', 'Lower'), sub: elevPct != null ? `of ${scope}` : null },
    { label: 'Slope', value: phrase(slopePct, 'Steeper', 'Flatter'), sub: slopePct != null ? `of ${scope}` : null },
  ];
}
