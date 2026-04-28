import { useState, useMemo, useRef, useEffect } from 'react';
import { LISTING_CATEGORIES } from './WVWAMap';
import { alpha, border, crimson, ink, mix, parchment, TOKENS } from '../styles/tokens';

// Category order for display
const CATEGORY_ORDER = ['winery', 'tasting', 'restaurant', 'hotel', 'other'];

const UI = {
  modalBg: alpha(TOKENS.ink, 0.96),
  modalHeaderBg: alpha(TOKENS.ink, 0.97),
  panelBorder: alpha(TOKENS.surfaceRaised, 0.85),
  panelBorderLight: alpha(TOKENS.surfaceRaised, 0.5),
  textDim: alpha(TOKENS.parchment, 0.45),
  textMuted: alpha(TOKENS.parchment, 0.35),
  textSoft: alpha(TOKENS.parchment, 0.6),
  textFaint: alpha(TOKENS.parchment, 0.25),
  textVeryFaint: alpha(TOKENS.parchment, 0.2),
  chipBg: alpha(TOKENS.parchment, 0.08),
  chipBgActive: alpha(TOKENS.parchment, 0.05),
  rowHover: alpha(TOKENS.parchment, 0.06),
  overlayBg: alpha('black', 0.55),
  modalShadow: alpha('black', 0.55),
  closeHoverBg: alpha(TOKENS.parchment, 0.15),
  rowNumberText: alpha(parchment, 0.95),
  rowNumberBorder: alpha(TOKENS.parchment, 0.25),
  rowNumberShadow: alpha('black', 0.3),
  rowTitleIdle: alpha(TOKENS.parchment, 0.88),
  rowDesc: alpha(TOKENS.parchment, 0.38),
};

export default function ListingsModal({ isOpen, onClose, onSelectListing, listings = [] }) {
  const [activeTab, setActiveTab]   = useState('all'); // 'all' | category key
  const searchRef = useRef(null);

  // Focus search on open
  useEffect(() => {
    if (isOpen && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 80);
    }
    if (!isOpen) setQuery('');
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listings.filter(l => {
      const matchesTab = activeTab === 'all' || l.category === activeTab;
      if (!matchesTab) return false;
      if (!q) return true;
      return (
        l.title.toLowerCase().includes(q) ||
        l.desc.toLowerCase().includes(q) ||
        LISTING_CATEGORIES[l.category].label.toLowerCase().includes(q)
      );
    });
  }, [query, activeTab]);

  // Group filtered results by category for the "all" tab
  const grouped = useMemo(() => {
    if (activeTab !== 'all') return null;
    const groups = {};
    CATEGORY_ORDER.forEach(k => { groups[k] = []; });
    filtered.forEach(l => {
      if (groups[l.category]) groups[l.category].push(l);
    });
    return groups;
  }, [filtered, activeTab]);

  const counts = useMemo(() => {
    const c = { all: listings.length };
    CATEGORY_ORDER.forEach(k => {
      c[k] = listings.filter(l => l.category === k).length;
    });
    return c;
  }, [listings]);

  if (!isOpen) return null;

  const glass = {
    background: UI.modalBg,
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
  };

  return (
    /* Backdrop */
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: UI.overlayBg,
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Modal */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          ...glass,
          border: `1px solid ${UI.panelBorder}`,
          borderRadius: 16,
          width: 'min(780px, 95vw)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: `0 24px 80px ${UI.modalShadow}`,
          overflow: 'hidden',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          padding: '20px 24px 0',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h2 style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 700,
                color: parchment,
                fontFamily: 'var(--font-display)',
                letterSpacing: '-0.01em',
              }}>
                <span style={{ color: crimson }}>W</span>illamette Valley Directory
              </h2>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: UI.textDim }}>
                {listings.length} places · click any listing to locate on map
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                background: UI.chipBg,
                border: `1px solid ${UI.panelBorderLight}`,
                borderRadius: 8,
                color: UI.textSoft,
                cursor: 'pointer',
                fontSize: 18,
                lineHeight: 1,
                padding: '4px 10px',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = UI.closeHoverBg}
              onMouseLeave={e => e.currentTarget.style.background = UI.chipBg}
            >
              ✕
            </button>
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <span style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 14,
              color: UI.textMuted,
              pointerEvents: 'none',
            }}>🔍</span>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search wineries, restaurants, hotels…"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: UI.chipBgActive,
                border: `1px solid ${UI.panelBorderLight}`,
                borderRadius: 10,
                padding: '10px 12px 10px 36px',
                fontSize: 13,
                color: parchment,
                outline: 'none',
                fontFamily: 'var(--font-sans)',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = crimson}
              onBlur={e => e.target.style.borderColor = UI.panelBorderLight}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: UI.textDim,
                  cursor: 'pointer',
                  fontSize: 14,
                  padding: 2,
                }}
              >✕</button>
            )}
          </div>

          {/* Category tabs */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 12 }}>
            {[{ key: 'all', label: 'All', color: ink }, ...CATEGORY_ORDER.map(k => ({ key: k, ...LISTING_CATEGORIES[k] }))].map(tab => {
              const isActive = activeTab === tab.key;
              const count = tab.key === 'all'
                ? (query ? filtered.length : counts.all)
                : (query ? filtered.filter(l => l.category === tab.key).length : counts[tab.key]);
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 12px',
                    borderRadius: 20,
                    border: `1px solid ${isActive ? tab.color : UI.panelBorder}`,
                    background: isActive ? `${tab.color}22` : UI.chipBgActive,
                    background: isActive ? alpha(tab.color, 0.13) : UI.chipBgActive,
                    color: isActive ? tab.color : UI.textDim,
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: isActive ? 700 : 500,
                    fontFamily: 'var(--font-sans)',
                    transition: 'all 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab.key !== 'all' && (
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: isActive ? tab.color : UI.textFaint,
                      display: 'inline-block', flexShrink: 0,
                    }} />
                  )}
                  {tab.label}
                  <span style={{
                    background: isActive ? alpha(tab.color, 0.2) : UI.chipBg,
                    borderRadius: 10,
                    padding: '1px 6px',
                    fontSize: 10,
                    fontWeight: 600,
                    color: isActive ? tab.color : UI.textMuted,
                  }}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Scrollable list ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 20px' }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: UI.textMuted, fontSize: 14 }}>
              No listings match "{query}"
            </div>
          ) : activeTab === 'all' ? (
            // Grouped view
            CATEGORY_ORDER.map(catKey => {
              const items = grouped[catKey];
              if (!items?.length) return null;
              const cat = LISTING_CATEGORIES[catKey];
              return (
                <div key={catKey} style={{ marginBottom: 24 }}>
                  {/* Section header */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 10,
                    paddingTop: 4,
                    position: 'sticky',
                    top: 0,
                    background: UI.modalHeaderBg,
                    zIndex: 1,
                    paddingBottom: 6,
                  }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: cat.color, flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: cat.color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {cat.label}
                    </span>
                    <span style={{ fontSize: 11, color: UI.textFaint, fontWeight: 500 }}>
                      {items.length}
                    </span>
                  </div>
                  {/* Rows */}
                  {items.map(listing => (
                    <ListingRow
                      key={listing.id}
                      listing={listing}
                      cat={cat}
                      query={query}
                      onClick={() => onSelectListing(listing)}
                    />
                  ))}
                </div>
              );
            })
          ) : (
            // Single category view
            filtered.map(listing => (
              <ListingRow
                key={listing.id}
                listing={listing}
                cat={LISTING_CATEGORIES[listing.category]}
                query={query}
                onClick={() => onSelectListing(listing)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Individual listing row ──────────────────────────────────────────────────
function ListingRow({ listing, cat, query, onClick }) {
  const [hovered, setHovered] = useState(false);

  const descSnippet = listing.desc
    ? listing.desc.slice(0, 110) + (listing.desc.length > 110 ? '…' : '')
    : null;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '9px 10px',
        borderRadius: 10,
        cursor: 'pointer',
        marginBottom: 2,
        background: hovered ? UI.rowHover : 'transparent',
        border: `1px solid ${hovered ? UI.panelBorderLight : 'transparent'}`,
        transition: 'background 0.12s, border-color 0.12s',
      }}
    >
      {/* Numbered dot */}
      <div style={{
        width: 26,
        height: 26,
        borderRadius: '50%',
        background: cat.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontWeight: 700,
        color: UI.rowNumberText,
        flexShrink: 0,
        marginTop: 1,
        border: `1.5px solid ${UI.rowNumberBorder}`,
        boxShadow: `0 1px 4px ${UI.rowNumberShadow}, 0 0 0 1px ${alpha(cat.color, 0.4)}`,
      }}>
        {listing.num}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{
            fontSize: 13,
            fontWeight: 600,
            color: hovered ? parchment : UI.rowTitleIdle,
            lineHeight: 1.3,
          }}>
            <Highlight text={listing.title} query={query} color={cat.color} />
          </span>
        </div>
        {descSnippet && (
          <div style={{ fontSize: 11, color: UI.rowDesc, lineHeight: 1.5 }}>
            <Highlight text={descSnippet} query={query} color={cat.color} />
          </div>
        )}
      </div>

      {/* Arrow */}
      <div style={{
        fontSize: 13,
        color: hovered ? cat.color : UI.textVeryFaint,
        transition: 'color 0.12s',
        flexShrink: 0,
        alignSelf: 'center',
      }}>
        ↗
      </div>
    </div>
  );
}

// ── Query highlight helper ─────────────────────────────────────────────────
function Highlight({ text, query, color }) {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ background: `${color}44`, borderRadius: 2, padding: '0 1px' }}>
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}
