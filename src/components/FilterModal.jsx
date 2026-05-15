/**
 * FilterModal — query the vineyard catalog by topography & viticulture.
 *
 * Opened from the SearchBar filter button. Edits a *draft* copy of the
 * filter state and only commits on Apply, so partial slider drags don't
 * thrash the network.
 */
import { useEffect, useMemo, useState } from 'react';
import { WV_SUB_AVAS } from '../config/topographyConfig';
import { alpha, border, crimson, ink, parchment, TOKENS, TYPE } from '../styles/tokens';
import {
  ASPECT_BUCKETS,
  EMPTY_FILTERS,
  activeFilterCount,
  hasActiveFilters,
} from '../lib/useVineyardFilters';

const API_BASE = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const API_HEADERS = import.meta.env.VITE_INTERNAL_API_KEY
  ? { 'x-api-key': import.meta.env.VITE_INTERNAL_API_KEY }
  : {};

const TEXT_PRIMARY = TOKENS.parchment;
const TEXT_MUTED   = alpha(TOKENS.parchment, 0.6);
const TEXT_FAINT   = alpha(TOKENS.parchment, 0.4);
const SECTION_BORDER = alpha(TOKENS.parchment, 0.1);
const CHIP_IDLE_BG     = alpha(TOKENS.parchment, 0.06);
const CHIP_IDLE_BORDER = alpha(TOKENS.parchment, 0.18);
const CHIP_ACTIVE_BG     = alpha(TOKENS.crimson, 0.22);
const CHIP_ACTIVE_BORDER = alpha(TOKENS.crimson, 0.7);
const SCRIM_BG = alpha(TOKENS.ink, 0.55);

// Hard fallback ranges; replaced by /api/vineyards/filter-ranges when loaded.
const FALLBACK_RANGES = {
  elevation_ft: { min: 0,   max: 1500 },
  slope_deg:    { min: 0,   max: 30 },
  acres:        { min: 0,   max: 100 },
};

function fmtFt(v)   { return `${Math.round(v).toLocaleString()} ft`; }
function fmtDeg(v)  { return `${Math.round(v * 10) / 10}°`; }
function fmtAcres(v){ return `${Math.round(v * 10) / 10} ac`; }

/* ─── Section heading ──────────────────────────────────────────────── */
function SectionHeading({ children }) {
  return (
    <div style={{
      ...TYPE.uiLabel,
      fontSize: 'var(--type-ui-label-size)',
      color: TEXT_MUTED,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

/* ─── Range slider with two number inputs ──────────────────────────── */
function RangeControl({ label, range, lo, hi, onChange, format, step = 1 }) {
  const min = range.min;
  const max = range.max;
  const safeLo = lo == null ? min : lo;
  const safeHi = hi == null ? max : hi;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: 6,
        fontSize: 'var(--type-body-size)',
        color: TEXT_PRIMARY,
        fontWeight: 600,
      }}>
        <span>{label}</span>
        <span style={{ color: TEXT_MUTED, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
          {format(safeLo)} – {format(safeHi)}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="number"
          value={lo == null ? '' : lo}
          placeholder={String(min)}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value);
            onChange(v, hi);
          }}
          style={inputStyle}
        />
        <span style={{ color: TEXT_FAINT }}>–</span>
        <input
          type="number"
          value={hi == null ? '' : hi}
          placeholder={String(max)}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value);
            onChange(lo, v);
          }}
          style={inputStyle}
        />
      </div>
    </div>
  );
}

const inputStyle = {
  flex: 1,
  background: alpha(TOKENS.parchment, 0.04),
  border: `1px solid ${alpha(TOKENS.parchment, 0.16)}`,
  borderRadius: 6,
  color: TEXT_PRIMARY,
  padding: '6px 8px',
  fontSize: 'var(--type-mono-size)',
  fontFamily: 'var(--font-mono)',
  outline: 'none',
};

/* ─── Multi-select chip group ──────────────────────────────────────── */
function ChipGroup({ options, selected, onToggle, getKey = (o) => o, getLabel = (o) => o }) {
  const sel = new Set(selected);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((opt) => {
        const key = getKey(opt);
        const active = sel.has(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            style={{
              padding: '5px 11px',
              borderRadius: 16,
              border: `1px solid ${active ? CHIP_ACTIVE_BORDER : CHIP_IDLE_BORDER}`,
              background: active ? CHIP_ACTIVE_BG : CHIP_IDLE_BG,
              color: active ? TEXT_PRIMARY : TEXT_MUTED,
              fontSize: 'var(--type-ui-label-size)',
              fontWeight: 600,
              cursor: 'pointer',
              outline: 'none',
              transition: 'all 0.12s',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {getLabel(opt)}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Aspect compass selector (8 buttons in 3×3 grid) ──────────────── */
function AspectGrid({ selected, onToggle }) {
  const sel = new Set(selected);
  // Layout in a 3x3 with center empty
  const layout = [
    ['NW', 'N',  'NE'],
    ['W',  null, 'E' ],
    ['SW', 'S',  'SE'],
  ];
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 6,
      maxWidth: 200,
    }}>
      {layout.flat().map((dir, i) => {
        if (!dir) {
          return <div key={i} style={{ pointerEvents: 'none' }} />;
        }
        const active = sel.has(dir);
        return (
          <button
            key={dir}
            type="button"
            onClick={() => onToggle(dir)}
            style={{
              padding: '10px 0',
              borderRadius: 8,
              border: `1px solid ${active ? CHIP_ACTIVE_BORDER : CHIP_IDLE_BORDER}`,
              background: active ? CHIP_ACTIVE_BG : CHIP_IDLE_BG,
              color: active ? TEXT_PRIMARY : TEXT_MUTED,
              fontSize: 'var(--type-body-size)',
              fontWeight: 700,
              cursor: 'pointer',
              outline: 'none',
              transition: 'all 0.12s',
              letterSpacing: '0.04em',
            }}
          >
            {dir}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Modal shell ──────────────────────────────────────────────────── */
export default function FilterModal({
  open,
  onClose,
  filters,
  onApply,
  onReset,
  // Optional: live result shown in the footer if user has filters already applied
  liveResultSummary, // { wineries: number, parcels: number } | null
}) {
  const [draft, setDraft] = useState(filters || EMPTY_FILTERS);
  const [ranges, setRanges] = useState(FALLBACK_RANGES);
  const [varieties, setVarieties] = useState([]);
  const [varietiesLoaded, setVarietiesLoaded] = useState(false);

  // Re-sync draft each time the modal opens
  useEffect(() => {
    if (open) setDraft(filters || EMPTY_FILTERS);
  }, [open, filters]);

  // Lazy-load filter ranges + varieties the first time the modal opens
  useEffect(() => {
    if (!open || varietiesLoaded) return;
    let cancelled = false;

    fetch(`${API_BASE}/api/vineyards/filter-ranges`, { headers: API_HEADERS })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled && data) setRanges({
          elevation_ft: data.elevation_ft || FALLBACK_RANGES.elevation_ft,
          slope_deg:    data.slope_deg    || FALLBACK_RANGES.slope_deg,
          acres:        data.acres        || FALLBACK_RANGES.acres,
        });
      })
      .catch(() => {});

    fetch(`${API_BASE}/api/vineyards/varieties`, { headers: API_HEADERS })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        const list = Array.isArray(data?.varieties) ? data.varieties : [];
        setVarieties(list);
        setVarietiesLoaded(true);
      })
      .catch(() => setVarietiesLoaded(true));

    return () => { cancelled = true; };
  }, [open, varietiesLoaded]);

  // Top 12 varieties for the chip picker; rest accessible via the freeform input
  const topVarieties = useMemo(
    () => varieties.slice(0, 12).map(v => v.name),
    [varieties]
  );

  const draftActive  = hasActiveFilters(draft);
  const draftCount   = activeFilterCount(draft);

  if (!open) return null;

  const handleAspectToggle = (dir) => {
    setDraft(d => {
      const cur = new Set(d.aspects || []);
      if (cur.has(dir)) cur.delete(dir); else cur.add(dir);
      return { ...d, aspects: ASPECT_BUCKETS.filter(a => cur.has(a)) };
    });
  };

  const handleVarietyToggle = (name) => {
    setDraft(d => ({ ...d, variety: d.variety === name ? null : name }));
  };

  const handleApply = () => {
    onApply(draft);
    onClose();
  };

  const handleReset = () => {
    setDraft(EMPTY_FILTERS);
    onReset();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Filter vineyards"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        background: SCRIM_BG,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 'clamp(20px, 6vh, 80px) 16px',
        backdropFilter: 'blur(4px)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{
        background: TOKENS.surface,
        border: `1px solid ${border}`,
        borderRadius: 12,
        boxShadow: `0 24px 60px ${alpha(TOKENS.ink, 0.6)}`,
        width: 'min(560px, 100%)',
        maxHeight: 'min(85vh, 760px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: TEXT_PRIMARY,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: `1px solid ${SECTION_BORDER}`,
          flexShrink: 0,
        }}>
          <div>
            <div style={{
              fontSize: 'var(--type-display-italic-size)',
              fontWeight: 700,
              color: TEXT_PRIMARY,
              fontFamily: 'var(--font-display)',
            }}>
              Filter Vineyards
            </div>
            <div style={{ fontSize: 'var(--type-ui-label-size)', color: TEXT_MUTED, marginTop: 2 }}>
              Wineries appear if any of their parcels match
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              color: TEXT_MUTED,
              fontSize: 24,
              lineHeight: 1,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 18px',
        }}>
          {/* Topography */}
          <SectionHeading>Topography</SectionHeading>
          <RangeControl
            label="Elevation"
            range={ranges.elevation_ft}
            lo={draft.elevation_min}
            hi={draft.elevation_max}
            format={fmtFt}
            step={50}
            onChange={(lo, hi) => setDraft(d => ({ ...d, elevation_min: lo, elevation_max: hi }))}
          />
          <RangeControl
            label="Slope"
            range={ranges.slope_deg}
            lo={draft.slope_min}
            hi={draft.slope_max}
            format={fmtDeg}
            step={0.5}
            onChange={(lo, hi) => setDraft(d => ({ ...d, slope_min: lo, slope_max: hi }))}
          />
          <div style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 6,
              fontSize: 'var(--type-body-size)',
              color: TEXT_PRIMARY,
              fontWeight: 600,
            }}>
              <span>Aspect</span>
              <span style={{ color: TEXT_MUTED, fontWeight: 500 }}>
                {(draft.aspects || []).length === 0 ? 'Any' : (draft.aspects || []).join(', ')}
              </span>
            </div>
            <AspectGrid selected={draft.aspects || []} onToggle={handleAspectToggle} />
          </div>

          {/* Viticulture */}
          <div style={{
            paddingTop: 14,
            marginTop: 8,
            borderTop: `1px solid ${SECTION_BORDER}`,
          }}>
            <SectionHeading>Viticulture</SectionHeading>
            <div style={{ marginBottom: 12 }}>
              <div style={{
                fontSize: 'var(--type-body-size)',
                color: TEXT_PRIMARY,
                fontWeight: 600,
                marginBottom: 8,
              }}>
                Variety {draft.variety ? <span style={{ color: TEXT_MUTED, fontWeight: 500 }}>· {draft.variety}</span> : null}
              </div>
              {topVarieties.length > 0 ? (
                <ChipGroup
                  options={topVarieties}
                  selected={draft.variety ? [draft.variety] : []}
                  onToggle={handleVarietyToggle}
                />
              ) : (
                <div style={{ fontSize: 'var(--type-ui-label-size)', color: TEXT_FAINT }}>
                  Loading varieties…
                </div>
              )}
              {/* Freeform fallback for less common varieties */}
              <input
                type="text"
                placeholder="Or type a variety name…"
                value={draft.variety && !topVarieties.includes(draft.variety) ? draft.variety : ''}
                onChange={(e) => setDraft(d => ({ ...d, variety: e.target.value || null }))}
                style={{ ...inputStyle, marginTop: 8, width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <RangeControl
              label="Parcel Acres"
              range={ranges.acres}
              lo={draft.acres_min}
              hi={draft.acres_max}
              format={fmtAcres}
              step={1}
              onChange={(lo, hi) => setDraft(d => ({ ...d, acres_min: lo, acres_max: hi }))}
            />
          </div>

          {/* Location */}
          <div style={{
            paddingTop: 14,
            marginTop: 8,
            borderTop: `1px solid ${SECTION_BORDER}`,
          }}>
            <SectionHeading>AVA</SectionHeading>
            <select
              value={draft.ava || ''}
              onChange={(e) => setDraft(d => ({ ...d, ava: e.target.value || null }))}
              style={{
                ...inputStyle,
                width: '100%',
                boxSizing: 'border-box',
                appearance: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              <option value="">Any AVA</option>
              {WV_SUB_AVAS.map(a => (
                <option key={a.slug} value={a.name}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 18px',
          borderTop: `1px solid ${SECTION_BORDER}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexShrink: 0,
          background: alpha(TOKENS.ink, 0.3),
        }}>
          <div style={{ fontSize: 'var(--type-ui-label-size)', color: TEXT_MUTED }}>
            {draftActive
              ? `${draftCount} filter${draftCount === 1 ? '' : 's'} active`
              : 'No filters'}
            {liveResultSummary && draftActive ? (
              <span style={{ marginLeft: 6, color: TEXT_FAINT }}>
                · current results: {liveResultSummary.wineries} wineries / {liveResultSummary.parcels} parcels
              </span>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={handleReset}
              style={{
                background: 'transparent',
                border: `1px solid ${alpha(TOKENS.parchment, 0.2)}`,
                borderRadius: 6,
                color: TEXT_MUTED,
                padding: '7px 14px',
                fontSize: 'var(--type-body-size)',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={handleApply}
              style={{
                background: TOKENS.crimson,
                border: `1px solid ${TOKENS.crimson}`,
                borderRadius: 6,
                color: 'white',
                padding: '7px 18px',
                fontSize: 'var(--type-body-size)',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                letterSpacing: '0.02em',
              }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
