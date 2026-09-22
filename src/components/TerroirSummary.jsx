import { alpha, TOKENS, TYPE } from '../styles/tokens';
import { TERROIR_CLASS_COLORS, UNCLASSIFIED_COLOR } from '../config/earthLayersConfig';

/**
 * Soil-over-bedrock line and within-AVA ranking for a vineyard's terroir card.
 * `terroir` and `rank` come from GET /api/vineyards/parcels/:id/topo-stats
 * (topo.terroir, topo.rank). Renders nothing when neither is available.
 */

function rankPhrase(pct, up, down) {
  if (pct == null) return null;
  return pct >= 50 ? `${up} than ${pct}%` : `${down} than ${100 - pct}%`;
}

export default function TerroirSummary({ terroir, rank, variant = 'light', note = null }) {
  const glass = variant === 'glass';
  const text  = glass ? alpha(TOKENS.parchment, 0.9) : TOKENS.ink;
  const sub   = glass ? alpha(TOKENS.parchment, 0.55) : TOKENS.muted;
  const line  = glass ? alpha(TOKENS.parchment, 0.12) : TOKENS.border;

  // Rank within the vineyard's own AVA; fall back to the whole valley when the
  // AVA has too few mapped vineyards for a meaningful percentile.
  const useAva = rank?.elevation_pct != null;
  const elevPct  = useAva ? rank.elevation_pct : rank?.elevation_pct_wv;
  const slopePct = useAva ? rank.slope_pct : rank?.slope_pct_wv;
  const scope = useAva ? rank.ava : 'Willamette Valley';
  const elevText  = rankPhrase(elevPct, 'Higher', 'Lower');
  const slopeText = rankPhrase(slopePct, 'steeper', 'flatter');

  if (!terroir?.label && !elevText) return null;

  const origin = terroir?.origin;
  const swatch = TERROIR_CLASS_COLORS[origin] ?? UNCLASSIFIED_COLOR;

  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${line}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {terroir?.label && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...TYPE.uiLabel, color: sub }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: swatch, flexShrink: 0 }} />
            {origin ? `${origin} soil` : 'Soil'}
          </div>
          <div style={{ fontSize: 'var(--type-body-size)', color: text, lineHeight: 1.4, marginTop: 3 }}>
            {terroir.label}
          </div>
        </div>
      )}
      {elevText && (
        <div style={{ fontSize: 'var(--type-ui-label-size)', color: sub, lineHeight: 1.45 }}>
          <span style={{ color: text }}>{elevText}</span> of {scope} vineyards by elevation
          {slopeText && <> · {slopeText} by slope</>}
        </div>
      )}
      {note && (
        <div style={{ fontSize: 'var(--type-ui-label-size)', color: sub, fontStyle: 'italic' }}>{note}</div>
      )}
    </div>
  );
}
