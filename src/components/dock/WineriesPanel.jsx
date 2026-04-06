import { GLASS } from './glassTokens';
import { LISTING_CATEGORIES, LISTINGS, LISTING_FILTER_MODES } from '../WVWAMap';

/**
 * WineriesPanel — "Wineries" dock panel.
 * Winery filter controls + scrollable listing directory.
 */

export default function WineriesPanel({ listingFilterMode, onListingFilterModeChange, activeFilterLabel, vineyardRecidSet, onListingClick, onHoverListing, selectedAva, insideIds }) {
  // Filter listings to winery records + selected mode + AVA allowlist (insideIds = null means all)
  const visible = LISTINGS.filter(l =>
    l.category === 'winery' &&
    (listingFilterMode !== LISTING_FILTER_MODES.withVineyardPolygons || vineyardRecidSet.has(l.id)) &&
    (listingFilterMode !== LISTING_FILTER_MODES.withoutVineyardPolygons || !vineyardRecidSet.has(l.id)) &&
    (insideIds === null || insideIds === undefined || insideIds.includes(l.id))
  );

  const isAllMode = listingFilterMode === LISTING_FILTER_MODES.allWineries;
  const hasPolygonMode = listingFilterMode === LISTING_FILTER_MODES.withVineyardPolygons;
  const noPolygonMode = listingFilterMode === LISTING_FILTER_MODES.withoutVineyardPolygons;
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
            border: `1px solid ${isAllMode ? wineryCategory.color + '99' : 'rgba(250,247,242,0.12)'}`,
            background: isAllMode ? wineryCategory.color + '28' : 'rgba(250,247,242,0.04)',
            cursor: 'pointer',
            outline: 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: isAllMode ? wineryCategory.color : 'rgba(250,247,242,0.25)',
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: isAllMode ? 'rgba(250,247,242,0.9)' : 'rgba(250,247,242,0.35)',
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
            border: `1px solid ${hasPolygonMode ? wineryCategory.color + '99' : 'rgba(250,247,242,0.12)'}`,
            background: hasPolygonMode ? wineryCategory.color + '28' : 'rgba(250,247,242,0.04)',
            cursor: 'pointer',
            outline: 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: hasPolygonMode ? wineryCategory.color : 'rgba(250,247,242,0.25)',
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: hasPolygonMode ? 'rgba(250,247,242,0.9)' : 'rgba(250,247,242,0.35)',
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
            border: `1px solid ${noPolygonMode ? wineryCategory.color + '99' : 'rgba(250,247,242,0.12)'}`,
            background: noPolygonMode ? wineryCategory.color + '28' : 'rgba(250,247,242,0.04)',
            cursor: 'pointer',
            outline: 'none',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: noPolygonMode ? wineryCategory.color : 'rgba(250,247,242,0.25)',
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: noPolygonMode ? 'rgba(250,247,242,0.9)' : 'rgba(250,247,242,0.35)',
            whiteSpace: 'nowrap',
            letterSpacing: '0.01em',
          }}>
            Wineries without Vineyard Polygons
          </span>
        </button>
      </div>

      <div style={{
        fontSize: 10,
        color: 'rgba(250,247,242,0.45)',
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
          color: 'rgba(250,247,242,0.3)',
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
                key={listing.id}
                onClick={() => onListingClick?.(listing)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid rgba(250,247,242,0.07)',
                  background: 'rgba(250,247,242,0.04)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  outline: 'none',
                  width: '100%',
                  transition: 'background 0.12s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(250,247,242,0.09)';
                  onHoverListing?.(listing);
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(250,247,242,0.04)';
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
                  color: '#fff',
                  flexShrink: 0,
                }}>
                  {listing.num}
                </span>
                {/* Text */}
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'rgba(250,247,242,0.88)',
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
