import { TOKENS, alpha } from '../../styles/tokens';
import { GLASS } from './glassTokens';
import { LISTING_CATEGORIES, LISTING_FILTER_MODES } from '../WVWAMap';

/* ─── Design tokens ──────────────────────────────────────────────────── */
const UI = {
  filterIdleBorder: alpha(TOKENS.parchment, 0.12),
  filterIdleBg:     alpha(TOKENS.parchment, 0.04),
  filterDotIdle:    alpha(TOKENS.parchment, 0.25),
  filterTextActive: alpha(TOKENS.parchment, 0.9),
  filterTextIdle:   alpha(TOKENS.parchment, 0.35),
  subtleText:       alpha(TOKENS.parchment, 0.45),
  emptyText:        alpha(TOKENS.parchment, 0.3),
  rowBorder:        alpha(TOKENS.parchment, 0.07),
  rowBg:            alpha(TOKENS.parchment, 0.04),
  rowHoverBg:       alpha(TOKENS.parchment, 0.09),
  rowTitleText:     alpha(TOKENS.parchment, 0.88),
  badgeText:        'white',
};

/**
 * WineriesPanel — "Wineries" dock panel.
 * Winery filter controls + scrollable listing directory.
 */

export default function WineriesPanel({ listings = [], listingFilterMode, onListingFilterModeChange, activeFilterLabel, vineyardRecidSet, onListingClick, onHoverListing, selectedAva, insideIds }) {
  // Filter listings to winery records + selected mode + AVA allowlist (insideIds = null means all)
  const visible = listingFilterMode === LISTING_FILTER_MODES.noWineriesVisualized ? [] : listings.filter(l =>
    l.category === 'winery' &&
    (listingFilterMode !== LISTING_FILTER_MODES.withVineyardPolygons || vineyardRecidSet.has(l.id)) &&
    (listingFilterMode !== LISTING_FILTER_MODES.withoutVineyardPolygons || !vineyardRecidSet.has(l.id)) &&
    (insideIds === null || insideIds === undefined || insideIds.includes(l.id))
  );

  const isAllMode = listingFilterMode === LISTING_FILTER_MODES.allWineries;
  const hasPolygonMode = listingFilterMode === LISTING_FILTER_MODES.withVineyardPolygons;
  const noPolygonMode = listingFilterMode === LISTING_FILTER_MODES.withoutVineyardPolygons;
  const noWineriesVisualizedMode = listingFilterMode === LISTING_FILTER_MODES.noWineriesVisualized;
  const wineryCategory = LISTING_CATEGORIES.winery;

  return (
    <div style={{ padding: '12px 12px 16px', fontFamily: 'Inter, sans-serif' }}>

      {/* ── Listing mode buttons ─────────────────────────────────── */}
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: GLASS.textDim,
        marginBottom: 8,
      }}>
        Winery Listing Mode
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        <button
          onClick={() => onListingFilterModeChange?.(LISTING_FILTER_MODES.allWineries)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 10px',
            borderRadius: 20,
            border: `1px solid ${isAllMode ? wineryCategory.color + '99' : UI.filterIdleBorder}`,
            background: isAllMode ? wineryCategory.color + '28' : UI.filterIdleBg,
            cursor: 'pointer',
            outline: 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: isAllMode ? wineryCategory.color : UI.filterDotIdle,
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: isAllMode ? UI.filterTextActive : UI.filterTextIdle,
            whiteSpace: 'nowrap',
            letterSpacing: '0.01em',
          }}>
            All Wineries &amp; Vineyards
          </span>
        </button>

        <button
          onClick={() => onListingFilterModeChange?.(LISTING_FILTER_MODES.withVineyardPolygons)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 10px',
            borderRadius: 20,
            border: `1px solid ${hasPolygonMode ? wineryCategory.color + '99' : UI.filterIdleBorder}`,
            background: hasPolygonMode ? wineryCategory.color + '28' : UI.filterIdleBg,
            cursor: 'pointer',
            outline: 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: hasPolygonMode ? wineryCategory.color : UI.filterDotIdle,
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: hasPolygonMode ? UI.filterTextActive : UI.filterTextIdle,
            whiteSpace: 'nowrap',
            letterSpacing: '0.01em',
          }}>
            Wineries with Vineyard Polygons
          </span>
        </button>

        <button
          onClick={() => onListingFilterModeChange?.(LISTING_FILTER_MODES.withoutVineyardPolygons)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 10px',
            borderRadius: 20,
            border: `1px solid ${noPolygonMode ? wineryCategory.color + '99' : UI.filterIdleBorder}`,
            background: noPolygonMode ? wineryCategory.color + '28' : UI.filterIdleBg,
            cursor: 'pointer',
            outline: 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: noPolygonMode ? wineryCategory.color : UI.filterDotIdle,
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: noPolygonMode ? UI.filterTextActive : UI.filterTextIdle,
            whiteSpace: 'nowrap',
            letterSpacing: '0.01em',
          }}>
            Wineries without Vineyard Polygons
          </span>
        </button>

        <button
          onClick={() => onListingFilterModeChange?.(LISTING_FILTER_MODES.noWineriesVisualized)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 10px',
            borderRadius: 20,
            border: `1px solid ${noWineriesVisualizedMode ? wineryCategory.color + '99' : UI.filterIdleBorder}`,
            background: noWineriesVisualizedMode ? wineryCategory.color + '28' : UI.filterIdleBg,
            cursor: 'pointer',
            outline: 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: noWineriesVisualizedMode ? wineryCategory.color : UI.filterDotIdle,
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: noWineriesVisualizedMode ? UI.filterTextActive : UI.filterTextIdle,
            whiteSpace: 'nowrap',
            letterSpacing: '0.01em',
          }}>
            No Wineries Visualized
          </span>
        </button>
      </div>

      <div style={{
        fontSize: 10,
        color: UI.subtleText,
        marginTop: -6,
        marginBottom: 10,
      }}>
        Showing: {activeFilterLabel}
      </div>

      {/* ── Listing count ─────────────────────────────────────────── */}
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: GLASS.textDim,
        marginBottom: 8,
      }}>
        {visible.length} {visible.length === 1 ? 'Listing' : 'Listings'}
        {selectedAva ? ' in AVA' : ''}
      </div>

      {/* ── Listing rows ──────────────────────────────────────────── */}
      {visible.length === 0 ? (
        <div style={{
          padding: '20px 0',
          textAlign: 'center',
          color: UI.emptyText,
          fontSize: 12,
        }}>
          No winery listings match this mode
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {visible.map(listing => {
            const cat = LISTING_CATEGORIES[listing.category];
            return (
              <button
                key={listing.num ?? listing.id}
                onClick={() => onListingClick?.(listing)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid `,
                  background: UI.filterIdleBg,
                  cursor: 'pointer',
                  textAlign: 'left',
                  outline: 'none',
                  width: '100%',
                  transition: 'background 0.12s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = UI.rowHoverBg;
                  onHoverListing?.(listing);
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = UI.filterIdleBg;
                  onHoverListing?.(null);
                }}
              >
                {/* Number badge */}
                <span style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: cat.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  fontWeight: 700,
                  color: UI.badgeText,
                  flexShrink: 0,
                }}>
                  {listing.num}
                </span>
                {/* Text */}
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: UI.rowTitleText,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {listing.title}
                  </div>
                  <div style={{
                    fontSize: 10,
                    color: cat.color,
                    fontWeight: 600,
                    marginTop: 1,
                    letterSpacing: '0.02em',
                  }}>
                    {cat.label}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
