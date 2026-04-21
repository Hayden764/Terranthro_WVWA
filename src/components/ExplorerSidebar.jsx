import { useState, useEffect, useCallback, useRef } from 'react';
import { BRAND } from '../config/brandColors';
import { WV_SUB_AVAS, TOPO_LAYER_TYPES } from '../config/topographyConfig';
import SearchBar from './SearchBar';
import { LISTING_FILTER_MODES } from './WVWAMap';
import { MONTH_ABBR } from '../config/climateConfig';

// ── Design tokens (light‑mode, eggshell base) ────────────────────────────
const T = {
  sidebarBg:    BRAND.eggshell,
  headerBg:     BRAND.brown,
  headerText:   BRAND.eggshell,
  border:       BRAND.border,
  sectionLabel: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: BRAND.textMuted },
  itemText:     { fontSize: 13, color: BRAND.text, lineHeight: 1.45 },
  itemTextMuted:{ fontSize: 12, color: BRAND.textMuted, lineHeight: 1.4 },
  accent:       BRAND.burgundy,
  hoverBg:      BRAND.cream,
  activeBg:     'rgba(142,21,55,0.08)',
};

const SIDEBAR_W = 300;

// ── Colormap gradients (matching WVWAMap / ScalePanel) ───────────────────
const COLORMAP_CSS = {
  terrain:  'linear-gradient(to right, #0B6623, #90EE90, #F5F5DC, #D2B48C, #8B4513, #FFFFFF)',
  rdylgn_r: 'linear-gradient(to right, #1A9850, #91CF60, #D9EF8B, #FEE08B, #FC8D59, #D73027)',
  hsv:      'linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)',
  plasma:   'linear-gradient(to right, #0D0887, #7E03A8, #CC4778, #F89441, #F0F921)',
};

// ── Helpers ───────────────────────────────────────────────────────────────
const Chevron = ({ open, size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.18s', flexShrink: 0 }}>
    <path d="M19 9l-7 7-7-7" />
  </svg>
);

const BackBtn = ({ onClick }) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex', alignItems: 'center', gap: 6,
      background: 'none', border: 'none', cursor: 'pointer',
      color: BRAND.textMuted, fontSize: 12, padding: '8px 16px',
      fontFamily: 'Inter, sans-serif', width: '100%', textAlign: 'left',
      borderBottom: `1px solid ${BRAND.border}`,
    }}
    onMouseEnter={e => e.currentTarget.style.color = BRAND.brown}
    onMouseLeave={e => e.currentTarget.style.color = BRAND.textMuted}
  >
    <span style={{ fontSize: 14, lineHeight: 1 }}>‹</span> Back
  </button>
);

function SectionHeader({ label, open, onToggle, count }) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', padding: '10px 16px',
        background: 'none', border: 'none', borderBottom: `1px solid ${BRAND.border}`,
        cursor: 'pointer', fontFamily: 'Inter, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={T.sectionLabel}>{label}</span>
        {count != null && (
          <span style={{ fontSize: 10, background: BRAND.cream, borderRadius: 10, padding: '1px 7px', color: BRAND.textMuted, fontWeight: 600 }}>
            {count}
          </span>
        )}
      </div>
      <Chevron open={open} />
    </button>
  );
}

// ── AVA detail view ───────────────────────────────────────────────────────
const AVA_META = {
  'chehalem-mountains':  { acres: '~68,000', established: 1983, highlights: 'Diverse soils including Jory, Laurelwood forest, and Willakenzie. Three nested AVAs.' },
  'dundee-hills':        { acres: '~6,490',  established: 1983, highlights: 'Famous red Jory soil, premier Pinot Noir. Notable south/southwest exposures, 200–1,000 ft elevation.' },
  'eola-amity-hills':    { acres: '~42,000', established: 2006, highlights: 'Van Duzer wind corridor creates natural cooling. Intense Pinot Noir and Chardonnay.' },
  'laurelwood-district': { acres: '~8,400',  established: 2015, highlights: 'Nested in Chehalem Mountains. Unique Laurelwood soils — windblown Missoula Flood deposits over Columbia River Basalt.' },
  'lower-long-tom':      { acres: '~30,000', established: 2020, highlights: 'Southern Willamette Valley. Warmer climate, broader variety potential.' },
  'mcminnville':         { acres: '~40,000', established: 2005, highlights: 'Marine sediment soils. Pacific influence. Cool, fog-prone mornings.' },
  'mount-pisgah-polk-county': { acres: '~11,000', established: 2022, highlights: 'Newest AVA. Silty loam soils derived from airborne sediment. Moderate maritime influence.' },
  'ribbon-ridge':        { acres: '~1,075',  established: 2005, highlights: 'Smallest and oldest nested AVA in Chehalem Mountains. Calcareous marine soils — rare in Oregon.' },
  'tualatin-hills':      { acres: '~55,000', established: 2020, highlights: 'Northern Willamette Valley. Volcanic and alluvial soils. Protected from marine influence by the Coast Range.' },
  'van-duzer-corridor':  { acres: '~60,000', established: 2019, highlights: 'A Pacific Ocean wind corridor that channels afternoon cooling into the Willamette Valley.' },
  'yamhill-carlton':     { acres: '~60,000', established: 2005, highlights: 'Ancient marine sediment soils. Warm days, cool nights. Exceptional Pinot Noir structure.' },
};

function AvaDetailView({ ava, onBack, listings, insideIds, vineyardRecidSet, onListingClick, onListingHover }) {
  const meta = AVA_META[ava.slug] || {};
  const inside = insideIds
    ? listings.filter(l => l.category === 'winery' && insideIds.includes(l.id))
    : listings.filter(l => l.category === 'winery');
  const withPolygons = inside.filter(l => vineyardRecidSet.has(l.id));

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {onBack && <BackBtn onClick={onBack} />}

      {/* Hero */}
      <div style={{ background: BRAND.brown, padding: '18px 16px 14px' }}>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'Georgia, serif', color: BRAND.eggshell, lineHeight: 1.2 }}>
          {ava.name}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(250,247,242,0.55)', marginTop: 4 }}>
          American Viticultural Area
          {ava.parentAva && <span> · Nested in {WV_SUB_AVAS.find(a => a.slug === ava.parentAva)?.name}</span>}
        </div>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {meta.established && (
            <div style={{ background: BRAND.cream, borderRadius: 8, padding: '10px 12px' }}>
              <div style={T.sectionLabel}>Established</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: BRAND.brown, marginTop: 3 }}>{meta.established}</div>
            </div>
          )}
          {meta.acres && (
            <div style={{ background: BRAND.cream, borderRadius: 8, padding: '10px 12px' }}>
              <div style={T.sectionLabel}>Approx. Acres</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: BRAND.brown, marginTop: 3 }}>{meta.acres}</div>
            </div>
          )}
          <div style={{ background: BRAND.cream, borderRadius: 8, padding: '10px 12px' }}>
            <div style={T.sectionLabel}>Wineries</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: BRAND.brown, marginTop: 3 }}>{inside.length}</div>
          </div>
          <div style={{ background: BRAND.cream, borderRadius: 8, padding: '10px 12px' }}>
            <div style={T.sectionLabel}>Mapped Vineyards</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: BRAND.brown, marginTop: 3 }}>{withPolygons.length}</div>
          </div>
        </div>

        {/* Highlights */}
        {meta.highlights && (
          <div>
            <div style={{ ...T.sectionLabel, marginBottom: 6 }}>About</div>
            <p style={{ fontSize: 13, color: BRAND.text, lineHeight: 1.65, margin: 0 }}>{meta.highlights}</p>
          </div>
        )}

        {/* Winery list inside AVA */}
        {inside.length > 0 && (
          <div>
            <div style={{ ...T.sectionLabel, marginBottom: 8 }}>Wineries in this AVA</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {inside.map(l => (
                <button
                  key={l.id}
                  onClick={() => onListingClick(l)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 8,
                    background: 'none', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
                    fontFamily: 'Inter, sans-serif',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = BRAND.cream; onListingHover?.(l); }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; onListingHover?.(null); }}
                >
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: vineyardRecidSet.has(l.id) ? '#3FAF79' : BRAND.textMuted,
                  }} />
                  <span style={{ fontSize: 13, color: BRAND.text, flex: 1 }}>{l.title}</span>
                  <span style={{ fontSize: 10, color: BRAND.textMuted }}>›</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Winery detail view ────────────────────────────────────────────────────
// Map AVA slug → display name for section headers
const AVA_DISPLAY_NAMES = {
  'chehalem-mountains':       'Chehalem Mountains',
  'dundee-hills':             'Dundee Hills',
  'eola-amity-hills':         'Eola-Amity Hills',
  'laurelwood-district':      'Laurelwood District',
  'lower-long-tom':           'Lower Long Tom',
  'mcminnville':              'McMinnville',
  'mount-pisgah-polk-county': 'Mt. Pisgah–Polk County',
  'ribbon-ridge':             'Ribbon Ridge',
  'tualatin-hills':           'Tualatin Hills',
  'van-duzer-corridor':       'Van Duzer Corridor',
  'yamhill-carlton':          'Yamhill-Carlton',
};

// Sort key for AVAs (roughly south→north for geographic flow)
const AVA_SORT_ORDER = [
  'lower-long-tom','mount-pisgah-polk-county','van-duzer-corridor','eola-amity-hills',
  'mcminnville','yamhill-carlton','dundee-hills','ribbon-ridge','chehalem-mountains',
  'laurelwood-district','tualatin-hills',
];

function primaryAva(avas) {
  if (!avas || avas.size === 0) return null;
  const arr = Array.from(avas);
  const sorted = arr.slice().sort((a, b) => {
    const ia = AVA_SORT_ORDER.indexOf(a.toLowerCase().replace(/\s+/g, '-'));
    const ib = AVA_SORT_ORDER.indexOf(b.toLowerCase().replace(/\s+/g, '-'));
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  return sorted[0];
}

function avaDisplayLabel(ava) {
  if (!ava) return null;
  const slug = ava.toLowerCase().replace(/\s+/g, '-');
  return AVA_DISPLAY_NAMES[slug] || ava;
}

function degToCardinal(deg) {
  if (deg == null) return null;
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function WineryDetailView({ listing, selectedVineyards, parcelTopoStats, onBack, onVineyardHover, onViewAllVineyards }) {
  const [expandedGroupKey, setExpandedGroupKey] = useState(null);
  const [hoveredGroup, setHoveredGroup] = useState(null);

  // Group vineyard features by name
  const vineyardGroups = Object.values(
    (selectedVineyards || []).reduce((acc, feature, index) => {
      const p = feature.properties || {};
      const rawName = (p.vineyard_name || p.Vineyard_Name || p.A1_VineyardName || '').trim();
      const key = rawName ? `name:${rawName.toLowerCase()}` : `block:${index}`;
      if (!acc[key]) {
        acc[key] = { key, name: rawName || `Vineyard Block ${index + 1}`, features: [], acresTotal: 0, acresCount: 0, avas: new Set() };
      }
      const g = acc[key];
      g.features.push(feature);
      const acresRaw = p.acres ?? p.Acres ?? p.VA0_TotalVineAcres;
      const acresVal = Number(acresRaw);
      if (Number.isFinite(acresVal) && acresVal > 0) { g.acresTotal += acresVal; g.acresCount += 1; }
      const ava = p.nested_nested_ava || p.nested_ava || p.Nested_Nested_AVA || p.Nested_AVA || p.C3_NestNestAVA || p.C2_NestAVA || p.C1_AVA || null;
      if (ava) g.avas.add(ava);
      return acc;
    }, {})
  ).sort((a, b) => {
    // Sort by primary AVA first, then alphabetically within AVA
    const aSlug = (primaryAva(a.avas) || '').toLowerCase().replace(/\s+/g, '-');
    const bSlug = (primaryAva(b.avas) || '').toLowerCase().replace(/\s+/g, '-');
    const ai = AVA_SORT_ORDER.indexOf(aSlug), bi = AVA_SORT_ORDER.indexOf(bSlug);
    const avaOrder = (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return avaOrder !== 0 ? avaOrder : a.name.localeCompare(b.name);
  });

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {onBack && <BackBtn onClick={onBack} />}

      {/* Hero image */}
      {listing.image_url && (
        <div style={{ height: 120, overflow: 'hidden', flexShrink: 0 }}>
          <img src={listing.image_url} alt={listing.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={e => { e.currentTarget.parentElement.style.display = 'none'; }}
          />
        </div>
      )}

      {/* Header */}
      <div style={{ background: BRAND.brown, padding: '16px 16px 12px' }}>
        <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'Georgia, serif', color: BRAND.eggshell, lineHeight: 1.25 }}>
          {listing.title}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(250,247,242,0.55)', marginTop: 5 }}>
          Winery &amp; Vineyard
        </div>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {listing.desc && (
          <p style={{ fontSize: 13, color: BRAND.textMuted, lineHeight: 1.65, margin: 0 }}>
            {listing.desc.slice(0, 280)}{listing.desc.length > 280 ? '…' : ''}
          </p>
        )}

        {/* Contact / links */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {listing.phone && (
            <a href={`tel:${listing.phone}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: BRAND.brown, textDecoration: 'none' }}>
              <span>📞</span> {listing.phone}
            </a>
          )}
          {listing.url && (
            <a href={listing.url} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', padding: '9px 14px', background: BRAND.burgundy, color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none', textAlign: 'center' }}>
              Visit Website ↗
            </a>
          )}
        </div>

        {/* Vineyards */}
        {vineyardGroups.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={T.sectionLabel}>🍇 Estate Vineyard{vineyardGroups.length !== 1 ? 's' : ''}</span>
              {vineyardGroups.length > 1 && (
                <button
                  onClick={() => onViewAllVineyards?.(selectedVineyards)}
                  style={{
                    background: 'rgba(63,175,121,0.1)', border: '1px solid rgba(63,175,121,0.35)',
                    borderRadius: 6, color: '#2B8A58', fontSize: 11, fontWeight: 700,
                    padding: '3px 8px', cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                  }}
                >
                  ⌖ View All
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {(() => {
                const rendered = [];
                let lastAvaLabel = null;

                vineyardGroups.forEach((group, i) => {
                  // Build block data
                  const blockMap = new Map();
                  for (const f of group.features) {
                    for (const b of (Array.isArray(f.properties?.blocks) ? f.properties.blocks : [])) {
                      const name = (b.Block || '').trim();
                      if (!name) continue;
                      if (!blockMap.has(name)) blockMap.set(name, { name, varieties: new Set(), clones: new Set(), acres: [] });
                      const row = blockMap.get(name);
                      if (b.Variety) row.varieties.add(String(b.Variety).trim());
                      if (b.Clone) row.clones.add(String(b.Clone).trim());
                      const ac = Number(b.Acres);
                      if (Number.isFinite(ac) && ac > 0) row.acres.push(ac);
                    }
                  }
                  const blockRows = Array.from(blockMap.values()).sort((a, b) => a.name.localeCompare(b.name));

                  const acres = group.acresCount > 0 ? group.acresTotal.toFixed(1) : null;
                  const pAva = primaryAva(group.avas);
                  const avaLabel = pAva ? avaDisplayLabel(pAva) : (group.avas.size > 1 ? 'Multiple AVAs' : null);
                  const isExpanded = expandedGroupKey === group.key;
                  const isHovered = hoveredGroup === i;

                  // Compute topo stats
                  const groupTopoStats = (() => {
                    const rows = group.features.map(f => parcelTopoStats?.[f.properties?.id]).filter(Boolean);
                    if (!rows.length) return null;
                    const vals = k => rows.map(r => r[k]).filter(x => x != null);
                    const avg = k => { const v = vals(k); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
                    const mn  = k => { const v = vals(k); return v.length ? Math.min(...v) : null; };
                    const mx  = k => { const v = vals(k); return v.length ? Math.max(...v) : null; };
                    const aspectDeg = avg('aspect_mean_deg');
                    return {
                      elev_min:    mn('elevation_min_ft'),
                      elev_max:    mx('elevation_max_ft'),
                      slope_mean:  avg('slope_mean_deg'),
                      aspect_card: degToCardinal(aspectDeg),
                    };
                  })();

                  // AVA section divider
                  if (avaLabel !== lastAvaLabel) {
                    lastAvaLabel = avaLabel;
                    rendered.push(
                      <div key={`ava-divider-${avaLabel || i}`} style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                        textTransform: 'uppercase', color: BRAND.textMuted,
                        padding: i === 0 ? '0 2px 6px' : '12px 2px 6px',
                        borderTop: i === 0 ? 'none' : `1px solid ${BRAND.border}`,
                        marginTop: i === 0 ? 0 : 6,
                      }}>
                        {avaLabel || 'Unmapped AVA'}
                      </div>
                    );
                  }

                  rendered.push(
                    <div
                      key={group.key}
                      style={{
                        border: `1px solid ${isHovered ? 'rgba(63,175,121,0.45)' : BRAND.border}`,
                        borderRadius: 10, background: isHovered ? 'rgba(63,175,121,0.06)' : BRAND.cream,
                        transition: 'border-color 0.15s, background 0.15s', cursor: 'pointer',
                        overflow: 'hidden', marginBottom: 6,
                      }}
                      onMouseEnter={() => { setHoveredGroup(i); onVineyardHover?.(group.features); }}
                      onMouseLeave={() => { setHoveredGroup(null); onVineyardHover?.(null); }}
                      onClick={() => { setExpandedGroupKey(isExpanded ? null : group.key); onViewAllVineyards?.(group.features); }}
                    >
                      {/* Collapsed header */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px 8px' }}>
                        <div style={{ flex: 1, paddingRight: 8, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: isHovered ? '#2B8A58' : BRAND.brown, transition: 'color 0.15s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {group.name}
                          </div>
                          {acres && (
                            <div style={{ fontSize: 11, color: BRAND.textMuted, marginTop: 2 }}>
                              {acres} ac
                              {blockRows.length > 0 && ` · ${blockRows.length} block${blockRows.length !== 1 ? 's' : ''}`}
                            </div>
                          )}
                        </div>
                        <span style={{ fontSize: 11, color: BRAND.textMuted, flexShrink: 0 }}>{isExpanded ? '▾' : '▸'}</span>
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div style={{ padding: '0 12px 12px', borderTop: `1px solid ${BRAND.border}` }}>
                          {/* Stats grid */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', paddingTop: 10 }}>
                            {acres && (
                              <div>
                                <div style={T.sectionLabel}>Acres</div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.text }}>{acres} ac</div>
                              </div>
                            )}
                            <div>
                              <div style={T.sectionLabel}>Blocks</div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.text }}>{blockRows.length || group.features.length}</div>
                            </div>
                            {groupTopoStats?.elev_min != null && groupTopoStats?.elev_max != null && (
                              <div>
                                <div style={T.sectionLabel}>Elev. Range</div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.text }}>
                                  {Math.round(groupTopoStats.elev_min)}–{Math.round(groupTopoStats.elev_max)} ft
                                </div>
                              </div>
                            )}
                            {groupTopoStats?.slope_mean != null && (
                              <div>
                                <div style={T.sectionLabel}>Avg. Slope</div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.text }}>{groupTopoStats.slope_mean.toFixed(1)}°</div>
                              </div>
                            )}
                            {groupTopoStats?.aspect_card && (
                              <div>
                                <div style={T.sectionLabel}>Avg. Aspect</div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.text }}>{groupTopoStats.aspect_card}</div>
                              </div>
                            )}
                          </div>

                          {/* Block list */}
                          {blockRows.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10 }}>
                              {blockRows.map((b, bi) => (
                                <div key={`${b.name}-${bi}`} style={{ border: `1px solid ${BRAND.border}`, borderRadius: 7, padding: '7px 10px', background: BRAND.eggshell }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: BRAND.brown }}>{b.name}</div>
                                  <div style={{ fontSize: 11, color: BRAND.textMuted, marginTop: 2 }}>
                                    {[
                                      b.varieties.size > 0 ? Array.from(b.varieties).slice(0, 2).join(', ') : null,
                                      b.clones.size > 0 ? `Clone ${Array.from(b.clones).slice(0, 2).join('/')}` : null,
                                      b.acres.length > 0 ? `${Math.max(...b.acres).toFixed(2)} ac` : null,
                                    ].filter(Boolean).join(' · ') || '—'}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                });

                return rendered;
              })()}
            </div>
          </div>
        )}

        {(!selectedVineyards || selectedVineyards.length === 0) && (
          <div style={{ textAlign: 'center', padding: '16px 0', color: BRAND.textMuted, fontSize: 13 }}>
            No mapped vineyard parcels
          </div>
        )}
      </div>
    </div>
  );
}

// ── Data layers section ───────────────────────────────────────────────────
const CLIMATE_LAYERS = [
  { id: 'tdmean', label: 'Mean Temperature', sub: '30-yr PRISM normals' },
];
const TOPO_LAYERS = [
  { id: 'elevation', label: 'Elevation',   sub: 'Height above sea level' },
  { id: 'slope',     label: 'Slope',       sub: 'Steepness in degrees' },
  { id: 'aspect',    label: 'Aspect',      sub: 'Direction slope faces' },
];

function LayerSection({ activeLayer, onLayerChange, currentMonth, onMonthChange, topoStats }) {
  const [climateOpen, setClimateOpen] = useState(true);
  const [topoOpen, setTopoOpen] = useState(true);

  const fmt = v => typeof v === 'number' ? v.toFixed(1) : '—';
  const topoConfig = activeLayer ? TOPO_LAYER_TYPES[activeLayer] : null;

  return (
    <div style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Climate */}
      <div style={{ borderBottom: `1px solid ${BRAND.border}` }}>
        <button
          onClick={() => setClimateOpen(p => !p)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
        >
          <span style={T.sectionLabel}>Climate</span>
          <Chevron open={climateOpen} />
        </button>

        {climateOpen && (
          <div style={{ padding: '0 12px 10px' }}>
            {CLIMATE_LAYERS.map(layer => {
              const active = activeLayer === layer.id;
              return (
                <div key={layer.id}>
                  <button
                    onClick={() => onLayerChange(active ? null : layer.id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', padding: '8px 10px', borderRadius: 8, textAlign: 'left',
                      border: `1.5px solid ${active ? BRAND.burgundy + '80' : BRAND.border}`,
                      background: active ? 'rgba(142,21,55,0.07)' : BRAND.eggshell,
                      cursor: 'pointer', fontFamily: 'Inter, sans-serif', marginBottom: active ? 6 : 0,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: active ? BRAND.burgundy : BRAND.brown }}>{layer.label}</div>
                      <div style={{ fontSize: 11, color: BRAND.textMuted, marginTop: 1 }}>{layer.sub}</div>
                    </div>
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', border: `2px solid ${active ? BRAND.burgundy : BRAND.border}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {active && <div style={{ width: 10, height: 10, borderRadius: '50%', background: BRAND.burgundy }} />}
                    </div>
                  </button>

                  {/* Month slider when climate is active */}
                  {active && (
                    <div style={{ padding: '8px 10px 4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={T.sectionLabel}>Month</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: BRAND.brown }}>{MONTH_ABBR[currentMonth - 1]}</span>
                      </div>
                      <input
                        type="range" min="1" max="12" value={currentMonth}
                        onChange={e => onMonthChange(Number(e.target.value))}
                        style={{ width: '100%', accentColor: BRAND.burgundy, cursor: 'pointer' }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: BRAND.textMuted, marginTop: 2 }}>
                        <span>Jan</span><span>Jun</span><span>Dec</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Topography */}
      <div style={{ borderBottom: `1px solid ${BRAND.border}` }}>
        <button
          onClick={() => setTopoOpen(p => !p)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
        >
          <span style={T.sectionLabel}>Topography</span>
          <Chevron open={topoOpen} />
        </button>

        {topoOpen && (
          <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {TOPO_LAYERS.map(layer => {
              const active = activeLayer === layer.id;
              return (
                <button
                  key={layer.id}
                  onClick={() => onLayerChange(active ? null : layer.id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '8px 10px', borderRadius: 8, textAlign: 'left',
                    border: `1.5px solid ${active ? BRAND.burgundy + '80' : BRAND.border}`,
                    background: active ? 'rgba(142,21,55,0.07)' : BRAND.eggshell,
                    cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: active ? BRAND.burgundy : BRAND.brown }}>{layer.label}</div>
                    <div style={{ fontSize: 11, color: BRAND.textMuted, marginTop: 1 }}>{layer.sub}</div>
                  </div>
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%', border: `2px solid ${active ? BRAND.burgundy : BRAND.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    {active && <div style={{ width: 10, height: 10, borderRadius: '50%', background: BRAND.burgundy }} />}
                  </div>
                </button>
              );
            })}

            {/* Legend / scale for active topo layer */}
            {topoConfig && activeLayer && (
              <div style={{ border: `1px solid ${BRAND.border}`, borderRadius: 8, padding: '10px 12px', background: BRAND.cream, marginTop: 4 }}>
                <div style={{ ...T.sectionLabel, marginBottom: 8 }}>Scale — {topoConfig.label}</div>
                <div style={{ height: 8, borderRadius: 6, background: COLORMAP_CSS[topoConfig.colormap] || '#ccc', marginBottom: 4, border: `1px solid ${BRAND.border}` }} />
                {topoStats && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: BRAND.textMuted, marginBottom: 8 }}>
                      <span>{topoStats.min?.toFixed(1)}{topoConfig.unit}</span>
                      <span>{topoStats.max?.toFixed(1)}{topoConfig.unit}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <div><div style={T.sectionLabel}>Min</div><div style={{ fontSize: 12, fontWeight: 600, color: BRAND.text }}>{fmt(topoStats.min)}{topoConfig.unit}</div></div>
                      <div><div style={T.sectionLabel}>Max</div><div style={{ fontSize: 12, fontWeight: 600, color: BRAND.text }}>{fmt(topoStats.max)}{topoConfig.unit}</div></div>
                      <div><div style={T.sectionLabel}>Mean</div><div style={{ fontSize: 12, fontWeight: 600, color: BRAND.text }}>{fmt(topoStats.mean)}{topoConfig.unit}</div></div>
                      <div><div style={T.sectionLabel}>Std Dev</div><div style={{ fontSize: 12, fontWeight: 600, color: BRAND.text }}>±{fmt(topoStats.std)}{topoConfig.unit}</div></div>
                    </div>
                  </>
                )}
                {!topoStats && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${BRAND.border}`, borderTopColor: BRAND.brown, animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: BRAND.textMuted }}>Loading statistics…</span>
                    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  </div>
                )}
              </div>
            )}
            {activeLayer === 'tdmean' && (
              <div style={{ border: `1px solid ${BRAND.border}`, borderRadius: 8, padding: '10px 12px', background: BRAND.cream, marginTop: 4 }}>
                <div style={{ ...T.sectionLabel, marginBottom: 8 }}>Scale — Mean Temperature</div>
                <div style={{ height: 8, borderRadius: 6, background: COLORMAP_CSS.plasma, marginBottom: 4, border: `1px solid ${BRAND.border}` }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: BRAND.textMuted }}>
                  <span>−22°C</span><span>26°C</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Wineries section ──────────────────────────────────────────────────────
function WineriesSection({ listings, listingFilterMode, onListingFilterModeChange, vineyardRecidSet, insideIds, selectedAva, onListingClick, onListingHover }) {
  const ava = selectedAva ? WV_SUB_AVAS.find(a => a.slug === selectedAva) : null;

  const visible = listings.filter(l => {
    if (l.category !== 'winery') return false;
    if (listingFilterMode === LISTING_FILTER_MODES.withVineyardPolygons && !vineyardRecidSet.has(l.id)) return false;
    if (listingFilterMode === LISTING_FILTER_MODES.withoutVineyardPolygons && vineyardRecidSet.has(l.id)) return false;
    if (listingFilterMode === LISTING_FILTER_MODES.noWineriesVisualized) return false;
    if (insideIds && !insideIds.includes(l.id)) return false;
    return true;
  });

  const pills = [
    { id: LISTING_FILTER_MODES.allWineries, label: 'All' },
    { id: LISTING_FILTER_MODES.withVineyardPolygons, label: 'Mapped' },
    { id: LISTING_FILTER_MODES.withoutVineyardPolygons, label: 'Unmapped' },
  ];

  return (
    <div>
      {/* Filter pills */}
      <div style={{ padding: '10px 16px 8px', display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: `1px solid ${BRAND.border}` }}>
        {pills.map(p => {
          const isActive = listingFilterMode === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onListingFilterModeChange(p.id)}
              style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                border: `1px solid ${isActive ? BRAND.burgundy + '90' : BRAND.border}`,
                background: isActive ? 'rgba(142,21,55,0.1)' : BRAND.eggshell,
                color: isActive ? BRAND.burgundy : BRAND.textMuted,
                cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                transition: 'all 0.15s',
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {ava && (
        <div style={{ padding: '6px 16px', background: 'rgba(142,21,55,0.05)', borderBottom: `1px solid ${BRAND.border}` }}>
          <span style={{ fontSize: 11, color: BRAND.burgundy }}>Showing {ava.name} only — {visible.length} winer{visible.length === 1 ? 'y' : 'ies'}</span>
        </div>
      )}

      {/* Winery list */}
      <div style={{ overflowY: 'auto', maxHeight: 340 }}>
        {visible.length === 0 && (
          <div style={{ padding: '20px 16px', textAlign: 'center', color: BRAND.textMuted, fontSize: 13 }}>
            {listings.length === 0 ? 'Loading…' : 'No wineries match this filter.'}
          </div>
        )}
        {visible.map((l) => (
          <button
            key={l.id}
            onClick={() => onListingClick(l)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', padding: '9px 16px', background: 'none',
              border: 'none', borderBottom: `1px solid ${BRAND.border}`, cursor: 'pointer',
              fontFamily: 'Inter, sans-serif', textAlign: 'left',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = BRAND.cream; onListingHover?.(l); }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; onListingHover?.(null); }}
          >
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: vineyardRecidSet.has(l.id) ? '#3FAF79' : BRAND.textMuted,
            }} />
            <span style={{ fontSize: 13, color: BRAND.text, flex: 1, lineHeight: 1.3 }}>{l.title}</span>
            <span style={{ fontSize: 10, color: BRAND.textMuted }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── About section ─────────────────────────────────────────────────────────
function AboutSection() {
  return (
    <div style={{ padding: '14px 16px', fontSize: 13, color: BRAND.textMuted, lineHeight: 1.75 }}>
      <p style={{ margin: '0 0 12px' }}>
        <strong style={{ color: BRAND.brown }}>Willamette Valley Wine Country</strong> encompasses over 500 wineries and 26,000+ acres of vineyard across eleven American Viticultural Areas in Oregon's Northern Willamette Valley.
      </p>
      <p style={{ margin: '0 0 12px' }}>
        This explorer provides detailed vineyard mapping, topographic analysis, and climate data for each nested AVA.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#3FAF79', flexShrink: 0 }} />
          <span style={{ fontSize: 12 }}>Mapped vineyard parcels</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#C7D6E8', flexShrink: 0 }} />
          <span style={{ fontSize: 12 }}>Reference parcels (no winery link)</span>
        </div>
      </div>
      <p style={{ margin: '14px 0 0', fontSize: 11, color: BRAND.textMuted }}>
        Data: WVWA, PRISM Climate Group, USGS.<br />
        Boundary data: TTB (Tax &amp; Trade Bureau).
      </p>
    </div>
  );
}

// ── Main ExplorerSidebar ──────────────────────────────────────────────────
export default function ExplorerSidebar({
  mapRef,
  selectedAva,
  onSelectAva,
  listings,
  selectedListing,
  onListingSelect,
  insideIds,
  vineyardRecidSet,
  activeLayer,
  onLayerChange,
  currentMonth,
  onMonthChange,
  topoStats,
  listingFilterMode,
  onListingFilterModeChange,
  selectedVineyards,
  parcelTopoStats,
  onVineyardHover,
  onViewAllVineyards,
}) {
  const [sections, setSections] = useState({ layers: false, about: false });

  // Navigation stack: 'home' | 'ava-list' | 'winery-list' | 'ava-detail' | 'winery-detail'
  const [viewStack, setViewStack] = useState(['home']);
  const [detailAva, setDetailAva] = useState(null);
  const [detailWinery, setDetailWinery] = useState(null);
  // Tracks what to render in panel 2 (preserved during slide-out animations)
  const [panel2Type, setPanel2Type] = useState(null); // 'ava' | 'winery'
  // Skip-count refs: incremented before an internal setter call so the
  // corresponding external-sync effect knows to ignore that one bounce-back.
  const skipListingRef = useRef(0);
  const skipAvaRef    = useRef(0);

  const currentView = viewStack[viewStack.length - 1];

  // Column index for the 3-panel sliding track
  const VIEW_COL = { home: 0, 'ava-list': 1, 'winery-list': 1, 'ava-detail': 2, 'winery-detail': 2 };
  const col = VIEW_COL[currentView] ?? 0;

  // Panel 1 shows whichever list type is currently in the stack (last one wins)
  const panel1Type = [...viewStack].reverse().find(v => v === 'winery-list' || v === 'ava-list') === 'winery-list'
    ? 'winery' : 'ava';

  const toggleSection = useCallback((key) => {
    setSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleBack = useCallback(() => {
    if (viewStack.length <= 1) return;
    const leaving = viewStack[viewStack.length - 1];
    const destination = viewStack[viewStack.length - 2];

    // Increment skip count BEFORE calling the parent setter so the bounce-back
    // prop change is ignored by the external sync effects below.
    if (leaving === 'winery-detail') { skipListingRef.current++; onListingSelect?.(null); mapRef.current?.clearSelectedListing?.(); }
    if (leaving === 'ava-detail')    { skipAvaRef.current++;    onSelectAva(null); }
    if (leaving === 'ava-list')      { skipAvaRef.current++;    onSelectAva(null); }

    // Restore panel2 content to match where we're going back to
    if (destination === 'ava-detail') {
      setPanel2Type('ava');
      // Re-fly to the AVA — the prop hasn't changed so the map effect won't auto-fire
      if (detailAva) mapRef.current?.flyToAva?.(detailAva.slug);
    } else if (destination === 'winery-detail') setPanel2Type('winery');

    setViewStack(prev => prev.slice(0, -1));
  }, [viewStack, onListingSelect, onSelectAva, detailAva, mapRef]);

  // External selectedListing change (e.g. map click on winery dot).
  // Pushes winery-detail onto whatever the current stack is, preserving
  // the user's existing navigation context.
  useEffect(() => {
    if (skipListingRef.current > 0) { skipListingRef.current--; return; }
    if (selectedListing) {
      setDetailWinery(selectedListing);
      setPanel2Type('winery');
      setViewStack(prev => {
        const top = prev[prev.length - 1];
        if (top === 'winery-detail') return prev; // already showing, just update detail
        return [...prev, 'winery-detail'];
      });
    } else {
      // Deselected externally — pop winery-detail if it's on top
      setViewStack(prev =>
        prev[prev.length - 1] === 'winery-detail' ? prev.slice(0, -1) : prev
      );
    }
  }, [selectedListing]); // eslint-disable-line react-hooks/exhaustive-deps

  // External selectedAva change (e.g. map click on AVA boundary).
  useEffect(() => {
    if (skipAvaRef.current > 0) { skipAvaRef.current--; return; }
    if (selectedAva) {
      const ava = WV_SUB_AVAS.find(a => a.slug === selectedAva);
      if (ava) {
        setDetailAva(ava);
        setPanel2Type('ava');
        setViewStack(prev => {
          const top = prev[prev.length - 1];
          if (top === 'ava-detail') return prev;
          return [...prev, 'ava-detail'];
        });
      }
    } else {
      // Deselected externally — pop ava-detail or ava-list if on top
      setViewStack(prev => {
        const top = prev[prev.length - 1];
        if (top === 'ava-detail' || top === 'ava-list') return prev.slice(0, -1);
        return prev;
      });
    }
  }, [selectedAva]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAvaClick = useCallback((ava) => {
    setDetailAva(ava);
    setPanel2Type('ava');
    setViewStack(prev => [...prev, 'ava-detail']);
    skipAvaRef.current++;
    onSelectAva(ava.slug);
  }, [onSelectAva]);

  const handleListingClick = useCallback((listing) => {
    setDetailWinery(listing);
    setPanel2Type('winery');
    setViewStack(prev => [...prev, 'winery-detail']);
    // selectListingById already calls onListingSelectProp internally — don't double-fire
    skipListingRef.current++;
    mapRef.current?.selectListingById(listing.id);
  }, [mapRef]);

  const isOnHome = currentView === 'home';
  const viewTitle = currentView === 'ava-list' ? 'Nested AVAs'
    : currentView === 'winery-list' ? 'Wineries'
    : currentView === 'ava-detail' ? (detailAva?.name ?? '')
    : currentView === 'winery-detail' ? (detailWinery?.title ?? '')
    : '';

  return (
    <div style={{
      width: SIDEBAR_W,
      minWidth: SIDEBAR_W,
      height: '100%',
      background: T.sidebarBg,
      borderRight: `1px solid ${BRAND.border}`,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
      zIndex: 10,
    }}>

      {/* Sidebar header */}
      <div style={{ background: T.headerBg, padding: '16px 16px 14px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          {!isOnHome && (
            <button
              onClick={handleBack}
              style={{
                background: 'rgba(250,247,242,0.12)', border: '1px solid rgba(250,247,242,0.2)',
                borderRadius: 7, color: T.headerText, cursor: 'pointer',
                width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, flexShrink: 0,
              }}
            >
              ‹
            </button>
          )}
          <div>
            <div style={{ fontSize: isOnHome ? 15 : 14, fontWeight: 700, color: T.headerText, fontFamily: 'Georgia, serif', lineHeight: 1.2 }}>
              {isOnHome ? 'Willamette Valley' : viewTitle}
            </div>
            {isOnHome && (
              <div style={{ fontSize: 10, color: 'rgba(250,247,242,0.55)', marginTop: 2, letterSpacing: '0.04em' }}>
                Wineries &amp; AVA Explorer
              </div>
            )}
          </div>
        </div>
        <SearchBar inline mapRef={mapRef} onSelectAva={(slug) => {
          const ava = WV_SUB_AVAS.find(a => a.slug === slug);
          if (ava) handleAvaClick(ava);
          else onSelectAva(slug);
        }} />
      </div>

      {/* 3-panel sliding content area */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div style={{
          display: 'flex',
          width: '300%',
          height: '100%',
          transform: `translateX(${-(col * (100 / 3)).toFixed(4)}%)`,
          transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'transform',
        }}>

          {/* ── Panel 0: Home menu ── */}
          <div style={{ width: '33.333%', height: '100%', overflowY: 'auto', flexShrink: 0 }}>
            {/* Nested AVAs nav row */}
            <button
              onClick={() => setViewStack(prev => prev[prev.length - 1] === 'home' ? [...prev, 'ava-list'] : prev)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '12px 16px', background: 'none', border: 'none',
                borderBottom: `1px solid ${BRAND.border}`, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              }}
              onMouseEnter={e => e.currentTarget.style.background = T.hoverBg}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={T.sectionLabel}>Nested AVAs</span>
                <span style={{ fontSize: 10, background: BRAND.cream, borderRadius: 10, padding: '1px 7px', color: BRAND.textMuted, fontWeight: 600 }}>
                  {WV_SUB_AVAS.length}
                </span>
              </div>
              <span style={{ fontSize: 16, color: BRAND.textMuted }}>›</span>
            </button>

            {/* Wineries nav row */}
            <button
              onClick={() => setViewStack(prev => prev[prev.length - 1] === 'home' ? [...prev, 'winery-list'] : prev)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '12px 16px', background: 'none', border: 'none',
                borderBottom: `1px solid ${BRAND.border}`, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              }}
              onMouseEnter={e => e.currentTarget.style.background = T.hoverBg}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={T.sectionLabel}>Wineries</span>
                {listings.filter(l => l.category === 'winery').length > 0 && (
                  <span style={{ fontSize: 10, background: BRAND.cream, borderRadius: 10, padding: '1px 7px', color: BRAND.textMuted, fontWeight: 600 }}>
                    {listings.filter(l => l.category === 'winery').length}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 16, color: BRAND.textMuted }}>›</span>
            </button>

            {/* Data Layers accordion */}
            <div style={{ borderBottom: `1px solid ${BRAND.border}` }}>
              <SectionHeader label="Data Layers" open={sections.layers} onToggle={() => toggleSection('layers')} />
              {sections.layers && (
                <LayerSection
                  activeLayer={activeLayer}
                  onLayerChange={onLayerChange}
                  currentMonth={currentMonth}
                  onMonthChange={onMonthChange}
                  topoStats={topoStats}
                />
              )}
            </div>

            {/* About accordion */}
            <div>
              <SectionHeader label="About & Legend" open={sections.about} onToggle={() => toggleSection('about')} />
              {sections.about && <AboutSection />}
            </div>
          </div>

          {/* ── Panel 1: List view ── */}
          <div style={{ width: '33.333%', height: '100%', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            {panel1Type === 'winery' ? (
              <WineriesSection
                listings={listings}
                listingFilterMode={listingFilterMode}
                onListingFilterModeChange={onListingFilterModeChange}
                vineyardRecidSet={vineyardRecidSet}
                insideIds={insideIds}
                selectedAva={selectedAva}
                onListingClick={handleListingClick}
                onListingHover={(l) => mapRef.current?.hoverListing(l)}
              />
            ) : (
              <div style={{ padding: '4px 0 8px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '8px 16px 4px' }}>
                  <span style={T.sectionLabel}>Nested AVAs ({WV_SUB_AVAS.length})</span>
                </div>
                {WV_SUB_AVAS.map(ava => {
                  const isSelected = selectedAva === ava.slug;
                  return (
                    <button
                      key={ava.slug}
                      onClick={() => handleAvaClick(ava)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        width: '100%', padding: `8px 16px 8px ${ava.parentAva ? '28px' : '16px'}`,
                        background: isSelected ? T.activeBg : 'none', border: 'none',
                        cursor: 'pointer', fontFamily: 'Inter, sans-serif', textAlign: 'left',
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = T.hoverBg; mapRef.current?.hoverAva(ava.slug); }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'none'; mapRef.current?.hoverAva(null); }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {ava.parentAva && <span style={{ width: 8, fontSize: 9, color: BRAND.textMuted }}>└</span>}
                        <span style={{ fontSize: 13, color: isSelected ? BRAND.burgundy : BRAND.brown, fontWeight: isSelected ? 600 : 400 }}>
                          {ava.name}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: BRAND.textMuted }}>›</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Panel 2: Detail view ── */}
          <div style={{ width: '33.333%', height: '100%', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            {panel2Type === 'ava' && detailAva && (
              <AvaDetailView
                ava={detailAva}
                listings={listings}
                insideIds={insideIds}
                vineyardRecidSet={vineyardRecidSet}
                onListingClick={handleListingClick}
                onListingHover={(l) => mapRef.current?.hoverListing(l)}
              />
            )}
            {panel2Type === 'winery' && detailWinery && (
              <WineryDetailView
                listing={detailWinery}
                selectedVineyards={selectedVineyards}
                parcelTopoStats={parcelTopoStats}
                onVineyardHover={onVineyardHover}
                onViewAllVineyards={onViewAllVineyards}
              />
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
