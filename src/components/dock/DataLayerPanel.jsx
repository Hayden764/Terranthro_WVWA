import { useState } from 'react';
import { BRAND } from '../../config/brandColors';
import { GLASS } from './glassTokens';
import { MONTH_ABBR } from '../../config/climateConfig';
import { TOPO_LAYER_TYPES } from '../../config/topographyConfig';
import { LISTING_FILTER_MODES } from '../WVWAMap';

/**
 * DataLayerPanel — "Layers" panel content.
 * Climate (mean temperature + month slider) and Topography (elevation / slope / aspect).
 */

const CLIMATE_LAYERS = [
  { id: 'tdmean', label: 'Mean Temperature', sub: 'PRISM 30-yr normals' },
];

const TOPO_LAYERS = Object.values(TOPO_LAYER_TYPES).map(t => ({
  id: t.id,
  label: t.label,
  sub: t.description,
}));

/* ─── Design tokens ──────────────────────────────────────────────────── */
const CARD = {
  background: 'rgba(250,247,242,0.06)',
  border: `1px solid rgba(250,247,242,0.08)`,
  borderRadius: 10,
  padding: '10px 12px',
  marginBottom: 8,
};

const SECTION_LABEL = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: GLASS.textDim,
  marginBottom: 8,
};

/* ─── Chevron icon ────────────────────────────────────────────────────── */
const Chevron = ({ open }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s', flexShrink: 0 }}>
    <path d="M19 9l-7 7-7-7" />
  </svg>
);

export default function DataLayerPanel({
  activeLayer,
  onLayerChange,
  currentMonth,
  onMonthChange,
  listingFilterMode,
  onListingFilterModeChange,
}) {
  const [climateOpen, setClimateOpen] = useState(true);
  const [topoOpen, setTopoOpen] = useState(true);

  const isClimate = activeLayer === 'tdmean';

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── Climate Section ──────────────────────────────────────────── */}
      <div style={CARD}>
        <button
          onClick={() => setClimateOpen(p => !p)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: GLASS.textDim,
          }}
        >
          <span style={SECTION_LABEL}>Climate</span>
          <Chevron open={climateOpen} />
        </button>

        {climateOpen && (
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {CLIMATE_LAYERS.map(layer => {
              const active = activeLayer === layer.id;
              return (
                <button
                  key={layer.id}
                  onClick={() => onLayerChange(active ? null : layer.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: `1.5px solid ${active ? 'rgba(142,21,55,0.5)' : 'rgba(250,247,242,0.08)'}`,
                    background: active ? GLASS.accentDim : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    fontFamily: 'Inter, sans-serif',
                  }}
                  onMouseEnter={e => {
                    if (!active) e.currentTarget.style.background = 'rgba(250,247,242,0.06)';
                  }}
                  onMouseLeave={e => {
                    if (!active) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: active ? GLASS.text : GLASS.textDim }}>{layer.label}</div>
                  <div style={{ fontSize: 10, color: GLASS.textMuted, marginTop: 2 }}>{layer.sub}</div>
                </button>
              );
            })}

            {/* Month slider */}
            {isClimate && (
              <div style={{ marginTop: 6, padding: '4px 2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: GLASS.textDim }}>Month</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: BRAND.burgundy, background: GLASS.accentDim, padding: '1px 8px', borderRadius: 4 }}>
                    {MONTH_ABBR[currentMonth - 1]}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={12}
                  value={currentMonth}
                  onChange={e => onMonthChange(Number(e.target.value))}
                  style={{ width: '100%', accentColor: BRAND.burgundy, cursor: 'pointer', height: 4 }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: GLASS.textMuted, marginTop: 2 }}>
                  <span>Jan</span><span>Apr</span><span>Jul</span><span>Oct</span><span>Dec</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Divider ──────────────────────────────────────────────────── */}
      <div style={{ height: 1, background: GLASS.borderLight, margin: '4px 0' }} />

      {/* ── Vineyard Visualization ─────────────────────────────────── */}
      <div style={CARD}>
        <div style={SECTION_LABEL}>Vineyard Visualization</div>
        <button
          onClick={() => onListingFilterModeChange?.(
            listingFilterMode === LISTING_FILTER_MODES.noVineyardsVisualized
              ? LISTING_FILTER_MODES.allWineries
              : LISTING_FILTER_MODES.noVineyardsVisualized,
          )}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '8px 10px',
            borderRadius: 8,
            border: `1.5px solid ${listingFilterMode === LISTING_FILTER_MODES.noVineyardsVisualized ? 'rgba(142,21,55,0.5)' : 'rgba(250,247,242,0.08)'}`,
            background: listingFilterMode === LISTING_FILTER_MODES.noVineyardsVisualized ? GLASS.accentDim : 'transparent',
            cursor: 'pointer',
            transition: 'all 0.15s',
            fontFamily: 'Inter, sans-serif',
          }}
          onMouseEnter={e => {
            if (listingFilterMode !== LISTING_FILTER_MODES.noVineyardsVisualized) {
              e.currentTarget.style.background = 'rgba(250,247,242,0.06)';
            }
          }}
          onMouseLeave={e => {
            if (listingFilterMode !== LISTING_FILTER_MODES.noVineyardsVisualized) {
              e.currentTarget.style.background = 'transparent';
            }
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: listingFilterMode === LISTING_FILTER_MODES.noVineyardsVisualized ? GLASS.text : GLASS.textDim }}>
            No Vineyards Visualized
          </div>
          <div style={{ fontSize: 10, color: GLASS.textMuted, marginTop: 2 }}>
            Hide parcel polygons while keeping winery listings and markers available.
          </div>
        </button>
      </div>

      {/* ── Topography Section ───────────────────────────────────────── */}
      <div style={CARD}>
        <button
          onClick={() => setTopoOpen(p => !p)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: GLASS.textDim,
          }}
        >
          <span style={SECTION_LABEL}>Topography</span>
          <Chevron open={topoOpen} />
        </button>

        {topoOpen && (
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {TOPO_LAYERS.map(layer => {
              const active = activeLayer === layer.id;
              return (
                <button
                  key={layer.id}
                  onClick={() => onLayerChange(active ? null : layer.id)}
                  title={layer.sub}
                  style={{
                    flex: 1,
                    padding: '8px 4px',
                    borderRadius: 8,
                    border: `1.5px solid ${active ? 'rgba(142,21,55,0.5)' : 'rgba(250,247,242,0.08)'}`,
                    background: active ? GLASS.accentDim : 'transparent',
                    color: active ? GLASS.text : GLASS.textDim,
                    cursor: 'pointer',
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: 'Inter, sans-serif',
                    transition: 'all 0.15s',
                    textAlign: 'center',
                    letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                  }}
                  onMouseEnter={e => {
                    if (!active) e.currentTarget.style.background = 'rgba(250,247,242,0.06)';
                  }}
                  onMouseLeave={e => {
                    if (!active) e.currentTarget.style.background = active ? GLASS.accentDim : 'transparent';
                  }}
                >
                  {layer.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
