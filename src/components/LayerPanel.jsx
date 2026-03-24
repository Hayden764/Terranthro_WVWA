import { MONTH_ABBR } from '../config/climateConfig';
import { TOPO_LAYER_TYPES } from '../config/topographyConfig';

const CLIMATE_LAYERS = [
  { id: 'tdmean', label: 'Mean Temperature', sub: 'PRISM 30-yr normals' },
];

const TOPO_LAYERS = Object.values(TOPO_LAYER_TYPES).map(t => ({
  id: t.id,
  label: t.label,
  sub: t.description,
}));

export default function LayerPanel({ activeLayer, onLayerChange, currentMonth, onMonthChange, isOpen, onClose }) {
  const isClimate = activeLayer === 'tdmean';
  const isTopo = ['elevation', 'slope', 'aspect'].includes(activeLayer);

  return (
    <div style={{
      position: 'absolute',
      top: 16,
      right: 16,
      width: 260,
      background: '#fff',
      borderRadius: 12,
      boxShadow: '0 4px 24px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08)',
      border: '1px solid #e5e7eb',
      overflow: 'hidden',
      fontFamily: 'Inter, sans-serif',
      zIndex: 10,
    }}>
      {/* Header */}
      <div style={{
        background: '#1B4332',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Data Layers
        </span>
      </div>

      <div style={{ padding: '12px 0' }}>
        {/* Climate section */}
        <div style={{ padding: '4px 16px 8px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
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
                border: activeLayer === layer.id ? '1.5px solid #1B4332' : '1.5px solid transparent',
                background: activeLayer === layer.id ? '#f0fdf4' : 'transparent',
                cursor: 'pointer',
                marginBottom: 2,
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>{layer.label}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{layer.sub}</div>
            </button>
          ))}

          {/* Month slider — shown when climate layer is active */}
          {isClimate && (
            <div style={{ marginTop: 8, padding: '0 2px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: '#6b7280' }}>Month</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#1B4332' }}>{MONTH_ABBR[currentMonth - 1]}</span>
              </div>
              <input
                type="range"
                min={1}
                max={12}
                value={currentMonth}
                onChange={e => onMonthChange(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#1B4332', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                <span>Jan</span><span>Apr</span><span>Jul</span><span>Oct</span><span>Dec</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ height: 1, background: '#f3f4f6', margin: '4px 0' }} />

        {/* Topography section */}
        <div style={{ padding: '8px 16px 4px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
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
                  border: activeLayer === layer.id ? '1.5px solid #1B4332' : '1.5px solid #e5e7eb',
                  background: activeLayer === layer.id ? '#f0fdf4' : '#fff',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 500,
                  color: activeLayer === layer.id ? '#1B4332' : '#374151',
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
