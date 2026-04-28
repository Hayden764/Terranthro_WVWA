import { MONTH_ABBR } from '../config/climateConfig';
import { TOPO_LAYER_TYPES } from '../config/topographyConfig';
import { border, crimson, ink, muted, parchment, TYPE } from '../styles/tokens';

const UI_LABEL = {
  ...TYPE.uiLabel,
  fontSize: 'var(--type-ui-label-size)',
};

const CLIMATE_LAYERS = [
  { id: 'tdmean', label: 'Mean Temperature', sub: 'PRISM 30-yr normals' },
];

const TOPO_LAYERS = Object.values(TOPO_LAYER_TYPES).map(t => ({
  id: t.id,
  label: t.label,
  sub: t.description,
}));

export default function LayerPanel({ activeLayer, onLayerChange, currentMonth, onMonthChange }) {
  const isClimate = activeLayer === 'tdmean';

  return (
    <div style={{
      position: 'absolute',
      top: 16,
      right: 16,
      width: 260,
      background: parchment,
      borderRadius: 12,
      boxShadow: '0 4px 24px rgba(46,34,26,0.14), 0 1px 4px rgba(46,34,26,0.08)',
      border: `1px solid ${border}`,
      overflow: 'hidden',
      fontFamily: 'var(--font-sans)',
      zIndex: 10,
    }}>
      {/* Header */}
      <div style={{
        background: ink,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ ...TYPE.uiLabel, color: parchment, fontWeight: 600, fontSize: 'var(--type-mono-size)' }}>
          Data Layers
        </span>
      </div>

      <div style={{ padding: '12px 0' }}>
        {/* Climate section */}
        <div style={{ padding: '4px 16px 8px' }}>
          <div style={{ ...UI_LABEL, color: muted, marginBottom: 6 }}>
            Climate
          </div>
          {CLIMATE_LAYERS.map(layer => (
            <button
              key={layer.id}
              onClick={() => onLayerChange(activeLayer === layer.id ? null : layer.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                borderRadius: 8,
                border: activeLayer === layer.id ? `1.5px solid ${crimson}` : '1.5px solid transparent',
                background: activeLayer === layer.id ? parchment : 'transparent',
                cursor: 'pointer',
                marginBottom: 2,
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 'var(--type-mono-size)', fontWeight: 500, color: ink }}>{layer.label}</div>
              <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 1 }}>{layer.sub}</div>
            </button>
          ))}

          {/* Month slider */}
          {isClimate && (
            <div style={{ marginTop: 8, padding: '0 2px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 'var(--type-ui-label-size)', color: muted }}>Month</span>
                <span style={{ fontSize: 'var(--type-body-size)', fontWeight: 600, color: crimson }}>{MONTH_ABBR[currentMonth - 1]}</span>
              </div>
              <input
                type="range"
                min={1}
                max={12}
                value={currentMonth}
                onChange={e => onMonthChange(Number(e.target.value))}
                style={{ width: '100%', accentColor: crimson, cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 2 }}>
                <span>Jan</span><span>Apr</span><span>Jul</span><span>Oct</span><span>Dec</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ height: 1, background: border, margin: '4px 0' }} />

        {/* Topography section */}
        <div style={{ padding: '8px 16px 4px' }}>
          <div style={{ ...UI_LABEL, color: muted, marginBottom: 6 }}>
            Topography
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {TOPO_LAYERS.map(layer => (
              <button
                key={layer.id}
                onClick={() => onLayerChange(activeLayer === layer.id ? null : layer.id)}
                title={layer.sub}
                style={{
                  flex: 1,
                  padding: '7px 4px',
                  borderRadius: 7,
                  border: activeLayer === layer.id ? `1.5px solid ${crimson}` : `1.5px solid ${border}`,
                  background: activeLayer === layer.id ? parchment : parchment,
                  cursor: 'pointer',
                  fontSize: 'var(--type-ui-label-size)',
                  fontWeight: 500,
                  color: activeLayer === layer.id ? crimson : muted,
                  transition: 'all 0.15s',
                  textAlign: 'center',
                }}
              >
                {layer.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
