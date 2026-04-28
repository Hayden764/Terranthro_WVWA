import { alpha, border, crimson, ink, muted, parchment, TOKENS } from '../styles/tokens';
import { WV_SUB_AVAS } from '../config/topographyConfig';

// UI constants for modal styling
const UI = {
  backdropBg: alpha(TOKENS.ink, 0.55),
  shadowDark: alpha('black', 0.3),
  shadowLight: alpha('black', 0.15),
  subtitle: alpha(TOKENS.parchment, 0.6),
  closeBtn: alpha(TOKENS.parchment, 0.12),
};

export default function AVAListModal({ isOpen, onClose, onSelect }) {
  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: UI.backdropBg,
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: parchment,
          borderRadius: 16,
          width: 420,
          maxHeight: '80vh',
          overflow: 'hidden',
          boxShadow: `0 20px 60px ${UI.shadowDark}, 0 4px 16px ${UI.shadowLight}`,
          border: `1px solid ${border}`,
        }}
      >
        {/* Modal header */}
        <div style={{
          background: ink,
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{
              color: parchment,
              fontSize: 18,
              fontWeight: 700,
              fontFamily: 'var(--font-display)',
            }}>
              Explore Sub-AVAs
            </div>
            <div style={{
              color: UI.subtitle,
              fontSize: 12,
              marginTop: 4,
            }}>
              {WV_SUB_AVAS.length} American Viticultural Areas
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: UI.closeBtn,
              border: 'none',
              color: parchment,
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
                e.currentTarget.style.background = parchment;
                e.currentTarget.style.borderColor = border;
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
                background: i % 2 === 0 ? crimson : ink,
                color: parchment,
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
                  color: ink,
                }}>
                  {ava.name}
                </div>
              </div>
              {/* Arrow */}
              <div style={{
                color: muted,
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
