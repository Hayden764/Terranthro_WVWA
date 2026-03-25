import { GLASS } from './glassTokens';
import { TOPO_LAYER_TYPES } from '../../config/topographyConfig';

/**
 * ScalePanel — "Scale" panel content.
 * Shows the colour ramp / legend for the active data layer.
 */

const CARD = {
  background: 'rgba(250,247,242,0.06)',
  border: `1px solid rgba(250,247,242,0.08)`,
  borderRadius: 10,
  padding: '10px 12px',
  marginBottom: 8,
};

const LABEL = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: GLASS.textDim,
  marginBottom: 6,
};

/* ─── Colormaps for climate layers ─────────────────────────────────── */
const CLIMATE_RAMPS = {
  tdmean: {
    label: 'Mean Temperature',
    gradient: 'linear-gradient(to right, #0d0887, #46039f, #7201a8, #9c179e, #bd3786, #d8576b, #ed7953, #fb9f3a, #fdca26, #f0f921)',
    min: '-22 °C',
    max: '26 °C',
  },
};

export default function ScalePanel({ activeLayer, topoStats }) {
  if (!activeLayer) {
    return (
      <div style={{ padding: 16, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
        <div style={{ fontSize: 12, color: GLASS.textDim, lineHeight: 1.6 }}>
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
          <div style={{ fontSize: 13, fontWeight: 700, color: GLASS.text, marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 11, color: GLASS.textDim }}>{description} ({unit})</div>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: GLASS.textMuted }}>
            <span>{gradientMinLabel}</span>
            <span>{gradientMaxLabel}</span>
          </div>
        </div>

        {/* Stats summary — only shown when real data is available */}
        {hasStats && (
          <div style={CARD}>
            <div style={LABEL}>AVA Statistics</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {[
                { key: 'Min',  val: `${Math.round(realMin)}${unit}` },
                { key: 'Max',  val: `${Math.round(realMax)}${unit}` },
                { key: 'Mean', val: `${Math.round(realMean)}${unit}` },
                { key: 'Std',  val: `±${Math.round(realStd)}${unit}` },
              ].map(({ key, val }) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: GLASS.textDim }}>{key}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: GLASS.text }}>{val}</span>
                </div>
              ))}
            </div>
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
                  border: `1px solid rgba(250,247,242,0.15)`,
                }} />
                <span style={{ fontSize: 11, color: GLASS.text }}>{realLabels[i] || ''}</span>
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
          <div style={{ fontSize: 13, fontWeight: 700, color: GLASS.text, marginBottom: 2 }}>{climateRamp.label}</div>
          <div style={{ fontSize: 11, color: GLASS.textDim }}>PRISM 30-year normals</div>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: GLASS.textMuted }}>
            <span>{climateRamp.min}</span>
            <span style={{ fontSize: 9, color: GLASS.textDim, textTransform: 'uppercase', letterSpacing: '0.04em' }}>min – max</span>
            <span>{climateRamp.max}</span>
          </div>
        </div>
      </div>
    );
  }

  /* ── Fallback ─────────────────────────────────────────────────────── */
  return (
    <div style={{ padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: GLASS.textDim }}>No scale data for this layer.</div>
    </div>
  );
}
