import { useState, useRef } from 'react';
import WVWAMap, { LISTING_FILTER_MODES } from '../components/WVWAMap';
import ExplorerSidebar from '../components/ExplorerSidebar';
import { BRAND } from '../config/brandColors';

export default function WVWAMapPage() {
  const mapRef = useRef(null);

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

        {/* Explorer Sidebar */}
        <ExplorerSidebar
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

        {/* Map */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
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
          />
        </div>
      </div>
    </div>
  );
}
