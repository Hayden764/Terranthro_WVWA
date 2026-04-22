import { useState, useRef, useEffect } from 'react';
import WVWAMap, { LISTING_FILTER_MODES } from '../components/WVWAMap';
import ExplorerSidebar from '../components/ExplorerSidebar';
import { BRAND } from '../config/brandColors';
import { useIsMobile } from '../lib/useIsMobile';

// ── Entrance Panel (Option B — Dark Cinematic) ───────────────────────────
function EntrancePanel({ onEnter, mapReady, isMobile }) {
  return (
    <div style={{
      width: isMobile ? '100%' : 300,
      height: '100%',
      flexShrink: 0,
      background: BRAND.brownDark,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 32px',
      boxSizing: 'border-box',
      gap: 0,
    }}>
      {/* Logo */}
      <img
        src="/willamette-logo.svg"
        alt="Willamette Valley Wine Country"
        style={{ height: 48, width: 'auto', marginBottom: 36, filter: 'brightness(0) invert(1)', opacity: 0.92 }}
      />

      {/* Headline */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{
          fontSize: 28,
          fontWeight: 700,
          color: BRAND.eggshell,
          letterSpacing: '-0.01em',
          lineHeight: 1.15,
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}>
          Willamette Valley
        </div>
        <div style={{
          fontSize: 20,
          fontWeight: 400,
          color: BRAND.eggshell,
          letterSpacing: '0.04em',
          lineHeight: 1.3,
          fontFamily: 'Georgia, "Times New Roman", serif',
          opacity: 0.8,
          marginTop: 4,
        }}>
          Wine Country
        </div>
      </div>

      {/* Burgundy rule */}
      <div style={{ width: 40, height: 2, background: BRAND.burgundy, borderRadius: 1, marginBottom: 20 }} />

      {/* Tagline */}
      <div style={{
        fontSize: 12,
        color: 'rgba(250,247,242,0.5)',
        fontStyle: 'italic',
        letterSpacing: '0.06em',
        textAlign: 'center',
        marginBottom: 48,
        lineHeight: 1.7,
      }}>
        18 AVAs&nbsp;&nbsp;·&nbsp;&nbsp;700+ Wineries<br />
        Willamette Valley, Oregon
      </div>

      {/* Enter button */}
      <button
        onClick={onEnter}
        disabled={!mapReady}
        style={{
          width: '100%',
          padding: '13px 0',
          background: 'transparent',
          border: `1.5px solid ${mapReady ? BRAND.eggshell : 'rgba(250,247,242,0.25)'}`,
          borderRadius: 4,
          color: mapReady ? BRAND.eggshell : 'rgba(250,247,242,0.35)',
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          cursor: mapReady ? 'pointer' : 'default',
          fontFamily: 'Inter, sans-serif',
          transition: 'background 0.2s, color 0.2s, border-color 0.2s',
        }}
        onMouseEnter={e => {
          if (!mapReady) return;
          e.currentTarget.style.background = 'rgba(250,247,242,0.1)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        {mapReady ? 'Begin Exploring' : 'Loading map\u2026'}
      </button>
    </div>
  );
}

export default function WVWAMapPage() {
  const mapRef = useRef(null);

  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Entrance state ───────────────────────────────────────────────────
  const [isIntro, setIsIntro]     = useState(true);
  const [mapReady, setMapReady]   = useState(false);

  function handleEnter() {
    mapRef.current?.startEntranceAnimation?.();
    setIsIntro(false);
  }

  // ── AVA selection ────────────────────────────────────────────────────
  const [selectedAva, setSelectedAva]         = useState(null);
  const [panelHoveredAva, setPanelHoveredAva] = useState(null);

  // ── Sidebar collapse ─────────────────────────────────────────────────

  // ── Lifted map state (shared between WVWAMap and ExplorerSidebar) ────
  const [listings, setListings]                     = useState([]);
  const [selectedListing, setSelectedListing]       = useState(null);
  const [activeLayer, setActiveLayer]               = useState(null);
  const [currentMonth, setCurrentMonth]             = useState(new Date().getMonth() + 1);
  const [listingFilterMode, setListingFilterMode]   = useState(LISTING_FILTER_MODES.allWineries);
  const [listingSymbologyPreset, setListingSymbologyPreset] = useState('topoModern');
  const [topoStats, setTopoStats]                   = useState(null);
  const [parcelTopoStats, setParcelTopoStats]       = useState({});
  const [selectedVineyards, setSelectedVineyards]   = useState([]);
  const [insideIds, setInsideIds]                   = useState(null);
  const [vineyardRecidSet, setVineyardRecidSet]     = useState(() => new Set());

  // Auto-open sidebar on mobile when a map interaction selects content
  useEffect(() => { if (isMobile && selectedListing) setSidebarOpen(true); }, [isMobile, selectedListing]);
  useEffect(() => { if (isMobile && selectedAva) setSidebarOpen(true); }, [isMobile, selectedAva]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100vh', overflow: 'hidden', background: BRAND.eggshell, fontFamily: 'Inter, sans-serif' }}>

      {/* ── Slim header ─────────────────────────────────────────────── */}
      <header style={{
        height: 48,
        background: BRAND.brown,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        flexShrink: 0,
        zIndex: 20,
        position: 'relative',
      }}>
        <a
          href="https://www.willamettewines.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', lineHeight: 0 }}
        >
          <img
            src="/willamette-logo.svg"
            alt="Willamette Valley Wine Country"
            style={{ height: 28, width: 'auto', display: 'block', filter: 'brightness(0) invert(1)' }}
          />
        </a>
        <div style={{ fontSize: 12, color: 'rgba(250,247,242,0.45)', fontFamily: 'Inter, sans-serif', letterSpacing: '0.02em' }}>
          Wineries &amp; AVA Explorer
        </div>
      </header>

      {/* ── Body: sidebar + map ─────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Entrance panel (shown during intro) */}
        {isIntro && (
          <EntrancePanel onEnter={handleEnter} mapReady={mapReady} isMobile={isMobile} />
        )}

        {/* Explorer Sidebar (hidden during intro) */}
        {!isIntro && (
          <ExplorerSidebar
            isMobile={isMobile}
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            mapRef={mapRef}
            selectedAva={selectedAva}
            onSelectAva={setSelectedAva}
            listings={listings}
            selectedListing={selectedListing}
            onListingSelect={setSelectedListing}
            insideIds={insideIds}
            vineyardRecidSet={vineyardRecidSet}
            activeLayer={activeLayer}
            onLayerChange={(layer) => { setActiveLayer(layer); setTopoStats(null); }}
            currentMonth={currentMonth}
            onMonthChange={setCurrentMonth}
            topoStats={topoStats}
            listingFilterMode={listingFilterMode}
            onListingFilterModeChange={setListingFilterMode}
            selectedVineyards={selectedVineyards}
            parcelTopoStats={parcelTopoStats}
            onVineyardHover={(features) => mapRef.current?.hoverVineyards?.(features)}
            onViewAllVineyards={(features) => mapRef.current?.viewAllVineyards?.(features)}
          />
        )}

        {/* Mobile scrim — tap outside drawer to close */}
        {isMobile && sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.45)',
              zIndex: 199,
            }}
          />
        )}

        {/* Map */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Mobile hamburger FAB */}
          {isMobile && !isIntro && (
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              style={{
                position: 'absolute', top: 12, left: 12, zIndex: 100,
                width: 42, height: 42,
                background: BRAND.brown, border: 'none', borderRadius: 10,
                color: BRAND.eggshell, fontSize: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.28)',
                fontFamily: 'Inter, sans-serif', lineHeight: 1,
              }}
            >
              ☰
            </button>
          )}
          <WVWAMap
            ref={mapRef}
            selectedAva={selectedAva}
            onSelectAva={setSelectedAva}
            panelHoveredAva={panelHoveredAva}
            onPanelHoverAva={setPanelHoveredAva}
            // Lifted state
            selectedListing={selectedListing}
            onListingSelect={setSelectedListing}
            activeLayer={activeLayer}
            onLayerChange={(layer) => { setActiveLayer(layer); setTopoStats(null); }}
            currentMonth={currentMonth}
            onMonthChange={setCurrentMonth}
            listingFilterMode={listingFilterMode}
            onListingFilterModeChange={setListingFilterMode}
            listingSymbologyPreset={listingSymbologyPreset}
            onListingSymbologyPresetChange={setListingSymbologyPreset}
            // Push-only callbacks
            onListingsLoaded={setListings}
            onTopoStatsChange={setTopoStats}
            onParcelTopoStatsChange={setParcelTopoStats}
            onSelectedVineyardsChange={setSelectedVineyards}
            onInsideIdsChange={setInsideIds}
            onVineyardRecidSetChange={setVineyardRecidSet}
            onMapReady={() => setMapReady(true)}
          />
        </div>
      </div>
    </div>
  );
}
