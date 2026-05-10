import { MAP_GLASS } from '../../styles/tokens';

function HoverPill({ dotColor, children }) {
  return (
    <div style={{
      position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
      background: MAP_GLASS.bg,
      border: `1px solid ${MAP_GLASS.border}`,
      borderRadius: MAP_GLASS.radiusPill,
      padding: '6px 14px 6px 10px',
      display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 'var(--type-mono-size)', fontWeight: 600,
      color: MAP_GLASS.text,
      pointerEvents: 'none', zIndex: 5, fontFamily: 'var(--font-sans)',
      boxShadow: MAP_GLASS.shadow,
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0,
      }} />
      {children}
    </div>
  );
}

export default HoverPill;
