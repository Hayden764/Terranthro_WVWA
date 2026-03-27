import { BRAND } from '../../config/brandColors';
import { GLASS } from './glassTokens';
import { WV_SUB_AVAS, TOPO_LAYER_TYPES } from '../../config/topographyConfig';

/**
 * LayerDetailPanel — right-side context panel shown when a data layer is active.
 * Displays layer description, data source, colour ramp, and live stats.
 * Closing this panel clears the active layer.
 */

/* ─── Color ramp gradients matching TiTiler colormaps ────────────────── */
const COLORMAP_CSS = {
  terrain:  'linear-gradient(to right, #0B6623, #90EE90, #F5F5DC, #D2B48C, #8B4513, #FFFFFF)',
  rdylgn_r: 'linear-gradient(to right, #1A9850, #91CF60, #D9EF8B, #FEE08B, #FC8D59, #D73027)',
  hsv:      'linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)',
  plasma:   'linear-gradient(to right, #0D0887, #7E03A8, #CC4778, #F89441, #F0F921)',
};

/* ─── Layer metadata ──────────────────────────────────────────────────── */
const LAYER_INFO = {
  tdmean: {
    icon: '🌡️',
    label: 'Mean Temperature',
    why: 'Average daily mean temperature from PRISM 30-year normals (1991–2020). This helps understand the thermal character of each growing region across different months.',
    source: 'PRISM Climate Group, Oregon State University',
    period: '30-year normals (1991–2020)',
  },
  elevation: {
    icon: '⛰️',
    label: 'Elevation',
    why: 'Height above sea level. Higher-elevation vineyards experience cooler temperatures, more wind exposure, and often better drainage — all factors that influence grape quality.',
    source: 'USGS Digital Elevation Model',
    period: 'Static terrain data',
  },
  slope: {
    icon: '📐',
    label: 'Slope',
    why: 'Steepness of terrain in degrees. Slopes between 5–15° are generally ideal for viticulture, providing good drainage and sun exposure.',
    source: 'Derived from USGS DEM',
    period: 'Static terrain data',
  },
  aspect: {
    icon: '🧭',
    label: 'Aspect',
    why: 'The compass direction a slope faces. South- and southwest-facing slopes receive more sunlight in the Northern Hemisphere, producing warmer and more sun-exposed microclimates.',
    source: 'Derived from USGS DEM',
    period: 'Static terrain data',
  },
};

const CARD = {
  background: 'rgba(250,247,242,0.06)',
  border: '1px solid rgba(250,247,242,0.08)',
  borderRadius: 10,
  padding: '12px 14px',
  marginBottom: 8,
};

const LBL = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: GLASS.textDim,
  marginBottom: 4,
};

const VAL = {
  fontSize: 13,
  color: GLASS.text,
  lineHeight: 1.55,
};

export default function LayerDetailPanel({ activeLayer, topoStats, selectedAva, onClose }) {
  const layerInfo = activeLayer ? LAYER_INFO[activeLayer] : null;
  if (!layerInfo) return null;

  const avaName = selectedAva
    ? WV_SUB_AVAS.find(a => a.slug === selectedAva)?.name ?? 'AVA'
    : null;

  return (
    <div style={{
      position: 'absolute',
      right: 16,
      top: '50%',
      transform: 'translateY(-50%)',
      width: 288,
      maxHeight: 'calc(100vh - 120px)',
      background: 'rgba(46,34,26,0.92)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(250,247,242,0.12)',
      borderRadius: 14,
      boxShadow: '0 8px 40px rgba(46,34,26,0.45)',
      fontFamily: 'Inter, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 40,
      animation: 'layerPanelFadeIn 0.2s ease-out',
    }}>
      <style>{`
        @keyframes layerPanelFadeIn {
          from { opacity: 0; transform: translateY(-50%) translateX(8px); }
          to   { opacity: 1; transform: translateY(-50%) translateX(0); }
        }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid rgba(250,247,242,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>{layerInfo.icon}</span>
          <div>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: GLASS.textDim,
              lineHeight: 1,
              marginBottom: 2,
            }}>
              Active Layer
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: GLASS.text, lineHeight: 1.2 }}>
              {layerInfo.label}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          title="Deactivate layer"
          style={{
            background: 'rgba(46,34,26,0.7)',
            border: '1px solid rgba(250,247,242,0.15)',
            borderRadius: 8,
            color: 'rgba(250,247,242,0.7)',
            width: 28,
            height: 28,
            cursor: 'pointer',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div style={{
        overflowY: 'auto',
        flex: 1,
        padding: '12px 12px 16px',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(250,247,242,0.15) transparent',
      }}>

        {/* Description */}
        <div style={CARD}>
          <p style={{ fontSize: 12, color: GLASS.textDim, lineHeight: 1.7, margin: 0 }}>
            {layerInfo.why}
          </p>
        </div>

        {/* Source + Period */}
        <div style={CARD}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={LBL}>Period</div>
              <div style={VAL}>{layerInfo.period}</div>
            </div>
            <div>
              <div style={LBL}>Source</div>
              <div style={{ ...VAL, fontSize: 11, color: GLASS.textDim }}>{layerInfo.source}</div>
            </div>
          </div>
        </div>

        {/* ── Stats card (topo layers, when stats are loaded) ────────── */}
        {topoStats && activeLayer && TOPO_LAYER_TYPES[activeLayer] && (() => {
          const { min, max, mean, std } = topoStats;
          const layerCfg = TOPO_LAYER_TYPES[activeLayer];
          const unit = layerCfg.unit ?? '';
          const gradient = COLORMAP_CSS[layerCfg.colormap] ?? COLORMAP_CSS.terrain;
          const fmt = (v) => typeof v === 'number' ? v.toFixed(1) : '—';
          return (
            <div style={CARD}>
              <div style={{ ...LBL, marginBottom: 8 }}>
                Data Range{avaName ? ` — ${avaName}` : ''}
              </div>

              {/* Color ramp bar */}
              <div style={{
                height: 10,
                borderRadius: 6,
                background: gradient,
                marginBottom: 4,
                border: '1px solid rgba(250,247,242,0.1)',
              }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: GLASS.textDim, marginBottom: 12 }}>
                <span>{fmt(min)}{unit}</span>
                <span>{fmt(max)}{unit}</span>
              </div>

              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <div style={LBL}>Min</div>
                  <div style={VAL}>{fmt(min)}{unit}</div>
                </div>
                <div>
                  <div style={LBL}>Max</div>
                  <div style={VAL}>{fmt(max)}{unit}</div>
                </div>
                <div>
                  <div style={LBL}>Mean</div>
                  <div style={VAL}>{fmt(mean)}{unit}</div>
                </div>
                <div>
                  <div style={LBL}>Std Dev</div>
                  <div style={VAL}>±{fmt(std)}{unit}</div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Loading state */}
        {!topoStats && activeLayer && TOPO_LAYER_TYPES[activeLayer] && selectedAva && (
          <div style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              border: '2px solid rgba(250,247,242,0.15)',
              borderTopColor: GLASS.text,
              animation: 'spin 0.8s linear infinite',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 11, color: GLASS.textDim }}>Loading data range…</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Hint when no AVA is selected and topo is active */}
        {!topoStats && activeLayer && TOPO_LAYER_TYPES[activeLayer] && !selectedAva && (
          <div style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>💡</span>
            <span style={{ fontSize: 11, color: GLASS.textDim, lineHeight: 1.5 }}>
              Select an AVA to see terrain statistics for that region.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
