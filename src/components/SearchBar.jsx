import { useState, useRef, useEffect, useCallback } from 'react';
import { WV_SUB_AVAS } from '../config/topographyConfig';
import { LISTING_CATEGORIES } from './WVWAMap';
import { BRAND } from '../config/brandColors';

const API_BASE = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const API_HEADERS = import.meta.env.VITE_INTERNAL_API_KEY
  ? { 'x-api-key': import.meta.env.VITE_INTERNAL_API_KEY }
  : {};

const CATEGORY_ICON = {
  winery:     '🍷',
  tasting:    '🥂',
  hotel:      '🏨',
  restaurant: '🍽️',
  other:      '📍',
  vineyard:   '🍇',
  ava:        '◇',
};

function categoryLabel(r) {
  if (r.type === 'ava') return 'AVA';
  if (r.type === 'vineyard') return r.sublabel || 'Vineyard';
  return LISTING_CATEGORIES[r.category]?.label || r.sublabel || 'Winery';
}

// Filter AVAs client-side so every keystroke is instant for AVA results
function matchAvas(q) {
  const lq = q.toLowerCase();
  return WV_SUB_AVAS
    .filter((a) => a.name.toLowerCase().includes(lq))
    .map((a) => ({
      type:     'ava',
      id:       a.slug,
      label:    a.name,
      sublabel: 'AVA',
      category: 'ava',
      lng:      null,
      lat:      null,
    }));
}

// Group results into ordered sections
function groupResults(results) {
  const avas      = results.filter((r) => r.type === 'ava');
  const wineries  = results.filter((r) => r.type === 'winery');
  const vineyards = results.filter((r) => r.type === 'vineyard');
  return { avas, wineries, vineyards };
}

export default function SearchBar({ mapRef, onSelectAva }) {
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState([]);
  const [open, setOpen]             = useState(false);
  const [loading, setLoading]       = useState(false);
  const [activeIdx, setActiveIdx]   = useState(-1);
  // Mobile: collapsed to icon when window width < 640
  const [expanded, setExpanded]     = useState(window.innerWidth >= 640);

  const inputRef    = useRef(null);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);
  const abortRef    = useRef(null);

  // Sync expanded with window resize
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 640) setExpanded(true);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setActiveIdx(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = useCallback((q) => {
    // Always include AVA matches (client-side, instant)
    const avaMatches = q.length > 0 ? matchAvas(q) : [];

    if (!q) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    // Cancel any prior in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&limit=8`, {
      headers: API_HEADERS,
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((apiResults) => {
        const combined = [...avaMatches, ...apiResults];
        setResults(combined);
        setOpen(combined.length > 0);
        setActiveIdx(-1);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        // On API failure still show local AVA results
        setResults(avaMatches);
        setOpen(avaMatches.length > 0);
        setLoading(false);
      });
  }, []);

  const handleChange = (e) => {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounceRef.current);
    if (!q) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => search(q), 200);
  };

  const handleSelect = useCallback((result) => {
    setOpen(false);
    setQuery('');
    setActiveIdx(-1);

    if (result.type === 'ava') {
      onSelectAva(result.id);
      return;
    }

    if (result.type === 'winery') {
      mapRef.current?.selectListingById(result.id);
      return;
    }

    if (result.type === 'vineyard' && result.lng != null && result.lat != null) {
      mapRef.current?.flyToCoords({ lng: result.lng, lat: result.lat, zoom: 14 });
    }
  }, [mapRef, onSelectAva]);

  const flatResults = results;

  const handleKeyDown = (e) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && flatResults[activeIdx]) {
        handleSelect(flatResults[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setActiveIdx(-1);
      inputRef.current?.blur();
    }
  };

  const { avas, wineries, vineyards } = groupResults(results);

  // Section renderer
  const renderSection = (items, startIdx) => items.map((r, i) => {
    const idx = startIdx + i;
    const isActive = activeIdx === idx;
    const icon = CATEGORY_ICON[r.category] ?? '📍';
    const label = categoryLabel(r);

    return (
      <button
        key={`${r.type}-${r.id ?? r.label}-${i}`}
        onMouseDown={(e) => { e.preventDefault(); handleSelect(r); }}
        onMouseEnter={() => setActiveIdx(idx)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          textAlign: 'left',
          background: isActive ? 'rgba(142,21,55,0.12)' : 'transparent',
          border: 'none',
          borderLeft: isActive ? `3px solid ${BRAND.burgundy}` : '3px solid transparent',
          padding: '8px 14px',
          cursor: 'pointer',
          fontFamily: 'Inter, sans-serif',
          transition: 'background 0.1s',
        }}
      >
        <span style={{ fontSize: 15, flexShrink: 0, width: 20, textAlign: 'center' }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13,
            fontWeight: 600,
            color: isActive ? BRAND.burgundy : BRAND.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: 1.3,
          }}>
            {r.label}
          </div>
          <div style={{ fontSize: 11, color: BRAND.textMuted, marginTop: 1, lineHeight: 1.2 }}>
            {label}
          </div>
        </div>
      </button>
    );
  });

  // Mobile: show only a magnifier button when collapsed
  if (!expanded) {
    return (
      <button
        onClick={() => { setExpanded(true); setTimeout(() => inputRef.current?.focus(), 80); }}
        aria-label="Open search"
        style={{
          background: 'rgba(72,55,41,0.07)',
          border: `1px solid rgba(72,55,41,0.18)`,
          borderRadius: 8,
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: BRAND.brownDark,
          flexShrink: 0,
        }}
      >
        <SearchIcon />
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        top: '50%',
        marginTop: -18,
        width: 'min(480px, 33vw)',
        minWidth: 240,
        zIndex: 30,
        fontFamily: 'Inter, sans-serif',
      }}
    >
      {/* Input */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        background: BRAND.eggshell,
        border: `1.5px solid ${open ? BRAND.burgundy : 'rgba(72,55,41,0.22)'}`,
        borderRadius: open ? '10px 10px 0 0' : 10,
        padding: '0 12px',
        height: 36,
        gap: 8,
        boxShadow: open
          ? `0 4px 20px rgba(46,34,26,0.14), 0 0 0 3px rgba(142,21,55,0.08)`
          : '0 2px 8px rgba(46,34,26,0.08)',
        transition: 'border-color 0.15s, border-radius 0.1s, box-shadow 0.15s',
      }}>
        <span style={{ color: open ? BRAND.burgundy : BRAND.textMuted, flexShrink: 0, display: 'flex', transition: 'color 0.15s' }}>
          {loading
            ? <SpinnerIcon />
            : <SearchIcon />}
        </span>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          placeholder="Search wineries, vineyards, AVAs…"
          aria-label="Search wineries, vineyards, and AVAs"
          autoComplete="off"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 13,
            color: BRAND.text,
            fontFamily: 'Inter, sans-serif',
            caretColor: BRAND.burgundy,
          }}
        />

        {query && (
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              setQuery('');
              setResults([]);
              setOpen(false);
              setActiveIdx(-1);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            style={{
              background: 'none',
              border: 'none',
              color: BRAND.textMuted,
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: '2px 4px',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        )}

        {/* Mobile close button */}
        {window.innerWidth < 640 && (
          <button
            onMouseDown={(e) => { e.preventDefault(); setExpanded(false); setQuery(''); setOpen(false); }}
            aria-label="Close search"
            style={{
              background: 'none',
              border: 'none',
              color: BRAND.textMuted,
              cursor: 'pointer',
              fontSize: 11,
              lineHeight: 1,
              padding: '2px 4px',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: BRAND.eggshell,
          border: `1.5px solid ${BRAND.burgundy}`,
          borderTop: `1px solid ${BRAND.border}`,
          borderRadius: '0 0 10px 10px',
          boxShadow: '0 8px 24px rgba(46,34,26,0.16)',
          overflowY: 'auto',
          maxHeight: 360,
          scrollbarWidth: 'thin',
          scrollbarColor: `${BRAND.border} transparent`,
        }}>
          {results.length === 0 && !loading && (
            <div style={{
              padding: '14px 16px',
              fontSize: 13,
              color: BRAND.textMuted,
              textAlign: 'center',
            }}>
              No results for &ldquo;{query}&rdquo;
            </div>
          )}

          {/* AVAs section */}
          {avas.length > 0 && (
            <>
              <SectionHeader label="AVAs" />
              {renderSection(avas, 0)}
            </>
          )}

          {/* Wineries / Partners section */}
          {wineries.length > 0 && (
            <>
              <SectionHeader label="Wineries &amp; Partners" />
              {renderSection(wineries, avas.length)}
            </>
          )}

          {/* Vineyards section */}
          {vineyards.length > 0 && (
            <>
              <SectionHeader label="Vineyards" />
              {renderSection(vineyards, avas.length + wineries.length)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ label }) {
  return (
    <div style={{
      padding: '5px 14px 3px',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: BRAND.textMuted,
      borderTop: `1px solid ${BRAND.border}`,
    }}
      dangerouslySetInnerHTML={{ __html: label }}
    />
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <span style={{
      display: 'inline-block',
      width: 13,
      height: 13,
      border: '2px solid rgba(72,55,41,0.2)',
      borderTopColor: BRAND.burgundy,
      borderRadius: '50%',
      animation: 'sb-spin 0.7s linear infinite',
    }}>
      <style>{`@keyframes sb-spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
