import { useEffect, useState } from 'react';
import { alpha, border, interactive, interactiveSoft, ink, muted, parchment, MAP_GLASS, TOKENS } from '../styles/tokens';
import { VINEYARD_THEMES, NO_DATA_COLOR, vineyardThemeLegend, THEME_MATCHING_LAYER } from '../config/vineyardThemes';
import { CLIMATE_MAP_LAYERS, CLIMATE_MAP_GROUPS, VINTAGE_FIRST_YEAR, VINTAGE_LAST_YEAR, isVintageLayer } from '../config/climateMapConfig';
import { TOPO_LAYER_TYPES } from '../config/topographyConfig';
import { EARTH_LAYER_TYPES, EARTH_LAYER_IDS } from '../config/earthLayersConfig';
import { topoRangeLabel } from '../config/topoClasses';
import { legendGroupsFor } from '../lib/legendGroups';
import { describeLegendSelection } from '../lib/legendSelection';
import { useVintagePlayback } from './climate/VintageYearControls';
import { VINEYARD_MEMBER_PALETTE, VINEYARD_GREY, VINEYARD_WHITE, VINEYARD_HIGHLIGHT, VINEYARD_OUTLINE_WHITE } from './WVWAMap';
import LegendFilter from './LegendFilter';

/**
 * On-map key: what the map is showing right now, and the switches people reach
 * for most — vineyard colouring, filled vs outline, the background layer and
 * its siblings, the vintage year, and legend filtering. It shares state with
 * the sidebar's Data Layers section (all lifted into WVWAMapPage), which stays
 * the place for layer descriptions, term help and custom topography ranges.
 *
 * Collapsed it is a stack of pills (one per thing on the map); tapping one
 * opens the full card. The open/closed choice is remembered per browser.
 */

const OPEN_KEY = 'wvwa:mapKeyOpen';

// Layer families, in the sidebar's order. Siblings in a family are one tap apart.
const LAYER_FAMILIES = [
  ...CLIMATE_MAP_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    ids: Object.values(CLIMATE_MAP_LAYERS).filter((l) => l.group === g.id).map((l) => l.id),
  })),
  { id: 'terrain', label: 'Terrain', ids: Object.keys(TOPO_LAYER_TYPES) },
  { id: 'earth', label: 'Soil and rock', ids: EARTH_LAYER_IDS },
];

const layerLabel = (id) => CLIMATE_MAP_LAYERS[id]?.label ?? TOPO_LAYER_TYPES[id]?.label ?? EARTH_LAYER_TYPES[id]?.label ?? id;
const layerSub = (id) => CLIMATE_MAP_LAYERS[id]?.sub ?? TOPO_LAYER_TYPES[id]?.description ?? EARTH_LAYER_TYPES[id]?.description ?? '';
const familyOf = (id) => LAYER_FAMILIES.find((f) => f.ids.includes(id));

function readOpen() {
  try { return window.localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}
function writeOpen(open) {
  try { window.localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* storage blocked */ }
}

const T = {
  label: { fontSize: 'var(--type-ui-label-size)', color: muted, fontWeight: 650 },
  small: { fontSize: 'var(--type-ui-label-size)', color: muted },
  body:  { fontSize: 'var(--type-mono-size)', color: ink },
};

const CARD = {
  background: MAP_GLASS.bgStrong,
  border: `1px solid ${MAP_GLASS.border}`,
  borderRadius: MAP_GLASS.radiusCard,
  boxShadow: MAP_GLASS.shadow,
  fontFamily: 'var(--font-sans)',
};

export default function MapKey({
  isMobile = false,
  vineyardTheme = 'ownership',
  onVineyardThemeChange,
  vineyardOutline = false,
  onVineyardOutlineChange,
  vineyardThemeValues,
  vineyardScope = 'all',
  activeLayer,
  onLayerChange,
  climateYear,
  onClimateYearChange,
  legendSelection = {},
  onLegendSelectionChange,
  topoRanges = {},
  onTopoRangeChange,
}) {
  const [open, setOpen] = useState(readOpen);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => { writeOpen(open); }, [open]);
  // A fresh layer choice closes the full list; the siblings row covers the next hop
  useEffect(() => { setPickerOpen(false); }, [activeLayer]);

  const theme = VINEYARD_THEMES[vineyardTheme] ?? VINEYARD_THEMES.ownership;
  const layerGroups = activeLayer ? legendGroupsFor(activeLayer) : [];
  const selected = activeLayer ? legendSelection[activeLayer] ?? [] : [];
  const range = activeLayer ? topoRanges[activeLayer] : null;
  const filterText = range ? topoRangeLabel(activeLayer, range) : describeLegendSelection(layerGroups, selected);
  const clearFilter = () => { onLegendSelectionChange?.(activeLayer, []); onTopoRangeChange?.(activeLayer, null); };
  const redundant = !!activeLayer && !vineyardOutline && THEME_MATCHING_LAYER[vineyardTheme] === activeLayer;

  const position = isMobile
    ? { top: 12, right: 12, alignItems: 'flex-end' }
    // bottom clears the basemap attribution line
    : { bottom: 36, right: 12, alignItems: 'flex-end' };

  if (!open) {
    return (
      <div style={{ position: 'absolute', zIndex: 25, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 'calc(100% - 24px)', ...position }}>
        <Pill onClick={() => setOpen(true)} label={`Map key: vineyards coloured by ${theme.short}, ${vineyardOutline ? 'outline' : 'filled'}. Open the map key.`}>
          <ThemeSwatches themeId={vineyardTheme} values={vineyardThemeValues} outline={vineyardOutline} />
          <span style={{ ...T.body, fontWeight: 650 }}>Vineyards</span>
          <span style={T.small}>{theme.short} · {vineyardOutline ? 'outline' : 'filled'}</span>
        </Pill>
        {activeLayer ? (
          <div style={{ ...CARD, borderRadius: MAP_GLASS.radiusPill, display: 'flex', alignItems: 'center', maxWidth: '100%' }}>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={`Background layer: ${layerLabel(activeLayer)}. Open the map key.`}
              className="tx-link"
              style={pillButton}
            >
              <Ramp groups={layerGroups} />
              <span style={{ ...T.body, fontWeight: 650, whiteSpace: 'nowrap' }}>{layerLabel(activeLayer)}</span>
              {filterText && <span style={{ ...T.small, color: interactive, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {filterText}</span>}
            </button>
            {/* Year stepping stays on the pill so the map remains visible while scrubbing */}
            {isVintageLayer(activeLayer) && <PillYearStepper year={climateYear} onChange={onClimateYearChange} />}
            <button
              type="button"
              onClick={() => onLayerChange?.(null)}
              aria-label={`Turn off ${layerLabel(activeLayer)}`}
              title="Turn off layer"
              className="tx-link"
              style={{ ...iconButton, marginRight: 4 }}
            >✕</button>
          </div>
        ) : (
          <Pill onClick={() => { setOpen(true); setPickerOpen(true); }} label="Add a background layer" quiet>
            <span style={{ ...T.small, color: ink }}>+ Add a layer</span>
          </Pill>
        )}
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Map key"
      style={{
        position: 'absolute', zIndex: 25, ...position,
        width: isMobile ? 'min(320px, calc(100% - 24px))' : 300,
        maxHeight: isMobile ? 'calc(100% - 24px)' : 'calc(100% - 52px)',
        overflowY: 'auto', overscrollBehavior: 'contain',
        ...CARD,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 8px 4px 14px', position: 'sticky', top: 0, background: MAP_GLASS.bgStrong, zIndex: 1 }}>
        <span style={{ ...T.body, fontWeight: 700 }}>On the map</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Collapse the map key" title="Collapse" className="tx-link" style={iconButton}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {/* ── Vineyards ─────────────────────────────────────────────── */}
      <Section label="Vineyards coloured by">
        <ChipRow>
          {Object.values(VINEYARD_THEMES).map((t) => (
            <Chip key={t.id} on={t.id === vineyardTheme} onClick={() => onVineyardThemeChange?.(t.id)} title={t.description}>{t.short}</Chip>
          ))}
        </ChipRow>
        <div role="group" aria-label="Vineyard style" style={{ display: 'flex', border: `1px solid ${border}`, borderRadius: 8, overflow: 'hidden', marginTop: 8 }}>
          {[{ id: false, label: 'Filled' }, { id: true, label: 'Outline only' }].map(({ id, label }) => {
            const on = vineyardOutline === id;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => onVineyardOutlineChange?.(id)}
                className={`tx-fill${on ? ' is-active' : ''}`}
                style={{
                  flex: 1, minHeight: isMobile ? 36 : 30, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--type-ui-label-size)', fontWeight: 600, background: parchment, color: ink,
                }}
              >{label}</button>
            );
          })}
        </div>
        {redundant && (
          <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: interactiveSoft, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ ...T.small, color: ink }}>
              The vineyards and the background layer both show {layerLabel(activeLayer).toLowerCase()}. Outline lets the layer show through the blocks.
            </span>
            <button type="button" onClick={() => onVineyardOutlineChange?.(true)} className="tx-link" style={{ ...linkButton, alignSelf: 'flex-start' }}>
              Switch to outline
            </button>
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <VineyardLegend themeId={vineyardTheme} values={vineyardThemeValues} outline={vineyardOutline} scope={vineyardScope} />
        </div>
      </Section>

      {/* ── Background layer ──────────────────────────────────────── */}
      <Section
        label="Background layer"
        action={(
          <button type="button" onClick={() => setPickerOpen((p) => !p)} aria-expanded={pickerOpen} className="tx-link" style={linkButton}>
            {pickerOpen ? 'Done' : activeLayer ? 'Change' : 'Add a layer'}
          </button>
        )}
      >
        {activeLayer ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...T.body, fontWeight: 650 }}>{layerLabel(activeLayer)}</div>
              <div style={T.small}>{layerSub(activeLayer)}</div>
            </div>
            <button type="button" onClick={() => onLayerChange?.(null)} className="tx-link" style={linkButton}>Turn off</button>
          </div>
        ) : (
          !pickerOpen && <div style={T.small}>None. Add climate, terrain, soil or bedrock under the vineyards.</div>
        )}

        {pickerOpen ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: activeLayer ? 10 : 0 }}>
            {LAYER_FAMILIES.map((f) => (
              <div key={f.id}>
                <div style={{ ...T.small, marginBottom: 4 }}>{f.label}</div>
                <ChipRow>
                  {f.ids.map((id) => (
                    <Chip key={id} on={id === activeLayer} onClick={() => onLayerChange?.(id)} title={layerSub(id)}>{layerLabel(id)}</Chip>
                  ))}
                </ChipRow>
              </div>
            ))}
          </div>
        ) : activeLayer && familyOf(activeLayer)?.ids.length > 1 && (
          <div style={{ marginTop: 8 }}>
            <ChipRow>
              {familyOf(activeLayer).ids.map((id) => (
                <Chip key={id} on={id === activeLayer} onClick={() => onLayerChange?.(id)} title={layerSub(id)}>{layerLabel(id)}</Chip>
              ))}
            </ChipRow>
          </div>
        )}

        {activeLayer && !pickerOpen && (
          <>
            {isVintageLayer(activeLayer) && <VintageStepper year={climateYear} onChange={onClimateYearChange} large={isMobile} />}
            {range ? (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ ...T.small, color: ink }}>Custom range: <strong style={{ fontWeight: 650 }}>{filterText}</strong></span>
                <button type="button" onClick={clearFilter} className="tx-link" style={linkButton}>Show all</button>
              </div>
            ) : layerGroups.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <LegendFilter
                  groups={layerGroups}
                  selected={selected}
                  onChange={(keys) => onLegendSelectionChange?.(activeLayer, keys)}
                />
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}

/* ─── Vineyard legend ─────────────────────────────────────────────────── */

function VineyardLegend({ themeId, values, outline, scope }) {
  if (themeId === 'ownership') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <LegendRow swatch={<span style={{ display: 'flex', gap: 1 }}>{VINEYARD_MEMBER_PALETTE.slice(0, 3).map((c) => <Swatch key={c} color={c} outline={outline} narrow />)}</span>}>
          WVWA member <span style={{ color: muted }}>· one colour each</span>
        </LegendRow>
        <LegendRow swatch={<Swatch color={VINEYARD_GREY} outline={outline} />}>Other named vineyard</LegendRow>
        <LegendRow swatch={<Swatch color={VINEYARD_WHITE} outline={outline} />}>Unnamed <span style={{ color: muted }}>· help us name it</span></LegendRow>
        <HighlightRows scope={scope} />
      </div>
    );
  }
  if (themeId === 'none') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <LegendRow swatch={<Swatch color={VINEYARD_THEMES.none.paint} outline={outline} />}>Every vineyard, one colour</LegendRow>
        <HighlightRows scope={scope} />
      </div>
    );
  }
  const { items, showNoData } = vineyardThemeLegend(themeId, values);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '5px 10px' }}>
        {items.map((it) => (
          <LegendRow key={it.label} swatch={<Swatch color={it.color} outline={outline} />}>{it.label}</LegendRow>
        ))}
        {showNoData && <LegendRow swatch={<Swatch color={NO_DATA_COLOR} outline={outline} />}><span style={{ color: muted }}>No data</span></LegendRow>}
      </div>
      <div style={{ ...T.small, marginTop: 6 }}>{VINEYARD_THEMES[themeId]?.description}</div>
    </div>
  );
}

// The two line colours that mean "this one", whatever the fill theme
function HighlightRows({ scope }) {
  return (
    <>
      <LegendRow swatch={<LineSwatch color={VINEYARD_HIGHLIGHT} />}>Hovered or open vineyard</LegendRow>
      {scope === 'winery' && <LegendRow swatch={<LineSwatch color={VINEYARD_OUTLINE_WHITE} edge />}>This winery&rsquo;s vineyards</LegendRow>}
    </>
  );
}

function ThemeSwatches({ themeId, values, outline }) {
  let colors;
  if (themeId === 'ownership') colors = [VINEYARD_MEMBER_PALETTE[0], VINEYARD_MEMBER_PALETTE[2], VINEYARD_GREY];
  else if (themeId === 'none') colors = [VINEYARD_THEMES.none.paint];
  else colors = vineyardThemeLegend(themeId, values).items.slice(0, 3).map((it) => it.color);
  return (
    <span aria-hidden="true" style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
      {colors.map((c) => <Swatch key={c} color={c} outline={outline} narrow />)}
    </span>
  );
}

/* ─── Background-layer pieces ─────────────────────────────────────────── */

// Colour ramp for the collapsed pill, sampled from the layer's legend rows
function Ramp({ groups }) {
  const colors = groups.flatMap((g) => g.rows.map((r) => r.color));
  if (!colors.length) return null;
  return (
    <span aria-hidden="true" style={{ display: 'flex', width: 34, height: 8, borderRadius: 2, overflow: 'hidden', flexShrink: 0, border: `1px solid ${border}` }}>
      {colors.map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}
    </span>
  );
}

function VintageStepper({ year, onChange, large }) {
  const { playing, step, setYear, togglePlay } = useVintagePlayback(year, onChange);
  const size = large ? 36 : 30;
  const btn = {
    width: size, height: size, borderRadius: 8, border: `1px solid ${border}`, background: parchment, color: ink,
    cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0,
    touchAction: 'manipulation',
  };
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button type="button" aria-label="Previous vintage" className="tx-box tx-link" style={btn} onClick={() => step(-1)} disabled={year <= VINTAGE_FIRST_YEAR}>‹</button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <span style={{ ...T.small, marginRight: 6 }}>Vintage</span>
          <span style={{ fontSize: 17, fontWeight: 700, color: ink, fontVariantNumeric: 'tabular-nums' }}>{year}</span>
        </div>
        <button type="button" aria-label="Next vintage" className="tx-box tx-link" style={btn} onClick={() => step(1)} disabled={year >= VINTAGE_LAST_YEAR}>›</button>
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play through every vintage'}
          aria-pressed={playing}
          className={`tx-fill${playing ? ' is-active' : ''}`}
          style={{ ...btn, fontSize: 12 }}
          onClick={togglePlay}
        >{playing ? '❚❚' : '▶'}</button>
      </div>
      <input
        type="range" min={VINTAGE_FIRST_YEAR} max={VINTAGE_LAST_YEAR} value={year}
        aria-label="Vintage year"
        onChange={(e) => setYear(Number(e.target.value))}
        style={{ width: '100%', accentColor: interactive, cursor: 'pointer', margin: '6px 0 0', height: large ? 28 : 20 }}
      />
    </div>
  );
}

function PillYearStepper({ year, onChange }) {
  const { playing, step, togglePlay } = useVintagePlayback(year, onChange);
  return (
    <span role="group" aria-label="Vintage shown on the map" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      <button type="button" aria-label="Previous vintage" className="tx-link" style={iconButton} onClick={() => step(-1)} disabled={year <= VINTAGE_FIRST_YEAR}>‹</button>
      <span style={{ ...T.body, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{year}</span>
      <button type="button" aria-label="Next vintage" className="tx-link" style={iconButton} onClick={() => step(1)} disabled={year >= VINTAGE_LAST_YEAR}>›</button>
      <button
        type="button"
        aria-label={playing ? 'Pause' : 'Play through every vintage'}
        aria-pressed={playing}
        className="tx-link"
        style={{ ...iconButton, fontSize: 11, color: playing ? interactive : muted }}
        onClick={togglePlay}
      >{playing ? '❚❚' : '▶'}</button>
    </span>
  );
}

/* ─── Small building blocks ───────────────────────────────────────────── */

const pillButton = {
  display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, minHeight: 36, padding: '6px 8px 6px 12px',
  border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)', color: ink,
  touchAction: 'manipulation',
};
const iconButton = {
  width: 30, height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', color: muted, fontSize: 13, padding: 0,
};
const linkButton = {
  border: 'none', background: 'none', padding: '2px 0', cursor: 'pointer', fontFamily: 'var(--font-sans)',
  fontSize: 'var(--type-ui-label-size)', fontWeight: 650, color: interactive, flexShrink: 0,
};

function Pill({ onClick, label, quiet = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="tx-box"
      style={{
        ...pillButton, ...CARD, padding: '6px 12px', borderRadius: MAP_GLASS.radiusPill, maxWidth: '100%',
        ...(quiet ? { background: alpha(TOKENS.parchment, 0.9) } : null),
      }}
    >{children}</button>
  );
}

function Section({ label, action, children }) {
  return (
    <div style={{ padding: '10px 14px 12px', borderTop: `1px solid ${border}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <span style={T.label}>{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function ChipRow({ children }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{children}</div>;
}

function Chip({ on, onClick, title, children }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={title}
      className={`tx-box${on ? ' is-active' : ''}`}
      style={{
        minHeight: 28, padding: '3px 10px', borderRadius: MAP_GLASS.radiusPill, cursor: 'pointer',
        border: `1px solid ${on ? interactive : border}`, background: on ? interactiveSoft : parchment,
        fontFamily: 'var(--font-sans)', fontSize: 'var(--type-ui-label-size)', fontWeight: on ? 650 : 500, color: ink,
        touchAction: 'manipulation',
      }}
    ><span className="tx-title">{children}</span></button>
  );
}

function LegendRow({ swatch, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
      {swatch}
      <span style={{ fontSize: 'var(--type-ui-label-size)', color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
    </div>
  );
}

// Outline mode draws the swatch as a ring, the way the blocks look on the map
function Swatch({ color, outline, narrow = false }) {
  return (
    <span style={{
      width: narrow ? 7 : 12, height: 12, borderRadius: narrow ? 2 : 3, flexShrink: 0, boxSizing: 'border-box',
      background: outline ? 'transparent' : color,
      border: outline ? `2px solid ${color}` : `1px solid ${alpha(TOKENS.ink, 0.12)}`,
    }} />
  );
}

function LineSwatch({ color, edge = false }) {
  return (
    <span style={{
      width: 12, height: 12, flexShrink: 0, borderRadius: 3, boxSizing: 'border-box',
      border: `2px solid ${color}`, boxShadow: edge ? `0 0 0 1px ${alpha(TOKENS.ink, 0.25)}` : 'none',
    }} />
  );
}
