import { useState, useRef, useEffect, useCallback } from 'react';
import WVWAMap, { LISTING_FILTER_MODES } from '../components/WVWAMap';
import ExplorerSidebar, { SHEET_PEEK_PX } from '../components/ExplorerSidebar';
import FilterModal from '../components/FilterModal';
import { useVineyardFilters } from '../lib/useVineyardFilters';
import { VINTAGE_LAST_YEAR, isVintageLayer } from '../config/climateMapConfig';
import { MapVintageYearControl } from '../components/climate/VintageYearControls';
import LegendSelectionChip from '../components/LegendSelectionChip';
import { legendGroupsFor } from '../lib/legendGroups';
import { topoRangeLabel } from '../config/topoClasses';
import { alpha, border, crimson, ink, parchment, TOKENS, TYPE } from '../styles/tokens';

const UI = {
  taglineText:      alpha(TOKENS.parchment, 0.5),
  btnBorderIdle:    alpha(TOKENS.parchment, 0.25),
  btnTextIdle:      alpha(TOKENS.parchment, 0.35),
  btnHoverBg:       alpha(TOKENS.parchment, 0.1),
  subtleLabel:      alpha(TOKENS.parchment, 0.45),
};
import { useIsMobile } from '../lib/useIsMobile';

// ── Portal Header Button ─────────────────────────────────────────────────
function PortalHeaderButton() {
  return (
    <a
      href="/portal"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 12px',
        border: `1px solid ${alpha(TOKENS.parchment, 0.25)}`,
        borderRadius: 4,
        color: alpha(TOKENS.parchment, 0.55),
        fontSize: 10,
        fontFamily: 'var(--font-sans)',
        fontWeight: 500,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        textDecoration: 'none',
        transition: 'border-color 0.2s, color 0.2s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = alpha(TOKENS.parchment, 0.6);
        e.currentTarget.style.color = alpha(TOKENS.parchment, 0.95);
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = alpha(TOKENS.parchment, 0.25);
        e.currentTarget.style.color = alpha(TOKENS.parchment, 0.55);
      }}
    >
      Winery Portal
      <span style={{ fontSize: 9, opacity: 0.7 }}>→</span>
    </a>
  );
}

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
        src="/terranthro-logo.svg"
        alt="Terranthro"
        style={{ height: 48, width: 'auto', marginBottom: 36, opacity: 0.92 }}
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

      {/* Portal sign-in link */}
      <div style={{ marginTop: 20, textAlign: 'center' }}>
        <a
          href="/portal"
          style={{
            fontSize: 11,
            letterSpacing: '0.06em',
            color: alpha(TOKENS.parchment, 0.35),
            fontFamily: 'var(--font-sans)',
            fontStyle: 'italic',
            textDecoration: 'none',
            transition: 'color 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = alpha(TOKENS.parchment, 0.8); }}
          onMouseLeave={e => { e.currentTarget.style.color = alpha(TOKENS.parchment, 0.35); }}
        >
          Winery owner? Sign in to your portal
        </a>
      </div>
    </div>
  );
}

export default function WVWAMapPage() {
  const mapRef = useRef(null);

  const isMobile = useIsMobile();
  // Mobile panel is a bottom sheet with three resting heights; it is never
  // fully dismissed, so there is no open/closed state to get stuck in.
  const [sheetDetent, setSheetDetent] = useState('peek');

  // ── Entrance state ───────────────────────────────────────────────────
  // Skip intro on reload if the user has already seen it this tab session,
  // or if `?skipIntro=1` is in the URL. This keeps dev iteration fast and
  // lets us share deep-link URLs that bypass the cinematic.
  const shouldSkipIntro = () => {
    if (typeof window === 'undefined') return false;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('skipIntro') === '1') return true;
      return window.sessionStorage.getItem('wvwa:introSeen') === '1';
    } catch {
      return false;
    }
  };
  const [isIntro, setIsIntro]     = useState(() => !shouldSkipIntro());
  const [mapReady, setMapReady]   = useState(false);

  function handleEnter() {
    mapRef.current?.startEntranceAnimation?.();
    try { window.sessionStorage.setItem('wvwa:introSeen', '1'); } catch { /* ignore */ }
    setIsIntro(false);
  }

  // When the map is ready and we've decided to skip the intro, jump
  // straight to the WV camera instead of playing the entrance.
  useEffect(() => {
    if (mapReady && !isIntro) {
      mapRef.current?.skipEntranceAnimation?.();
    }
  }, [mapReady, isIntro]);

  // ── AVA selection ────────────────────────────────────────────────────
  const [selectedAva, setSelectedAva]         = useState(null);
  const [panelHoveredAva, setPanelHoveredAva] = useState(null);

  // ── Sidebar collapse ─────────────────────────────────────────────────

  // ── Lifted map state (shared between WVWAMap and ExplorerSidebar) ────
  const [listings, setListings]                     = useState([]);
  const [selectedListing, setSelectedListing]       = useState(null);
  const [activeLayer, setActiveLayer]               = useState(null);
  const [currentMonth, setCurrentMonth]             = useState(new Date().getMonth() + 1);
  // Vintage shown by the climate map layer; shared with the sidebar's vintage stripes
  const [climateYear, setClimateYear]               = useState(VINTAGE_LAST_YEAR);
  // Legend filter per data layer: { [layerId]: [class keys] } — empty = show all.
  // Kept per layer, so switching Soils → Bedrock → Soils keeps the soil selection.
  const [legendSelection, setLegendSelection]       = useState({});
  // Topography custom ranges: { [layerId]: [lo, hi] } (aspect: [from, to] clockwise).
  // A range and a legend selection are alternatives — setting one clears the other.
  const [topoRanges, setTopoRanges]                 = useState({});
  const setLayerSelection = useCallback((layerId, keys) => {
    setLegendSelection((prev) => ({ ...prev, [layerId]: keys }));
    if (keys?.length) setTopoRanges((prev) => ({ ...prev, [layerId]: null }));
  }, []);
  const setTopoRange = useCallback((layerId, range) => {
    setTopoRanges((prev) => ({ ...prev, [layerId]: range }));
    if (range) setLegendSelection((prev) => ({ ...prev, [layerId]: [] }));
  }, []);
  const [listingFilterMode, setListingFilterMode]   = useState(LISTING_FILTER_MODES.allWineries);
  const [listingSymbologyPreset, setListingSymbologyPreset] = useState('topoModern');
  const [topoStats, setTopoStats]                   = useState(null);
  const [parcelTopoStats, setParcelTopoStats]       = useState({});
  const [selectedVineyards, setSelectedVineyards]   = useState([]);
  const [insideIds, setInsideIds]                   = useState(null);
  const [vineyardRecidSet, setVineyardRecidSet]     = useState(() => new Map());
  const [vineyardTheme, setVineyardTheme]           = useState('ownership');
  // Vineyard a map click landed on, so the sidebar opens that one rather than
  // the winery's first. Bumped with a nonce so re-clicking the same vineyard
  // after the user collapsed it still re-opens it.
  const [focusedVineyard, setFocusedVineyard]       = useState(null);
  const [vineyardThemeValues, setVineyardThemeValues] = useState(null);
  // Which vineyards the map emphasizes, driven by the sidebar's page level
  // ('all' everywhere except a winery page, where it's 'winery').
  const [vineyardScope, setVineyardScope]           = useState('all');

  // ── Vineyard filter modal (elevation/slope/aspect/variety/AVA/acres) ────
  const vineyardFilters = useVineyardFilters();
  const [filterModalOpen, setFilterModalOpen] = useState(false);

  // Raise the sheet to half height when a map interaction selects something —
  // enough to read the winery and its vineyards while the map stays on screen.
  // Deliberately not 'full': burying the map was the old drawer's whole problem.
  useEffect(() => { if (isMobile && selectedListing) setSheetDetent(d => (d === 'peek' ? 'half' : d)); }, [isMobile, selectedListing]);
  useEffect(() => { if (isMobile && selectedAva) setSheetDetent(d => (d === 'peek' ? 'half' : d)); }, [isMobile, selectedAva]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100dvh', overflow: 'hidden', background: parchment, fontFamily: 'var(--font-sans)' }}>

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a
            href="https://www.willamettewines.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', lineHeight: 0 }}
          >
            <img
              src="/willamette-logo.svg"
              alt="Willamette Valley Wine Country"
              style={{ height: 26, width: 'auto', display: 'block', filter: 'brightness(0) invert(1)', opacity: 0.85 }}
            />
          </a>
          <span style={{ color: alpha(TOKENS.parchment, 0.3), fontSize: 13, fontWeight: 300, lineHeight: 1, userSelect: 'none' }}>×</span>
          <a
            href="https://terranthro.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', lineHeight: 0 }}
          >
            <img
              src="/terrantrho-logo-text.svg"
              alt="Terranthro"
              style={{ height: 18, width: 'auto', display: 'block', opacity: 0.85 }}
            />
          </a>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
          {/* Phone widths can't fit the tagline: it wrapped to three lines and
              spilled out of the 48px bar, over both logos. */}
          {!isMobile && (
            <div style={{ fontSize: 'var(--type-body-size)', color: UI.subtleLabel, fontFamily: 'var(--font-sans)', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
              Wineries &amp; AVA Explorer
            </div>
          )}
          <PortalHeaderButton />
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
            sheetDetent={sheetDetent}
            onSheetDetentChange={setSheetDetent}
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
            climateYear={climateYear}
            onClimateYearChange={setClimateYear}
            legendSelection={legendSelection}
            onLegendSelectionChange={setLayerSelection}
            topoRanges={topoRanges}
            onTopoRangeChange={setTopoRange}
            topoStats={topoStats}
            listingFilterMode={listingFilterMode}
            onListingFilterModeChange={setListingFilterMode}
            vineyardTheme={vineyardTheme}
            onVineyardThemeChange={setVineyardTheme}
            vineyardThemeValues={vineyardThemeValues}
            selectedVineyards={selectedVineyards}
            parcelTopoStats={parcelTopoStats}
            focusedVineyard={focusedVineyard}
            onVineyardHover={(features) => mapRef.current?.hoverVineyards?.(features)}
            onViewAllVineyards={(features) => mapRef.current?.viewAllVineyards?.(features)}
            onVineyardScopeChange={setVineyardScope}
            onOpenFilters={() => setFilterModalOpen(true)}
            filterActiveCount={vineyardFilters.activeCount}
            vineyardFilterResult={vineyardFilters.queryResult}
          />
        )}

        {/* Map — on mobile it ends above the sheet's resting height, so the
            sheet never covers the whole map and the attribution stays legible.
            The hamburger is gone: the sheet's own handle is always on screen. */}
        <div style={{
          flex: 1, position: 'relative', overflow: 'hidden',
          marginBottom: isMobile && !isIntro ? SHEET_PEEK_PX : 0,
        }}>
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
            climateYear={climateYear}
            onClimateYearChange={setClimateYear}
            legendSelection={legendSelection}
            onLegendSelectionChange={setLayerSelection}
            topoRanges={topoRanges}
            onTopoRangeChange={setTopoRange}
            listingFilterMode={listingFilterMode}
            onListingFilterModeChange={setListingFilterMode}
            vineyardTheme={vineyardTheme}
            onVineyardThemeValuesChange={setVineyardThemeValues}
            onVineyardFocus={(name) => setFocusedVineyard({ name, at: Date.now() })}
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
            // Vineyard filter overlay (dimming + matched parcels)
            matchedParcelIds={vineyardFilters.queryResult?.matching_vineyard_ids ?? null}
            filtersActive={vineyardFilters.isActive}
            vineyardScope={vineyardScope}
          />
          {/* Mobile: the sidebar's year picker is buried in the bottom sheet, so
              the vintage layer gets its own year control on the map */}
          {isMobile && !isIntro && (isVintageLayer(activeLayer) || legendSelection[activeLayer]?.length > 0 || topoRanges[activeLayer]) && (
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 20,
              width: 'calc(100% - 32px)', maxWidth: 360, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            }}>
              {isVintageLayer(activeLayer) && <MapVintageYearControl layerId={activeLayer} year={climateYear} onChange={setClimateYear} />}
              <LegendSelectionChip
                groups={legendGroupsFor(activeLayer)}
                selected={legendSelection[activeLayer]}
                text={topoRanges[activeLayer] ? topoRangeLabel(activeLayer, topoRanges[activeLayer]) : undefined}
                onClear={() => { setLayerSelection(activeLayer, []); setTopoRange(activeLayer, null); }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Vineyard filter modal */}
      <FilterModal
        open={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        filters={vineyardFilters.filters}
        onApply={vineyardFilters.setFilters}
        onReset={vineyardFilters.resetFilters}
        liveResultSummary={vineyardFilters.queryResult ? {
          wineries: vineyardFilters.queryResult.winery_total_count,
          parcels:  vineyardFilters.queryResult.matching_vineyard_total_count,
        } : null}
      />
    </div>
  );
}
