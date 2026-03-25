import { BRAND } from '../config/brandColors';
import { WV_SUB_AVAS } from '../config/topographyConfig';

export default function AVAListModal({ isOpen, onClose, onSelect }) {
  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(46,34,26,0.55)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: BRAND.eggshell,
          borderRadius: 16,
          width: 420,
          maxHeight: '80vh',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(46,34,26,0.3), 0 4px 16px rgba(46,34,26,0.15)',
          border: `1px solid ${BRAND.border}`,
        }}
      >
        {/* Modal header */}
        <div style={{
          background: BRAND.brown,
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{
              color: BRAND.eggshell,
              fontSize: 18,
              fontWeight: 700,
              fontFamily: 'Georgia, serif',
            }}>
              Explore Sub-AVAs
            </div>
            <div style={{
              color: 'rgba(250,247,242,0.6)',
              fontSize: 12,
              marginTop: 4,
            }}>
              {WV_SUB_AVAS.length} American Viticultural Areas
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(250,247,242,0.12)',
              border: 'none',
              color: BRAND.eggshell,
              width: 32,
              height: 32,
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* AVA list */}
        <div style={{
          padding: '12px',
          overflowY: 'auto',
          maxHeight: 'calc(80vh - 80px)',
        }}>
          {WV_SUB_AVAS.map((ava, i) => (
            <button
              key={ava.slug}
              onClick={() => onSelect(ava.slug)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '14px 16px',
                borderRadius: 10,
                border: `1px solid transparent`,
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                transition: 'all 0.15s',
                marginBottom: 2,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = BRAND.cream;
                e.currentTarget.style.borderColor = BRAND.border;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'transparent';
              }}
            >
              {/* Number badge */}
              <div style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: i % 2 === 0 ? BRAND.burgundy : BRAND.brown,
                color: BRAND.eggshell,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 700,
                flexShrink: 0,
              }}>
                {i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: BRAND.text,
                }}>
                  {ava.name}
                </div>
              </div>
              {/* Arrow */}
              <div style={{
                color: BRAND.textMuted,
                fontSize: 16,
                flexShrink: 0,
              }}>
                →
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
