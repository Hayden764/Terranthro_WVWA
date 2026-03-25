import { useState, useRef, useCallback } from 'react';
import WVWAMap from '../components/WVWAMap';
import AVAListModal from '../components/AVAListModal';
import ListingsModal from '../components/ListingsModal';
import { BRAND } from '../config/brandColors';

export default function WVWAMapPage() {
  const [selectedAva, setSelectedAva]           = useState(null);
  const [panelHoveredAva, setPanelHoveredAva]   = useState(null);
  const [modalOpen, setModalOpen]               = useState(false);
  const [listingsOpen, setListingsOpen]         = useState(false);
  const markerRefsMap = useRef({});  // id → { el, openPopup, listing, map }

  const registerMarkerRef = useCallback((id, ref) => {
    markerRefsMap.current[id] = ref;
  }, []);

  const handleSelectListing = useCallback((listing) => {
    setListingsOpen(false);
    const ref = markerRefsMap.current[listing.id];
    if (!ref) return;
    const { map, openPopup } = ref;
    map.flyTo({ center: [listing.lng, listing.lat], zoom: Math.max(map.getZoom(), 13), duration: 900 });
    setTimeout(openPopup, 950);
  }, []);

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
          {/* Directory button */}
          <button
            onClick={() => setListingsOpen(true)}
            style={{
              background: 'rgba(72,55,41,0.07)',
              color: BRAND.brownDark,
              border: '1px solid rgba(72,55,41,0.18)',
              borderRadius: 8,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'Inter, sans-serif',
              cursor: 'pointer',
              transition: 'all 0.2s',
              letterSpacing: '0.02em',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(72,55,41,0.13)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(72,55,41,0.07)'}
          >
            📋 Directory
          </button>
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
          registerMarkerRef={registerMarkerRef}
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

      {/* Listings Directory Modal */}
      <ListingsModal
        isOpen={listingsOpen}
        onClose={() => setListingsOpen(false)}
        onSelectListing={handleSelectListing}
      />
    </div>
  );
}
