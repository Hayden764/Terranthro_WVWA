import { useState, useRef, useEffect } from 'react';
import WVWAMap, { LISTING_FILTER_MODES } from '../components/WVWAMap';
import ExplorerSidebar from '../components/ExplorerSidebar';
import { alpha, border, crimson, ink, parchment, TOKENS, TYPE } from '../styles/tokens';

const UI = {
  taglineText:      alpha(TOKENS.parchment, 0.5),
  btnBorderIdle:    alpha(TOKENS.parchment, 0.25),
  btnTextIdle:      alpha(TOKENS.parchment, 0.35),
  btnHoverBg:       alpha(TOKENS.parchment, 0.1),
  subtleLabel:      alpha(TOKENS.parchment, 0.45),
  scrimBg:          alpha('black', 0.45),
  fabShadow:        alpha('black', 0.28),
};
import { useIsMobile } from '../lib/useIsMobile';

// ── Entrance Panel (Option B — Dark Cinematic) ───────────────────────────
function EntrancePanel({ onEnter, mapReady, isMobile }) {
  return (
    <div style={{
      width: isMobile ? '100%' : 300,
      height: '100%',
      flexShrink: 0,
      background: ink,
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
          fontSize: 'var(--type-display-medium-size)',
          fontWeight: 700,
          color: parchment,
          letterSpacing: '-0.01em',
          lineHeight: 1.15,
          fontFamily: 'var(--font-display)',
        }}>
          Willamette Valley
        </div>
        <div style={{
          fontSize: 'var(--type-display-italic-size)',
          fontWeight: 400,
          color: parchment,
          letterSpacing: '0.04em',
          lineHeight: 1.3,
          fontFamily: 'var(--font-display)',
          opacity: 0.8,
          marginTop: 4,
        }}>
          Wine Country
        </div>
      </div>

      {/* Burgundy rule */}
      <div style={{ width: 40, height: 2, background: crimson, borderRadius: 1, marginBottom: 20 }} />

      {/* Tagline */}
      <div style={{
        fontSize: 'var(--type-body-size)',
          color: UI.taglineText,
        fontStyle: 'italic',
        letterSpacing: '0.06em',
        textAlign: 'center',
        marginBottom: 48,
        lineHeight: 1.7,
      }}>
        11 AVAs&nbsp;&nbsp;·&nbsp;&nbsp;500+ Wineries<br />
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
          border: `1.5px solid ${mapReady ? parchment : UI.btnBorderIdle}`,
          borderRadius: 4,
          color: mapReady ? parchment : UI.btnTextIdle,
          ...TYPE.uiLabel,
          fontSize: 'var(--type-mono-size)',
          fontWeight: 600,
          cursor: mapReady ? 'pointer' : 'default',
          fontFamily: 'var(--font-sans)',
          transition: 'background 0.2s, color 0.2s, border-color 0.2s',
        }}
        onMouseEnter={e => {
          if (!mapReady) return;
          e.currentTarget.style.background = UI.btnHoverBg;
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
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100vh', overflow: 'hidden', background: parchment, fontFamily: 'var(--font-sans)' }}>

      {/* ── Slim header ─────────────────────────────────────────────── */}
      <header style={{
        height: 48,
        background: ink,
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
        <div style={{ fontSize: 'var(--type-body-size)', color: UI.subtleLabel, fontFamily: 'var(--font-sans)', letterSpacing: '0.02em' }}>
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
              background: UI.scrimBg,
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
                background: ink, border: 'none', borderRadius: 10,
                color: parchment, fontSize: 'var(--type-display-italic-size)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', boxShadow: `0 2px 8px ${UI.fabShadow}`,
                fontFamily: 'var(--font-sans)', lineHeight: 1,
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
