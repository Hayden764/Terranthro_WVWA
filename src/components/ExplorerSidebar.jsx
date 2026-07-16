import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { alpha, border, crimson, electricBlue, ink, muted, parchment, TOKENS, TYPE } from '../styles/tokens';
import { WV_SUB_AVAS, TOPO_LAYER_TYPES } from '../config/topographyConfig';
import SearchBar from './SearchBar';
import { LISTING_FILTER_MODES } from './WVWAMap';
import { MONTH_ABBR } from '../config/climateConfig';
import TerroirDataChips from './TerroirDataChips';
import { apiJson } from '../lib/api';

// ── Design tokens (light‑mode, eggshell base) ────────────────────────────
const T = {
  sidebarBg:     parchment,
  headerBg:      ink,
  headerText:    parchment,
  border:        border,
  sectionLabel:  { ...TYPE.uiLabel, color: muted },
  itemText:      { fontSize: 'var(--type-mono-size)', color: ink, lineHeight: 1.45 },
  itemTextMuted: { fontSize: 'var(--type-body-size)', color: muted, lineHeight: 1.4 },
  accent:        crimson,
  hoverBg:       parchment,
  activeBg:      TOKENS.dangerDim,
  // Shared hover color for card name text (vineyard groups, AVA cards, winery cards)
  cardNameHover: TOKENS.electricBlue,
};

const UI = {
  mapped: TOKENS.vividGreen,
  refParcel: TOKENS.violet,
  parchment55: alpha(TOKENS.parchment, 0.55),
  parchment52: alpha(TOKENS.parchment, 0.52),
  parchment68: alpha(TOKENS.parchment, 0.68),
  parchment12: alpha(TOKENS.parchment, 0.12),
  parchment10: alpha(TOKENS.parchment, 0.1),
  danger20: alpha(TOKENS.danger, 0.2),
  danger13: alpha(TOKENS.danger, 0.13),
  danger08: alpha(TOKENS.danger, 0.08),
  danger15: alpha(TOKENS.danger, 0.15),
  danger75: alpha(TOKENS.danger, 0.75),
  electric08: alpha(TOKENS.electricBlue, 0.08),
  electric15: alpha(TOKENS.electricBlue, 0.15),
  electric75: alpha(TOKENS.electricBlue, 0.75),
  viewAllBtnBg: alpha(TOKENS.success, 0.1),
  viewAllBtnBorder: alpha(TOKENS.success, 0.35),
  vineyardGroupHoverBorder: alpha(TOKENS.success, 0.45),
  vineyardGroupHoverBg: alpha(TOKENS.success, 0.06),
  mobileShadow: alpha('black', 0.22),
  backBtnBg: alpha(TOKENS.parchment, 0.12),
  backBtnBorder: alpha(TOKENS.parchment, 0.2),
  decorativeCircle: alpha(TOKENS.parchment, 0.05),
  mappedChipBg: alpha(TOKENS.success, 0.14),
  mappedChipBorder: alpha(TOKENS.success, 0.3),
  buttonBg1: alpha(TOKENS.ink, 0.08),
  buttonBg2: alpha(TOKENS.ink, 0.06),
};

const SIDEBAR_W = '25vw';
const SIDEBAR_MIN_W = 260;
const SIDEBAR_MAX_W = 420;

// ── Colormap gradients (matching WVWAMap / ScalePanel) ───────────────────
// audit-ignore-start centralized-colormap-gradients
const COLORMAP_CSS = {
  terrain:  'linear-gradient(to right, #0B6623, #90EE90, #F5F5DC, #D2B48C, #8B4513, #FFFFFF)',
  rdylgn_r: 'linear-gradient(to right, #1A9850, #91CF60, #D9EF8B, #FEE08B, #FC8D59, #D73027)',
  hsv:      'linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)',
  plasma:   'linear-gradient(to right, #0D0887, #7E03A8, #CC4778, #F89441, #F0F921)',
};
// audit-ignore-end centralized-colormap-gradients

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
      color: muted, fontSize: 'var(--type-body-size)', padding: '8px 16px',
      fontFamily: 'var(--font-sans)', width: '100%', textAlign: 'left',
      borderBottom: `1px solid ${border}`,
    }}
    onMouseEnter={e => e.currentTarget.style.color = ink}
    onMouseLeave={e => e.currentTarget.style.color = muted}
  >
    <span style={{ fontSize: 'var(--type-body-size)', lineHeight: 1 }}>‹</span> Back
  </button>
);

function SectionHeader({ label, open, onToggle, count }) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', padding: '10px 16px',
        background: 'none', border: 'none', borderBottom: `1px solid ${border}`,
        cursor: 'pointer', fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={T.sectionLabel}>{label}</span>
        {count != null && (
          <span style={{ fontSize: 'var(--type-ui-label-size)', background: parchment, borderRadius: 10, padding: '1px 7px', color: muted, fontWeight: 600 }}>
            {count}
          </span>
        )}
      </div>
      <Chevron open={open} />
    </button>
  );
}

// ── AVA detail view ───────────────────────────────────────────────────────
// `acres` = official TTB AVA size (total land area). "Mapped Vineyard Acres" —
// the sum of digitized block polygons inside each AVA — is NOT stored here; it's
// fetched live from GET /api/avas/acres so it stays current as blocks are edited.
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

// Formatters for the live mapped-acres figures from GET /api/avas/acres.
const fmtAcres = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : null);          // 2887.07 → "2,887"
const fmtAcresApprox = (n) => (Number.isFinite(n) ? `${(Math.floor(n / 100) * 100).toLocaleString()}+` : null); // 16622 → "16,600+"
const fmtAcresCompact = (n) => (Number.isFinite(n) ? `${(n / 1000).toFixed(1)}k+` : null);      // 16622 → "16.6k+"

function AvaDetailView({ ava, onBack, listings, insideIds, vineyardRecidSet, mappedAcres, onListingClick, onListingHover }) {
  const meta = AVA_META[ava.slug] || {};
  const inside = insideIds
    ? listings.filter(l => l.category === 'winery' && insideIds.includes(l.id))
    : listings.filter(l => l.category === 'winery');
  const withPolygons = inside.filter(l => vineyardRecidSet.has(l.id));

  const [climateStats, setClimateStats] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setClimateStats(null);
    apiJson(`/api/climate/${ava.slug}/stats`)
      .then(data => { if (!cancelled) setClimateStats(data.stats || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [ava.slug]);

  const tdmean = climateStats?.tdmean;
  const climateChips = tdmean ? [
    { label: 'GS Temp Mean', value: `${tdmean.mean.toFixed(1)}${tdmean.unit}`, tone: 'amber', glow: true },
    { label: 'GS Temp Max',  value: `${tdmean.max.toFixed(1)}${tdmean.unit}`,  tone: 'green', glow: true },
    { label: 'GS Temp Min',  value: `${tdmean.min.toFixed(1)}${tdmean.unit}`,  tone: 'blue',  glow: true },
    { label: 'Std Dev',      value: `±${tdmean.std_dev.toFixed(1)}${tdmean.unit}`, tone: 'parchment', glow: false },
  ] : null;

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {onBack && <BackBtn onClick={onBack} />}

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        <div>
          <div style={{ ...T.sectionLabel, marginBottom: 8 }}>AVA Snapshot</div>
          <TerroirDataChips chips={[
            { label: 'Established', value: meta.established ? String(meta.established) : '—', tone: 'amber', glow: false },
            { label: 'Acres', value: meta.acres || '—', tone: 'parchment', glow: false },
            { label: 'Mapped Vineyard Acres', value: fmtAcres(mappedAcres) || '—', tone: 'parchment', glow: false },
            { label: 'Members', value: String(inside.length), tone: 'green', glow: true },
            { label: 'Mapped', value: String(withPolygons.length), tone: 'blue', glow: true },
          ]} />
        </div>

        {/* Highlights */}
        {meta.highlights && (
          <div>
            <div style={{ ...T.sectionLabel, marginBottom: 6 }}>About</div>
            <p style={{ fontSize: 'var(--type-mono-size)', color: ink, lineHeight: 1.65, margin: 0 }}>{meta.highlights}</p>
          </div>
        )}

        {/* Live climate data */}
        {climateChips && (
          <div>
            <div style={{ ...T.sectionLabel, marginBottom: 8 }}>Growing Season Climate</div>
            <TerroirDataChips chips={climateChips} />
          </div>
        )}

        {/* Winery list inside AVA */}
        {inside.length > 0 && (
          <div>
            <div style={{ ...T.sectionLabel, marginBottom: 8 }}>Wineries in this AVA</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {inside.map(l => {
                const vineyardCount = vineyardRecidSet.get(l.id) ?? 0;
                const vineyardLabel = vineyardCount === 0 ? 'No vineyard map'
                  : vineyardCount === 1 ? 'Vineyard mapped'
                  : `${vineyardCount} vineyards mapped`;
                return (
                  <div
                    key={l.id}
                    onClick={() => onListingClick(l)}
                    style={{
                      border: `1px solid ${border}`,
                      borderRadius: 10, background: parchment,
                      cursor: 'pointer', overflow: 'hidden',
                      transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = T.cardNameHover + '55'; const n = e.currentTarget.querySelector('.winery-card-name'); if (n) n.style.color = T.cardNameHover; onListingHover?.(l); }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = border; const n = e.currentTarget.querySelector('.winery-card-name'); if (n) n.style.color = ink; onListingHover?.(null); }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px 8px' }}>
                      <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                        <div className="winery-card-name" style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: ink, transition: 'color 0.15s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {l.title}
                        </div>
                        <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 2 }}>
                          {vineyardLabel}
                        </div>
                      </div>
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: vineyardCount > 0 ? UI.mapped : muted,
                      }} />
                    </div>
                  </div>
                );
              })}
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

function WineryDetailView({ listing, selectedVineyards, parcelTopoStats, onBack, onVineyardHover, onViewAllVineyards, onParcelClick }) {
  const [expandedGroupKey, setExpandedGroupKey] = useState(null);
  const [hoveredGroup, setHoveredGroup] = useState(null);
  const [sourcedFrom, setSourcedFrom] = useState([]);

  // Fetch buyer relationships (blocks at other vineyards that this winery
  // sources fruit from) when the listing changes.
  useEffect(() => {
    let cancelled = false;
    setSourcedFrom([]);
    if (!listing?.id) return;
    fetch(`/api/public/wineries/${listing.id}/sourced-from`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (!cancelled && Array.isArray(data)) setSourcedFrom(data); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [listing?.id]);

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

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {listing.desc && (
          <p style={{ fontSize: 'var(--type-mono-size)', color: muted, lineHeight: 1.65, margin: 0 }}>
            {listing.desc.slice(0, 280)}{listing.desc.length > 280 ? '…' : ''}
          </p>
        )}

        {/* Contact / links */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {listing.phone && (
            <a href={`tel:${listing.phone}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--type-mono-size)', color: ink, textDecoration: 'none' }}>
              <span>📞</span> {listing.phone}
            </a>
          )}
          {listing.url && (
            <a href={listing.url} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', padding: '9px 14px', background: crimson, color: parchment, borderRadius: 8, fontSize: 'var(--type-mono-size)', fontWeight: 600, textDecoration: 'none', textAlign: 'center' }}>
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
                    background: UI.viewAllBtnBg, border: `1px solid ${UI.viewAllBtnBorder}`,
                    borderRadius: 6, color: UI.mapped, fontSize: 'var(--type-ui-label-size)', fontWeight: 700,
                    padding: '3px 8px', cursor: 'pointer', fontFamily: 'var(--font-sans)',
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
                    const aspectMeanDeg = avg('aspect_mean_deg');
                    const aspectDomDeg  = avg('aspect_dominant_deg');
                    return {
                      elev_min:       mn('elevation_min_ft'),
                      elev_max:       mx('elevation_max_ft'),
                      slope_mean:     avg('slope_mean_deg'),
                      slope_p10:      mn('slope_p10_deg'),
                      slope_p90:      mx('slope_p90_deg'),
                      aspect_card:    degToCardinal(aspectMeanDeg),
                      aspect_dom_deg: aspectDomDeg,
                      aspect_mean_deg: aspectMeanDeg,
                    };
                  })();

                  const terroirChips = [
                    // Top-left: Blocks
                    {
                      label: 'Blocks',
                      value: String(blockRows.length || group.features.length),
                      tone: 'amber',
                      glow: false,
                    },
                    // Top-right: Elevation
                    {
                      label: 'Elev',
                      value: groupTopoStats?.elev_min != null && groupTopoStats?.elev_max != null
                        ? `${Math.round((groupTopoStats.elev_min + groupTopoStats.elev_max) / 2)} ft`
                        : '—',
                      subValue: groupTopoStats?.elev_min != null && groupTopoStats?.elev_max != null
                        ? `${Math.round(groupTopoStats.elev_min)}–${Math.round(groupTopoStats.elev_max)} ft range`
                        : null,
                      tone: 'parchment',
                      glow: false,
                    },
                    // Bottom-left: Aspect
                    {
                      label: 'Aspect',
                      value: groupTopoStats?.aspect_card || '—',
                      subValue: groupTopoStats?.aspect_dom_deg != null && groupTopoStats?.aspect_mean_deg != null
                        ? `${Math.round(groupTopoStats.aspect_dom_deg)}° dom · ${Math.round(groupTopoStats.aspect_mean_deg)}° avg`
                        : null,
                      tone: 'blue',
                      glow: true,
                    },
                    // Bottom-right: Slope
                    {
                      label: 'Slope',
                      value: groupTopoStats?.slope_mean != null ? `${groupTopoStats.slope_mean.toFixed(1)}°` : '—',
                      subValue: (() => {
                        const p10 = groupTopoStats?.slope_p10;
                        const p90 = groupTopoStats?.slope_p90;
                        if (p10 != null && p90 != null) return `${p10.toFixed(1)}–${p90.toFixed(1)}° range`;
                        return null;
                      })(),
                      tone: 'green',
                      glow: true,
                    },
                  ];

                  // AVA section divider
                  if (avaLabel !== lastAvaLabel) {
                    lastAvaLabel = avaLabel;
                    rendered.push(
                      <div key={`ava-divider-${avaLabel || i}`} style={{
                        ...TYPE.uiLabel, color: muted,
                        padding: i === 0 ? '0 2px 6px' : '12px 2px 6px',
                        borderTop: i === 0 ? 'none' : `1px solid ${border}`,
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
                        border: `1px solid ${border}`,
                        borderRadius: 10, background: parchment,
                        transition: 'color 0.15s', cursor: 'pointer',
                        overflow: 'hidden', marginBottom: 6,
                      }}
                      onMouseEnter={() => { setHoveredGroup(i); onVineyardHover?.(group.features); }}
                      onMouseLeave={() => { setHoveredGroup(null); onVineyardHover?.(null); }}
                      onClick={() => { setExpandedGroupKey(isExpanded ? null : group.key); onViewAllVineyards?.(group.features); }}
                    >
                      {/* Collapsed header */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px 8px' }}>
                        <div style={{ flex: 1, paddingRight: 8, minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: isHovered ? T.cardNameHover : ink, transition: 'color 0.15s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {group.name}
                          </div>
                          {acres && (
                            <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 2 }}>
                              {acres} ac
                              {blockRows.length > 0 && ` · ${blockRows.length} block${blockRows.length !== 1 ? 's' : ''}`}
                            </div>
                          )}
                        </div>
                        <span style={{ fontSize: 'var(--type-ui-label-size)', color: muted, flexShrink: 0 }}>{isExpanded ? '▾' : '▸'}</span>
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div style={{ padding: '0 12px 12px', borderTop: `1px solid ${border}` }}>
                          {/* Terroir snapshot */}
                          <div style={{ paddingTop: 10 }}>
                            <div style={{ ...T.sectionLabel, marginBottom: 8 }}>Terroir Snapshot</div>
                            <TerroirDataChips chips={terroirChips} columns={2} />
                          </div>

                          {/* Block list */}
                          {blockRows.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10 }}>
                              {blockRows.map((b, bi) => (
                                <div key={`${b.name}-${bi}`} style={{ border: `1px solid ${border}`, borderRadius: 7, padding: '7px 10px', background: parchment }}>
                                  <div style={{ fontSize: 'var(--type-body-size)', fontWeight: 700, color: ink }}>{b.name}</div>
                                  <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 2 }}>
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

                          {/* View Blocks deep-dive button */}
                          {onParcelClick && (() => {
                            const parcelIds = group.features.map(f => f.properties?.id).filter(Boolean);
                            if (!parcelIds.length) return null;
                            const firstFeature = group.features[0];
                            return (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onParcelClick({
                                    ids: parcelIds,
                                    parcel_label: group.name,
                                    vineyard_name: firstFeature?.properties?.vineyard_name || group.name,
                                    acres: group.acresCount > 0 ? group.acresTotal : null,
                                  });
                                }}
                                style={{
                                  marginTop: 10, width: '100%', padding: '7px 0',
                                  background: 'transparent', border: `1px solid ${border}`,
                                  borderRadius: 7, fontSize: 'var(--type-mono-size)',
                                  color: ink, cursor: 'pointer',
                                  fontFamily: 'var(--font-sans)', fontWeight: 600,
                                }}
                              >
                                View Blocks →
                              </button>
                            );
                          })()}
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
          <div style={{ textAlign: 'center', padding: '16px 0', color: muted, fontSize: 'var(--type-mono-size)' }}>
            No mapped vineyard parcels
          </div>
        )}

        {sourcedFrom.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ marginBottom: 8 }}>
              <span style={T.sectionLabel}>🍷 Sourced From</span>
            </div>
            {(() => {
              // Group by source winery
              const bySource = sourcedFrom.reduce((acc, b) => {
                const key = `${b.source_winery_id || 'x'}|${b.source_winery_name}`;
                if (!acc[key]) acc[key] = { name: b.source_winery_name, recid: b.source_winery_recid, blocks: [] };
                acc[key].blocks.push(b);
                return acc;
              }, {});
              return Object.values(bySource).map((src) => (
                <div key={src.name} style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: `1px solid ${border}`,
                  marginBottom: 6,
                  background: parchment,
                }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--type-mono-size)', color: ink }}>
                    {src.name}
                  </div>
                  <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 2 }}>
                    {src.blocks.length} block{src.blocks.length !== 1 ? 's' : ''}:
                    {' '}
                    {src.blocks.map(b => `${b.parcel_label || b.vineyard_name} · ${b.block_name}`).join(' • ')}
                  </div>
                </div>
              ));
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Data layers section ───────────────────────────────────────────────────
// ── ParcelBlockView ───────────────────────────────────────────────────────
/**
 * Full-panel view for a single vineyard parcel's blocks.
 * Fetches /api/vineyards/parcels/:id/blocks and renders a sortable table.
 * Reached by clicking "View Blocks →" on an expanded parcel card.
 */
function ParcelBlockView({ parcel, onBack }) {
  const [blocks, setBlocks] = useState(null); // null = loading
  const [error, setError]   = useState(null);
  const [sort, setSort]     = useState({ key: 'block_name', dir: 1 });
  const [hoveredRow, setHoveredRow] = useState(null);

  useEffect(() => {
    const ids = parcel?.ids?.length ? parcel.ids : (parcel?.id ? [parcel.id] : []);
    if (!ids.length) return;
    let cancelled = false;
    setBlocks(null);
    setError(null);
    Promise.all(
      ids.map(id =>
        fetch(`/api/vineyards/parcels/${id}/blocks`)
          .then(r => r.ok ? r.json() : Promise.reject(r.status))
          .then(data => Array.isArray(data?.blocks) ? data.blocks : (Array.isArray(data) ? data : []))
      )
    )
      .then(results => {
        if (!cancelled) setBlocks(results.flat());
      })
      .catch(e => { if (!cancelled) setError(`Could not load blocks (${e})`); });
    return () => { cancelled = true; };
  }, [parcel?.ids?.join(','), parcel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSort(key) {
    setSort(s => s.key === key ? { key, dir: s.dir * -1 } : { key, dir: 1 });
  }

  const sorted = blocks
    ? [...blocks].sort((a, b) => {
        const av = a[sort.key] ?? '';
        const bv = b[sort.key] ?? '';
        if (av === '' && bv !== '') return 1;
        if (bv === '' && av !== '') return -1;
        return typeof av === 'number'
          ? (av - bv) * sort.dir
          : String(av).localeCompare(String(bv)) * sort.dir;
      })
    : [];

  const totalAcres = blocks ? blocks.reduce((s, b) => s + (Number(b.acres) || 0), 0) : 0;
  const totalVines = blocks ? blocks.reduce((s, b) => s + (Number(b.vines) || 0), 0) : 0;

  // Compute top variety by block count for the summary pill
  const topVariety = blocks && blocks.length > 0 ? (() => {
    const counts = {};
    blocks.forEach(b => { if (b.variety) counts[b.variety] = (counts[b.variety] || 0) + 1; });
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best ? { name: best[0], count: best[1] } : null;
  })() : null;

  const COL_DEFS = [
    { key: 'block_name',    label: 'Block',       width: 110, bold: true },
    { key: 'variety',       label: 'Variety',     width: 120 },
    { key: 'clone',         label: 'Clone',       width: 70  },
    { key: 'rootstock',     label: 'Rootstock',   width: 80  },
    { key: 'year_planted',  label: 'Yr',          width: 44  },
    { key: 'acres',         label: 'Acres',       width: 54, num: true, fmt: v => v != null ? Number(v).toFixed(2) : '—' },
    { key: 'rows',          label: 'Rows',        width: 44, num: true },
  ];

  const thStyle = (key) => ({
    padding: '6px 8px',
    textAlign: 'left',
    fontSize: 'var(--type-ui-label-size)',
    fontWeight: 700,
    color: sort.key === key ? ink : muted,
    background: alpha(ink, 0.03),
    borderBottom: `1px solid ${border}`,
    cursor: 'pointer',
    userSelect: 'none',
    position: 'sticky',
    top: 0,
    whiteSpace: 'nowrap',
  });
  const tdStyle = (bold) => ({
    padding: '6px 8px',
    fontSize: 'var(--type-mono-size)',
    color: bold ? ink : muted,
    fontWeight: bold ? 600 : 400,
    borderBottom: `1px solid ${alpha(border, 0.5)}`,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 140,
  });

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <BackBtn onClick={onBack} />

      {/* Header */}
      <div style={{ padding: '10px 16px 0' }}>
        <div style={{ fontSize: 'var(--type-display-italic-size)', fontWeight: 700, color: ink, lineHeight: 1.2 }}>
          {parcel.parcel_label || parcel.vineyard_name}
        </div>
        <div style={{ fontSize: 'var(--type-mono-size)', color: muted, marginTop: 2 }}>
          {parcel.vineyard_name}
          {parcel.acres ? ` · ${Number(parcel.acres).toFixed(1)} ac` : ''}
        </div>
      </div>

      {/* Summary pills */}
      {blocks && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 16px 0' }}>
          {[
            { label: 'Blocks',  val: blocks.length },
            { label: 'Acres',   val: totalAcres > 0 ? totalAcres.toFixed(1) : null },
            { label: 'Vines',   val: totalVines > 0 ? totalVines.toLocaleString() : null },
          ].filter(p => p.val != null).map(p => (
            <div key={p.label} style={{
              padding: '4px 10px', borderRadius: 20,
              background: alpha(ink, 0.05),
              fontSize: 'var(--type-ui-label-size)', color: ink, fontWeight: 600,
            }}>
              {p.val} <span style={{ fontWeight: 400, color: muted }}>{p.label}</span>
            </div>
          ))}
          {topVariety && (
            <div style={{
              padding: '4px 10px', borderRadius: 20,
              background: alpha(ink, 0.05),
              fontSize: 'var(--type-ui-label-size)', color: ink, fontWeight: 600,
            }}>
              {topVariety.name}
              {topVariety.count > 1 && <span style={{ fontWeight: 400, color: muted }}> ({topVariety.count})</span>}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflowX: 'auto', padding: '12px 0 0' }}>
        {error && (
          <div style={{ padding: '12px 16px', color: crimson, fontSize: 'var(--type-mono-size)' }}>{error}</div>
        )}
        {!error && blocks === null && (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: muted, fontSize: 'var(--type-mono-size)' }}>Loading…</div>
        )}
        {!error && blocks !== null && blocks.length === 0 && (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: muted, fontSize: 'var(--type-mono-size)' }}>No blocks recorded for this parcel.</div>
        )}
        {!error && sorted.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--type-mono-size)' }}>
            <thead>
              <tr>
                {COL_DEFS.map(c => (
                  <th key={c.key} style={thStyle(c.key)} onClick={() => toggleSort(c.key)}>
                    {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ▴' : ' ▾') : ''}
                  </th>
                ))}
                <th style={{ ...thStyle(null), cursor: 'default' }}>Sold To</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(block => (
                <tr
                  key={block.id}
                  onMouseEnter={() => setHoveredRow(block.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{ background: hoveredRow === block.id ? alpha(electricBlue, 0.06) : 'transparent', transition: 'background 0.12s' }}
                >
                  {COL_DEFS.map(c => (
                    <td key={c.key} style={tdStyle(c.bold)}>
                      {c.fmt ? c.fmt(block[c.key]) : (block[c.key] ?? '—')}
                    </td>
                  ))}
                  {/* Inline buyers column */}
                  <td style={{ ...tdStyle(false), maxWidth: 120 }}>
                    {Array.isArray(block.buyers) && block.buyers.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {block.buyers.map(buyer => (
                          <span key={buyer.name} style={{
                            padding: '1px 6px', borderRadius: 10,
                            fontSize: '10px',
                            background: alpha(ink, 0.07),
                            color: muted,
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                          }}>
                            {buyer.winery_title || buyer.name}
                          </span>
                        ))}
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}

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
      <div style={{ borderBottom: `1px solid ${border}` }}>
        <button
          onClick={() => setClimateOpen(p => !p)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
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
                      border: `1.5px solid ${active ? crimson + '80' : border}`,
                      background: active ? TOKENS.dangerDim : parchment,
                      cursor: 'pointer', fontFamily: 'var(--font-sans)', marginBottom: active ? 6 : 0,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: active ? crimson : ink }}>{layer.label}</div>
                      <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 1 }}>{layer.sub}</div>
                    </div>
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', border: `2px solid ${active ? crimson : border}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {active && <div style={{ width: 10, height: 10, borderRadius: '50%', background: crimson }} />}
                    </div>
                  </button>

                  {/* Month slider when climate is active */}
                  {active && (
                    <div style={{ padding: '8px 10px 4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={T.sectionLabel}>Month</span>
                        <span style={{ fontSize: 'var(--type-mono-size)', fontWeight: 700, color: ink }}>{MONTH_ABBR[currentMonth - 1]}</span>
                      </div>
                      <input
                        type="range" min="1" max="12" value={currentMonth}
                        onChange={e => onMonthChange(Number(e.target.value))}
                        style={{ width: '100%', accentColor: crimson, cursor: 'pointer' }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 2 }}>
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
      <div style={{ borderBottom: `1px solid ${border}` }}>
        <button
          onClick={() => setTopoOpen(p => !p)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
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
                    border: `1.5px solid ${active ? crimson + '80' : border}`,
                    background: active ? TOKENS.dangerDim : parchment,
                    cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: active ? crimson : ink }}>{layer.label}</div>
                    <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 1 }}>{layer.sub}</div>
                  </div>
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%', border: `2px solid ${active ? crimson : border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    {active && <div style={{ width: 10, height: 10, borderRadius: '50%', background: crimson }} />}
                  </div>
                </button>
              );
            })}

            {/* Legend / scale for active topo layer */}
            {topoConfig && activeLayer && (
              <div style={{ border: `1px solid ${border}`, borderRadius: 8, padding: '10px 12px', background: parchment, marginTop: 4 }}>
                <div style={{ ...T.sectionLabel, marginBottom: 8 }}>Scale — {topoConfig.label}</div>
                <div style={{ height: 8, borderRadius: 6, background: COLORMAP_CSS[topoConfig.colormap] || TOKENS.ghost, marginBottom: 4, border: `1px solid ${border}` }} />
                {topoStats && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--type-ui-label-size)', color: muted, marginBottom: 8 }}>
                      <span>{topoStats.min?.toFixed(1)}{topoConfig.unit}</span>
                      <span>{topoStats.max?.toFixed(1)}{topoConfig.unit}</span>
                    </div>
                    <TerroirDataChips chips={[
                      { label: 'Min',     value: `${fmt(topoStats.min)}${topoConfig.unit}`,  tone: 'blue',      glow: true  },
                      { label: 'Max',     value: `${fmt(topoStats.max)}${topoConfig.unit}`,  tone: 'amber',     glow: true  },
                      { label: 'Mean',    value: `${fmt(topoStats.mean)}${topoConfig.unit}`, tone: 'green',     glow: true  },
                      { label: 'Std Dev', value: `±${fmt(topoStats.std)}${topoConfig.unit}`,  tone: 'parchment', glow: false },
                    ]} />
                  </>
                )}
                {!topoStats && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${border}`, borderTopColor: ink, animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                    <span style={{ fontSize: 'var(--type-ui-label-size)', color: muted }}>Loading statistics…</span>
                    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  </div>
                )}
              </div>
            )}
            {activeLayer === 'tdmean' && (
              <div style={{ border: `1px solid ${border}`, borderRadius: 8, padding: '10px 12px', background: parchment, marginTop: 4 }}>
                <div style={{ ...T.sectionLabel, marginBottom: 8 }}>Scale — Mean Temperature</div>
                <div style={{ height: 8, borderRadius: 6, background: COLORMAP_CSS.plasma, marginBottom: 4, border: `1px solid ${border}` }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--type-ui-label-size)', color: muted }}>
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
function WineriesSection({ listings, listingFilterMode, onListingFilterModeChange, vineyardRecidSet, insideIds, selectedAva, onListingClick, onListingHover, vineyardFilterResult }) {
  const ava = selectedAva ? WV_SUB_AVAS.find(a => a.slug === selectedAva) : null;

  // Sort key: 'name' | 'parcels' | 'acres' | 'elevation' | 'ava'
  const [sortKey, setSortKey] = useState('name');

  // Optional rollup data from active vineyard filters. When present, listings
  // are restricted to those wineries, and the extra metrics (acres / elevation
  // / parcel count / ava names) are merged onto each row for display & sort.
  const filterActive = !!(vineyardFilterResult && Array.isArray(vineyardFilterResult.wineries));
  const rollupByRecid = useMemo(() => {
    if (!filterActive) return null;
    const map = new Map();
    for (const w of vineyardFilterResult.wineries) {
      if (w.recid != null) map.set(w.recid, w);
    }
    return map;
  }, [filterActive, vineyardFilterResult]);

  const baseListings = useMemo(() => {
    return listings.filter(l => {
      if (l.category !== 'winery') return false;
      if (listingFilterMode === LISTING_FILTER_MODES.withVineyardPolygons && !vineyardRecidSet.has(l.id)) return false;
      if (listingFilterMode === LISTING_FILTER_MODES.withoutVineyardPolygons && vineyardRecidSet.has(l.id)) return false;
      if (listingFilterMode === LISTING_FILTER_MODES.noWineriesVisualized) return false;
      if (insideIds && !insideIds.includes(l.id)) return false;
      // When a vineyard-stat filter is active, only show wineries that matched
      if (filterActive && !rollupByRecid.has(l.id)) return false;
      return true;
    }).map(l => {
      const r = filterActive ? rollupByRecid.get(l.id) : null;
      return {
        ...l,
        _matching_vineyard_count: r ? r.matching_vineyard_count : (vineyardRecidSet.get?.(l.id) ?? 0),
        _matching_acres:        r ? r.matching_acres        : null,
        _elevation_mean_ft:     r ? r.elevation_mean_ft     : null,
        _ava_names:             r ? (Array.isArray(r.ava_names) ? r.ava_names : []) : [],
      };
    });
  }, [listings, listingFilterMode, vineyardRecidSet, insideIds, filterActive, rollupByRecid]);

  const visible = useMemo(() => {
    const arr = baseListings.slice();
    const cmpStr = (a, b) => String(a || '').localeCompare(String(b || ''));
    const cmpNum = (a, b, dir = 1) => {
      const av = a == null ? -Infinity : Number(a);
      const bv = b == null ? -Infinity : Number(b);
      return dir * (bv - av); // higher first by default
    };
    switch (sortKey) {
      case 'parcels':   arr.sort((a, b) => cmpNum(a._matching_vineyard_count, b._matching_vineyard_count) || cmpStr(a.title, b.title)); break;
      case 'acres':     arr.sort((a, b) => cmpNum(a._matching_acres,        b._matching_acres)        || cmpStr(a.title, b.title)); break;
      case 'elevation': arr.sort((a, b) => cmpNum(a._elevation_mean_ft,     b._elevation_mean_ft)     || cmpStr(a.title, b.title)); break;
      case 'ava':       arr.sort((a, b) => cmpStr(a._ava_names?.[0],        b._ava_names?.[0])        || cmpStr(a.title, b.title)); break;
      case 'name':
      default:          arr.sort((a, b) => cmpStr(a.title, b.title)); break;
    }
    return arr;
  }, [baseListings, sortKey]);

  const pills = [
    { id: LISTING_FILTER_MODES.allWineries, label: 'All' },
    { id: LISTING_FILTER_MODES.withVineyardPolygons, label: 'Mapped' },
    { id: LISTING_FILTER_MODES.withoutVineyardPolygons, label: 'Unmapped' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Filter pills */}
      <div style={{ padding: '10px 16px 8px', display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: `1px solid ${border}` }}>
        {pills.map(p => {
          const isActive = listingFilterMode === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onListingFilterModeChange(p.id)}
              style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 'var(--type-ui-label-size)', fontWeight: 600,
                border: `1px solid ${isActive ? crimson + '90' : border}`,
                background: isActive ? TOKENS.dangerDim : parchment,
                color: isActive ? crimson : muted,
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
                transition: 'all 0.15s',
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {ava && (
        <div style={{ padding: '6px 16px', background: TOKENS.dangerDim, borderBottom: `1px solid ${border}` }}>
          <span style={{ fontSize: 'var(--type-ui-label-size)', color: crimson }}>Showing {ava.name} only — {visible.length} winer{visible.length === 1 ? 'y' : 'ies'}</span>
        </div>
      )}

      {/* Filter-results banner */}
      {filterActive && (
        <div style={{ padding: '6px 16px', background: TOKENS.dangerDim, borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 'var(--type-ui-label-size)', color: crimson, fontWeight: 600 }}>
            {vineyardFilterResult.winery_total_count} winer{vineyardFilterResult.winery_total_count === 1 ? 'y' : 'ies'} match · {vineyardFilterResult.matching_vineyard_total_count} vineyard{vineyardFilterResult.matching_vineyard_total_count === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {/* Sort row */}
      <div style={{ padding: '8px 16px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--type-ui-label-size)', color: muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
          Sort
        </span>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          style={{
            flex: 1,
            background: parchment,
            border: `1px solid ${border}`,
            borderRadius: 6,
            color: ink,
            padding: '4px 6px',
            fontSize: 'var(--type-ui-label-size)',
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="name">Name (A–Z)</option>
          <option value="parcels">{filterActive ? 'Matching parcels' : '# Parcels'} (high → low)</option>
          {filterActive && <option value="acres">Matching acres (high → low)</option>}
          {filterActive && <option value="elevation">Mean elevation (high → low)</option>}
          {filterActive && <option value="ava">AVA</option>}
        </select>
      </div>

      {/* Winery list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
        {visible.length === 0 && (
          <div style={{ padding: '20px 4px', textAlign: 'center', color: muted, fontSize: 'var(--type-mono-size)' }}>
            {listings.length === 0 ? 'Loading…' : (filterActive ? 'No wineries match the active filters.' : 'No wineries match this filter.')}
          </div>
        )}
        {visible.map((l) => {
          const vineyardCount = vineyardRecidSet.get(l.id) ?? 0;
          const baseLabel = vineyardCount === 0 ? 'No vineyard map'
            : vineyardCount === 1 ? 'Vineyard mapped'
            : `${vineyardCount} vineyards mapped`;
          // When a stat-filter is active, show match metrics inline
          const meta = filterActive
            ? [
                `${l._matching_vineyard_count} vineyard${l._matching_vineyard_count === 1 ? '' : 's'}`,
                l._matching_acres != null ? `${l._matching_acres} ac` : null,
                l._elevation_mean_ft != null ? `${l._elevation_mean_ft} ft avg` : null,
              ].filter(Boolean).join(' · ')
            : baseLabel;
          return (
            <div
              key={l.id}
              onClick={() => onListingClick(l)}
              style={{
                border: `1px solid ${border}`,
                borderRadius: 10, background: parchment,
                cursor: 'pointer', overflow: 'hidden',
                transition: 'border-color 0.15s',
                marginBottom: 6,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.cardNameHover + '55'; const n = e.currentTarget.querySelector('.winery-card-name'); if (n) n.style.color = T.cardNameHover; onListingHover?.(l); }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = border; const n = e.currentTarget.querySelector('.winery-card-name'); if (n) n.style.color = ink; onListingHover?.(null); }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px 8px' }}>
                <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                  <div className="winery-card-name" style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: ink, transition: 'color 0.15s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {l.title}
                  </div>
                  <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 2 }}>
                    {meta}
                  </div>
                </div>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: filterActive ? crimson : (vineyardCount > 0 ? UI.mapped : muted),
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── About section ─────────────────────────────────────────────────────────
function AboutSection({ totalAcres }) {
  const acresPhrase = fmtAcresApprox(totalAcres) || '16,000+';
  return (
    <div style={{ padding: '14px 16px', fontSize: 'var(--type-mono-size)', color: muted, lineHeight: 1.75 }}>
      <p style={{ margin: '0 0 12px' }}>
        <strong style={{ color: ink }}>Willamette Valley Wine Country</strong> encompasses over 500 wineries and {acresPhrase} acres of mapped vineyard across eleven American Viticultural Areas in Oregon's Northern Willamette Valley.
      </p>
      <p style={{ margin: '0 0 12px' }}>
        This explorer provides detailed vineyard mapping, topographic analysis, and climate data for each nested AVA.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: UI.mapped, flexShrink: 0 }} />
          <span style={{ fontSize: 'var(--type-body-size)' }}>Mapped vineyard parcels</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: UI.refParcel, flexShrink: 0 }} />
          <span style={{ fontSize: 'var(--type-body-size)' }}>Reference parcels (no winery link)</span>
        </div>
      </div>
      <p style={{ margin: '14px 0 0', fontSize: 'var(--type-ui-label-size)', color: muted }}>
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
  isMobile = false,
  isOpen = false,
  onClose,
  // Vineyard filter modal hooks (optional)
  onOpenFilters,
  filterActiveCount = 0,
  vineyardFilterResult = null,
}) {
  const [sections, setSections] = useState({ layers: false, about: false });

  // Live mapped-vineyard-acres per AVA + valley total (GET /api/avas/acres).
  // Fetched once; feeds the overview tile, the About blurb, and each AVA's
  // snapshot chip so the numbers track block edits without code changes.
  const [acresData, setAcresData] = useState(null); // { avas: { slug: acres }, total }
  useEffect(() => {
    let cancelled = false;
    apiJson('/api/avas/acres')
      .then((d) => { if (!cancelled) setAcresData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Navigation stack: 'home' | 'ava-list' | 'winery-list' | 'ava-detail' | 'winery-detail' | 'parcel-blocks'
  const [viewStack, setViewStack] = useState(['home']);
  const [detailAva, setDetailAva] = useState(null);
  const [detailWinery, setDetailWinery] = useState(null);
  const [detailParcel, setDetailParcel] = useState(null); // { id, parcel_label, vineyard_name, acres }
  // Tracks what to render in panel 2 (preserved during slide-out animations)
  const [panel2Type, setPanel2Type] = useState(null); // 'ava' | 'winery'
  // Skip-count refs: incremented before an internal setter call so the
  // corresponding external-sync effect knows to ignore that one bounce-back.
  const skipListingRef = useRef(0);
  const skipAvaRef    = useRef(0);

  const currentView = viewStack[viewStack.length - 1];

  // Column index for the 3-panel (+ parcel-blocks) sliding track
  const VIEW_COL = { home: 0, 'ava-list': 1, 'winery-list': 1, 'ava-detail': 2, 'winery-detail': 2, 'parcel-blocks': 3 };
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

  const handleParcelClick = useCallback((parcel) => {
    setDetailParcel(parcel);
    setViewStack(prev => {
      const top = prev[prev.length - 1];
      if (top === 'parcel-blocks') return [...prev.slice(0, -1), 'parcel-blocks'];
      return [...prev, 'parcel-blocks'];
    });
  }, []);

  const isOnHome = currentView === 'home';
  const wineryCount = listings.filter(l => l.category === 'winery').length;
  const mappedCount = vineyardRecidSet ? vineyardRecidSet.size : 0;
  const viewTitle = currentView === 'ava-list' ? 'Nested AVAs'
    : currentView === 'winery-list' ? 'Wineries'
    : currentView === 'ava-detail' ? (detailAva?.name ?? '')
    : currentView === 'winery-detail' ? (detailWinery?.title ?? '')
    : currentView === 'parcel-blocks' ? (detailParcel?.parcel_label ?? 'Blocks')
    : '';

  return (
    <div style={{
      width: isMobile ? '85vw' : SIDEBAR_W,
      minWidth: isMobile ? 'unset' : SIDEBAR_MIN_W,
      maxWidth: isMobile ? 360 : SIDEBAR_MAX_W,
      height: '100%',
      background: T.sidebarBg,
      borderRight: `1px solid ${border}`,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: isMobile ? 'fixed' : 'relative',
      top: isMobile ? 0 : undefined,
      left: isMobile ? 0 : undefined,
      zIndex: isMobile ? 200 : 10,
      transform: isMobile ? (isOpen ? 'translateX(0)' : 'translateX(-100%)') : undefined,
      transition: isMobile ? 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)' : undefined,
      boxShadow: isMobile && isOpen ? `4px 0 24px ${UI.mobileShadow}` : undefined,
    }}>

      {/* Sidebar header — search bar + optional back button on same line */}
      <div style={{ background: T.headerBg, padding: '10px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isOnHome && (
            <button
              onClick={handleBack}
              style={{
                background: UI.backBtnBg, border: `1px solid ${UI.backBtnBorder}`,
                borderRadius: 7, color: T.headerText, cursor: 'pointer',
                width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 'var(--type-display-italic-size)', flexShrink: 0,
              }}
            >
              ‹
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <SearchBar inline mapRef={mapRef} onOpenFilters={onOpenFilters} activeFilterCount={filterActiveCount} onSelectAva={(slug) => {
              const ava = WV_SUB_AVAS.find(a => a.slug === slug);
              if (ava) handleAvaClick(ava);
              else onSelectAva(slug);
            }} />
          </div>
          {isMobile && (
            <button
              onClick={onClose}
              aria-label="Close menu"
              style={{
                background: UI.backBtnBg, border: `1px solid ${UI.backBtnBorder}`,
                borderRadius: 7, color: T.headerText, cursor: 'pointer',
                width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 'var(--type-display-italic-size)', flexShrink: 0, lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* 4-panel sliding content area */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div style={{
          display: 'flex',
          width: '400%',
          height: '100%',
          transform: `translateX(${-(col * (100 / 4)).toFixed(4)}%)`,
          transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'transform',
        }}>

          {/* ── Panel 0: Home menu ── */}
          <div style={{ width: '25%', height: '100%', overflowY: 'auto', overflowX: 'hidden', flexShrink: 0, display: 'flex', flexDirection: 'column', scrollbarWidth: 'thin', scrollbarColor: `${alpha(ink, 0.18)} transparent` }}>

            {/* Hero welcome card — light, stretches to fill remaining space */}
            <div style={{
              background: parchment,
              padding: '16px 16px 14px',
              borderBottom: `1px solid ${border}`,
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}>
              <p style={{ fontSize: 'var(--type-body-size)', color: muted, margin: '0 0 14px', lineHeight: 1.65 }}>
                Explore 11 nested American Viticultural Areas across Oregon's Northern Willamette Valley — with vineyard mapping, topographic analysis, and 30-year climate data.
              </p>

              {/* Stat chips grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ background: parchment, borderRadius: 8, padding: '9px 12px', border: `1px solid ${border}` }}>
                  <div style={{ fontSize: 'var(--type-display-italic-size)', fontWeight: 700, color: ink, fontFamily: 'var(--font-display)', lineHeight: 1 }}>{WV_SUB_AVAS.length}</div>
                  <div style={{ ...T.sectionLabel, marginTop: 3, fontWeight: 600 }}>Nested AVAs</div>
                </div>
                <div style={{ background: parchment, borderRadius: 8, padding: '9px 12px', border: `1px solid ${border}` }}>
                  <div style={{ fontSize: 'var(--type-display-italic-size)', fontWeight: 700, color: ink, fontFamily: 'var(--font-display)', lineHeight: 1 }}>{wineryCount > 0 ? wineryCount : '—'}</div>
                  <div style={{ ...T.sectionLabel, marginTop: 3, fontWeight: 600 }}>Wineries</div>
                </div>
                <div style={{ background: alpha(TOKENS.success, 0.07), borderRadius: 8, padding: '9px 12px', border: `1px solid ${alpha(TOKENS.success, 0.25)}` }}>
                  <div style={{ fontSize: 'var(--type-display-italic-size)', fontWeight: 700, color: UI.mapped, fontFamily: 'var(--font-display)', lineHeight: 1 }}>{mappedCount > 0 ? mappedCount : '—'}</div>
                  <div style={{ ...T.sectionLabel, marginTop: 3, fontWeight: 600 }}>Mapped</div>
                </div>
                <div style={{ background: parchment, borderRadius: 8, padding: '9px 12px', border: `1px solid ${border}` }}>
                  <div style={{ fontSize: 'var(--type-display-italic-size)', fontWeight: 700, color: ink, fontFamily: 'var(--font-display)', lineHeight: 1 }}>{fmtAcresCompact(acresData?.total) || '—'}</div>
                  <div style={{ ...T.sectionLabel, marginTop: 3, fontWeight: 600 }}>Mapped Vineyard Acres</div>
                </div>
              </div>
            </div>

            {/* Enhanced: Nested AVAs nav row */}
            <button
              onClick={() => setViewStack(prev => prev[prev.length - 1] === 'home' ? [...prev, 'ava-list'] : prev)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '13px 16px', background: 'none', border: 'none',
                borderBottom: `1px solid ${border}`, cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = T.hoverBg}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: UI.buttonBg1, border: `1px solid ${border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: ink }}>Nested AVAs</div>
                  <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 2 }}>{WV_SUB_AVAS.length} viticultural areas</div>
                </div>
              </div>
              <span style={{ fontSize: 'var(--type-display-italic-size)', color: muted }}>›</span>
            </button>

            {/* Enhanced: Wineries nav row */}
            <button
              onClick={() => setViewStack(prev => prev[prev.length - 1] === 'home' ? [...prev, 'winery-list'] : prev)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '13px 16px', background: 'none', border: 'none',
                borderBottom: `1px solid ${border}`, cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = T.hoverBg}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: UI.danger08, border: `1px solid ${UI.danger15}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={UI.danger75} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M8 22h8"/><path d="M12 11v11"/><path d="M6 2h12l-3 9a5 5 0 0 1-6 0L6 2z"/></svg>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: ink }}>Wineries</div>
                  <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 2 }}>{wineryCount > 0 ? `${wineryCount} in the valley` : 'Browse all wineries'}</div>
                </div>
              </div>
              <span style={{ fontSize: 'var(--type-display-italic-size)', color: muted }}>›</span>
            </button>

            {/* Enhanced: Data Layers nav row */}
            <button
              onClick={() => toggleSection('layers')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '13px 16px', background: 'none', border: 'none',
                borderBottom: `1px solid ${border}`, cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = T.hoverBg}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: UI.electric08, border: `1px solid ${UI.electric15}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={UI.electric75} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: ink }}>Data Layers</div>
                  <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 2 }}>Climate &amp; topography overlays</div>
                </div>
              </div>
              <Chevron open={sections.layers} size={13} />
            </button>
            {sections.layers && (
              <div style={{ borderBottom: `1px solid ${border}` }}>
                <LayerSection
                  activeLayer={activeLayer}
                  onLayerChange={onLayerChange}
                  currentMonth={currentMonth}
                  onMonthChange={onMonthChange}
                  topoStats={topoStats}
                />
              </div>
            )}

            {/* About accordion */}
            <div>
              <button
                onClick={() => toggleSection('about')}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '13px 16px', background: 'none', border: 'none',
                  borderBottom: sections.about ? `1px solid ${border}` : 'none',
                  cursor: 'pointer', fontFamily: 'var(--font-sans)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.hoverBg}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: UI.buttonBg2, border: `1px solid ${border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--type-display-italic-size)',
                  }}>ℹ️</div>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: ink }}>About &amp; Legend</div>
                    <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 2 }}>Data sources &amp; map key</div>
                  </div>
                </div>
                <Chevron open={sections.about} size={13} />
              </button>
              {sections.about && <AboutSection totalAcres={acresData?.total} />}
            </div>
          </div>

          {/* ── Panel 1: List view ── */}
          <div style={{ width: '25%', height: '100%', overflow: 'hidden', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
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
                vineyardFilterResult={vineyardFilterResult}
              />
            ) : (
              <div style={{ flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
                {WV_SUB_AVAS.map(ava => {
                  const isSelected = selectedAva === ava.slug;
                  const avaMeta = AVA_META[ava.slug] || {};
                  const subtitle = [
                    avaMeta.established ? `Est. ${avaMeta.established}` : null,
                    avaMeta.acres ? `${avaMeta.acres} ac` : null,
                  ].filter(Boolean).join(' · ') || 'AVA';
                  return (
                    <div key={ava.slug} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {ava.parentAva && (
                        <span style={{ fontSize: 'var(--type-ui-label-size)', color: muted, flexShrink: 0, lineHeight: 1, userSelect: 'none' }}>└</span>
                      )}
                      <div
                        onClick={() => handleAvaClick(ava)}
                        className="ava-card"
                        style={{
                          flex: 1,
                          height: '100%',
                          border: `1px solid ${isSelected ? crimson + '55' : border}`,
                          borderRadius: 10,
                          background: isSelected ? T.activeBg : parchment,
                          cursor: 'pointer', overflow: 'hidden',
                          transition: 'border-color 0.15s',
                          display: 'flex', alignItems: 'center',
                        }}
                        onMouseEnter={e => {
                          if (!isSelected) e.currentTarget.style.borderColor = T.cardNameHover + '55';
                          const nameEl = e.currentTarget.querySelector('.ava-card-name');
                          if (nameEl && !isSelected) nameEl.style.color = T.cardNameHover;
                          mapRef.current?.hoverAva(ava.slug);
                        }}
                        onMouseLeave={e => {
                          if (!isSelected) e.currentTarget.style.borderColor = border;
                          const nameEl = e.currentTarget.querySelector('.ava-card-name');
                          if (nameEl && !isSelected) nameEl.style.color = ink;
                          mapRef.current?.hoverAva(null);
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', width: '100%' }}>
                          <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                            <div className="ava-card-name" style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: isSelected ? crimson : ink, transition: 'color 0.15s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {ava.name}
                            </div>
                            <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 2 }}>
                              {subtitle}
                            </div>
                          </div>
                          <span style={{ fontSize: 'var(--type-ui-label-size)', color: muted, flexShrink: 0 }}>›</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Panel 2: Detail view ── */}
          <div style={{ width: '25%', height: '100%', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            {panel2Type === 'ava' && detailAva && (
              <AvaDetailView
                ava={detailAva}
                listings={listings}
                insideIds={insideIds}
                vineyardRecidSet={vineyardRecidSet}
                mappedAcres={acresData?.avas?.[detailAva.slug]}
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
                onParcelClick={handleParcelClick}
              />
            )}
          </div>

          {/* ── Panel 3: Parcel blocks ── */}
          <div style={{ width: '25%', height: '100%', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            {detailParcel && (
              <ParcelBlockView
                parcel={detailParcel}
                onBack={() => setViewStack(prev => prev.slice(0, -1))}
              />
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
