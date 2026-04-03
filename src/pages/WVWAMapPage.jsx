import { useState } from 'react';
import WVWAMap from '../components/WVWAMap';
import AVAListModal from '../components/AVAListModal';
import { BRAND } from '../config/brandColors';

export default function WVWAMapPage() {
  const [selectedAva, setSelectedAva]           = useState(null);
  const [panelHoveredAva, setPanelHoveredAva]   = useState(null);
  const [modalOpen, setModalOpen]               = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100vh', background: BRAND.eggshell }}>
      {/* Header */}
      <header style={{
        height: 56,
        background: BRAND.eggshell,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        flexShrink: 0,
        borderBottom: '1px solid rgba(72,55,41,0.12)',
        boxShadow: '0 2px 12px rgba(46,34,26,0.08)',
        zIndex: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <a
            href="https://www.willamettewines.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', lineHeight: 0 }}
          >
            <img
              src="/willamette-logo.svg"
              alt="Willamette Valley Wine Country"
              style={{ height: 32, width: 'auto', display: 'block' }}
            />
          </a>
          <div style={{
            color: 'rgba(72,55,41,0.45)',
            fontSize: 13,
            fontFamily: 'Inter, sans-serif',
            borderLeft: '1px solid rgba(72,55,41,0.15)',
            paddingLeft: 14,
          }}>
            Wineries &amp; AVA Explorer
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={() => {
              if (selectedAva) {
                setSelectedAva(null);
              } else {
                setModalOpen(true);
              }
            }}
            style={{
              background: selectedAva ? BRAND.burgundy : 'rgba(72,55,41,0.07)',
              color: selectedAva ? BRAND.eggshell : BRAND.brownDark,
              border: `1px solid ${selectedAva ? BRAND.burgundy : 'rgba(72,55,41,0.18)'}`,
              borderRadius: 8,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'Inter, sans-serif',
              cursor: 'pointer',
              transition: 'all 0.2s',
              letterSpacing: '0.02em',
            }}
          >
            {selectedAva ? '← Back to Valley' : 'Explore AVAs'}
          </button>

        </div>
      </header>

      {/* Map fills remaining height */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <WVWAMap
          selectedAva={selectedAva}
          onSelectAva={setSelectedAva}
          panelHoveredAva={panelHoveredAva}
          onPanelHoverAva={setPanelHoveredAva}
        />
      </div>

      {/* AVA List Modal */}
      <AVAListModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={(avaSlug) => {
          setSelectedAva(avaSlug);
          setModalOpen(false);
        }}
      />

    </div>
  );
}
