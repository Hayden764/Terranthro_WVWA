import WVWAMap from '../components/WVWAMap';

export default function WVWAMapPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100vh', background: '#fff' }}>
      {/* Header */}
      <header style={{
        height: 52,
        background: '#1B4332',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        flexShrink: 0,
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        zIndex: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ color: '#C9A84C', fontSize: 20, fontWeight: 700, fontFamily: 'Georgia, serif', letterSpacing: '-0.01em' }}>
            Willamette Valley
          </div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
            Wineries &amp; AVA Map
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <a
            href="https://www.willamettewines.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'rgba(255,255,255,0.70)', fontSize: 12, fontFamily: 'Inter, sans-serif', textDecoration: 'none' }}
          >
            willamettewines.com ↗
          </a>
        </div>
      </header>

      {/* Map fills remaining height */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <WVWAMap />
      </div>
    </div>
  );
}
