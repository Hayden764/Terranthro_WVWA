import { alpha, TOKENS, TYPE } from '../../styles/tokens';
import { GLASS } from './glassTokens';
import { TOPO_LAYER_TYPES } from '../../config/topographyConfig';
import TerroirDataChips from '../TerroirDataChips';

/**
 * ScalePanel — "Scale" panel content.
 * Shows the colour ramp / legend for the active data layer.
 */

const CARD = {
  background: alpha(TOKENS.parchment, 0.06),
  border: `1px solid ${alpha(TOKENS.parchment, 0.08)}`,
  borderRadius: 10,
  padding: '10px 12px',
  marginBottom: 8,
};

const LABEL = {
  ...TYPE.uiLabel,
  fontSize: 'var(--type-ui-label-size)',
  color: GLASS.textDim,
  marginBottom: 6,
};

/* ─── Colormaps for climate layers ─────────────────────────────────── */// audit-ignore-start climate-rampsconst CLIMATE_RAMPS = {
  tdmean: {
    label: 'Mean Temperature',
    gradient: 'linear-gradient(to right, #0d0887, #46039f, #7201a8, #9c179e, #bd3786, #d8576b, #ed7953, #fb9f3a, #fdca26, #f0f921)',
    min: '-22 °C',
    max: '26 °C',
  },
};
// audit-ignore-end

export default function ScalePanel({ activeLayer, topoStats }) {
  if (!activeLayer) {
    return (
      <div style={{ padding: 16, textAlign: 'center' }}>
        <div style={{ fontSize: 'var(--type-display-medium-size)', marginBottom: 8 }}>📊</div>
        <div style={{ fontSize: 'var(--type-body-size)', color: GLASS.textDim, lineHeight: 1.6 }}>
          Activate a data layer from the <strong style={{ color: GLASS.text }}>Layers</strong> panel to see its colour scale here.
        </div>
      </div>
    );
  }

  /* ── Topography legend ─────────────────────────────────────────────── */
  const topoConfig = TOPO_LAYER_TYPES[activeLayer];
  if (topoConfig) {
    const { legend, label, unit, description } = topoConfig;

    // Use real per-AVA stats if available, else fall back to config labels
    const hasStats = topoStats?.min != null && topoStats?.max != null;
    const realMin  = hasStats ? topoStats.min  : null;
    const realMax  = hasStats ? topoStats.max  : null;
    const realMean = hasStats ? topoStats.mean : null;
    const realStd  = hasStats ? topoStats.std  : null;

    // Build N evenly-spaced stops across the real range for the legend
    const N = legend.colors.length;
    const realLabels = hasStats
      ? legend.colors.map((_, i) => {
          const val = realMin + (realMax - realMin) * (i / (N - 1));
          return `${Math.round(val)}${unit}`;
        })
      : legend.labels;

    const gradientMinLabel = hasStats ? `${Math.round(realMin)}${unit}` : legend.labels[0];
    const gradientMaxLabel = hasStats ? `${Math.round(realMax)}${unit}` : legend.labels[legend.labels.length - 1];

    return (
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Layer name */}
        <div style={CARD}>
          <div style={{ fontSize: 'var(--type-mono-size)', fontWeight: 700, color: GLASS.text, marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 'var(--type-ui-label-size)', color: GLASS.textDim }}>{description} ({unit})</div>
        </div>

        {/* Colour gradient */}
        <div style={CARD}>
          <div style={LABEL}>Colour Ramp</div>
          <div style={{
            width: '100%',
            height: 14,
            borderRadius: 4,
            background: `linear-gradient(to right, ${legend.colors.join(', ')})`,
            marginBottom: 6,
          }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--type-ui-label-size)', color: GLASS.textMuted }}>
            <span>{gradientMinLabel}</span>
            <span>{gradientMaxLabel}</span>
          </div>
        </div>

        {/* Stats summary — only shown when real data is available */}
        {hasStats && (
          <div style={CARD}>
            <div style={{ ...LABEL, marginBottom: 8 }}>AVA Statistics</div>
            <TerroirDataChips variant="glass" chips={[
              { label: 'Min',  value: `${Math.round(realMin)}${unit}`,  tone: 'blue',     glow: true  },
              { label: 'Max',  value: `${Math.round(realMax)}${unit}`,  tone: 'amber',    glow: true  },
              { label: 'Mean', value: `${Math.round(realMean)}${unit}`, tone: 'green',    glow: true  },
              { label: 'Std',  value: `±${Math.round(realStd)}${unit}`,  tone: 'parchment', glow: false },
            ]} />
          </div>
        )}

        {/* Discrete colour stops */}
        <div style={CARD}>
          <div style={LABEL}>Legend{hasStats ? ' (this AVA)' : ''}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {legend.colors.map((color, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background: color,
                  flexShrink: 0,
                  border: `1px solid ${alpha(TOKENS.parchment, 0.15)}`,
                }} />
                <span style={{ fontSize: 'var(--type-ui-label-size)', color: GLASS.text }}>{realLabels[i] || ''}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── Climate legend ────────────────────────────────────────────────── */
  const climateRamp = CLIMATE_RAMPS[activeLayer];
  if (climateRamp) {
    return (
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={CARD}>
          <div style={{ fontSize: 'var(--type-mono-size)', fontWeight: 700, color: GLASS.text, marginBottom: 2 }}>{climateRamp.label}</div>
          <div style={{ fontSize: 'var(--type-ui-label-size)', color: GLASS.textDim }}>PRISM 30-year normals</div>
        </div>

        <div style={CARD}>
          <div style={LABEL}>Colour Ramp — Plasma</div>
          <div style={{
            width: '100%',
            height: 14,
            borderRadius: 4,
            background: climateRamp.gradient,
            marginBottom: 6,
          }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--type-ui-label-size)', color: GLASS.textMuted }}>
            <span>{climateRamp.min}</span>
            <span style={{ ...TYPE.uiLabel, color: GLASS.textDim }}>min – max</span>
            <span>{climateRamp.max}</span>
          </div>
        </div>
      </div>
    );
  }

  /* ── Fallback ─────────────────────────────────────────────────────── */
  return (
    <div style={{ padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 'var(--type-body-size)', color: GLASS.textDim }}>No scale data for this layer.</div>
    </div>
  );
}
