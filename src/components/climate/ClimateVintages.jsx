import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, ComposedChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { alpha, TOKENS, TYPE } from '../../styles/tokens';
import { apiJson } from '../../lib/api';
import TerroirDataChips from '../TerroirDataChips';

/**
 * Vintage climate for an AVA or a vineyard, from GET /api/climate/:type/:key/vintages
 * (PRISM 800m monthly, 1991 onward). Full mode: vintage + baseline pickers, a
 * growing-season GDD headline, season tiles, monthly temperature and precipitation
 * charts (separate charts — never a dual axis) and the vintage stripes. Compact
 * mode (vineyard cards): headline + stripes only.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEASON_ORDER = ['dormant', 'spring', 'summer', 'harvest'];
const SEASON_SHORT = { dormant: 'Dormant · Nov–Feb', spring: 'Spring · Mar–May', summer: 'Summer · Jun–Aug', harvest: 'Harvest · Sep–Oct' };

// Diverging cool ↔ warm ramp (blue / red arms, neutral midpoint) for GDD anomaly bins
const STRIPE_COLORS = ['#184f95', '#2a78d6', '#6da7ec', '#b7d3f6', '#d6d1c7', '#f4c1b8', '#ec8a7c', '#e34948', '#a8231f'];
const STRIPE_EDGES = [-350, -250, -150, -50, 50, 150, 250, 350]; // °F·days
function stripeColor(anom) {
  if (anom == null) return 'transparent';
  let i = 0;
  while (i < STRIPE_EDGES.length && anom > STRIPE_EDGES[i]) i++;
  return STRIPE_COLORS[i];
}

const fmtInt = (v) => (v == null ? '—' : Math.round(v).toLocaleString());
const signed = (v, digits = 1, unit = '') => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}${unit}`);
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

function palette(variant) {
  const glass = variant === 'glass';
  return {
    text:    glass ? alpha(TOKENS.parchment, 0.92) : TOKENS.ink,
    sub:     glass ? alpha(TOKENS.parchment, 0.58) : TOKENS.muted,
    line:    glass ? alpha(TOKENS.parchment, 0.14) : alpha(TOKENS.ink, 0.12),
    grid:    glass ? alpha(TOKENS.parchment, 0.08) : alpha(TOKENS.ink, 0.08),
    tileBg:  glass ? alpha(TOKENS.parchment, 0.05) : alpha(TOKENS.ink, 0.03),
    vintage: TOKENS.crimson,
    base:    glass ? alpha(TOKENS.parchment, 0.6) : TOKENS.muted,
  };
}

function useVintages(type, entityKey) {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    if (!entityKey) return undefined;
    let cancelled = false;
    setState({ data: null, error: null });
    apiJson(`/api/climate/${type}/${entityKey}/vintages`)
      .then((d) => { if (!cancelled) setState({ data: d, error: null }); })
      .catch((e) => { if (!cancelled) setState({ data: null, error: e }); });
    return () => { cancelled = true; };
  }, [type, entityKey]);
  return state;
}

function VintageStripes({ data, baseline, year, onSelect, colors }) {
  const [hover, setHover] = useState(null);
  const shown = hover ?? data.vintages.find((v) => v.year === year);
  const bl = data.baselines[baseline];
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, height: 28 }} onMouseLeave={() => setHover(null)}>
        {data.vintages.filter((v) => v.gdd != null).map((v) => {
          const selected = v.year === year;
          return (
            <button
              key={v.year}
              type="button"
              aria-label={`${v.year}: ${fmtInt(v.gdd)} GDD, ${signed(v.anomaly[baseline].gdd, 0)} vs ${bl.label}`}
              onMouseEnter={() => setHover(v)}
              onFocus={() => setHover(v)}
              onClick={() => onSelect?.(v.year)}
              style={{
                flex: 1, minWidth: 0, padding: 0, border: 'none', cursor: onSelect ? 'pointer' : 'default',
                borderRadius: 2, background: stripeColor(v.anomaly[baseline].gdd),
                outline: selected ? `2px solid ${colors.text}` : 'none', outlineOffset: 1,
                opacity: v.provisional ? 0.55 : 1,
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--type-ui-label-size)', color: colors.sub, marginTop: 4 }}>
        <span>{data.vintages[0]?.year}</span>
        <span style={{ color: colors.text }}>
          {shown ? `${shown.year}: ${fmtInt(shown.gdd)} GDD (${signed(shown.anomaly[baseline].gdd, 0)})` : ''}
        </span>
        <span>{data.vintages[data.vintages.length - 1]?.year}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--type-ui-label-size)', color: colors.sub, marginTop: 4 }}>
        <span>Cooler</span>
        <span style={{ display: 'flex', gap: 1 }}>
          {STRIPE_COLORS.map((c) => <span key={c} style={{ width: 10, height: 6, background: c, borderRadius: 1 }} />)}
        </span>
        <span>Warmer than {bl.label}</span>
      </div>
    </div>
  );
}

function Headline({ v, data, baseline, colors, compact }) {
  if (!v) return null;
  const bl = data.baselines[baseline];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: compact ? 20 : 30, fontWeight: 700, color: colors.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
          {fmtInt(v.gdd)}
        </span>
        <span style={{ fontSize: 'var(--type-ui-label-size)', color: colors.sub }}>GDD · {v.year} growing season</span>
        {v.provisional && (
          <span style={{ fontSize: 'var(--type-ui-label-size)', color: colors.sub, border: `1px solid ${colors.line}`, borderRadius: 4, padding: '0 5px' }}>provisional</span>
        )}
      </div>
      <div style={{ fontSize: 'var(--type-ui-label-size)', color: colors.sub, marginTop: 3, lineHeight: 1.5 }}>
        <span style={{ color: colors.text }}>{v.winkler_region}</span>
        {' · '}{signed(v.anomaly[baseline].gdd, 0)} vs {bl.label} ({fmtInt(bl.gdd)})
        {v.gdd_rank != null && <>{' · '}{ordinal(v.gdd_rank)} warmest of {data.ranked_count}</>}
      </div>
    </div>
  );
}

function SeasonTiles({ v, baseline, variant }) {
  const chips = SEASON_ORDER.map((s) => {
    const sv = v.seasons[s];
    const an = v.anomaly[baseline].seasons[s];
    return {
      label: SEASON_SHORT[s],
      value: sv ? `${sv.tmean.toFixed(1)}°F` : '—',
      subValue: sv
        ? `${signed(an?.tmean, 1, '°')} · ${sv.ppt.toFixed(1)} in rain${an?.ppt_pct == null ? '' : ` (${an.ppt_pct > 0 ? '+' : ''}${an.ppt_pct}%)`}`
        : null,
      tone: an?.tmean > 0.3 ? 'amber' : an?.tmean < -0.3 ? 'blue' : 'parchment',
      glow: false,
    };
  });
  return <TerroirDataChips chips={chips} columns={2} variant={variant === 'glass' ? 'glass' : 'light'} />;
}

function ChartTooltip({ active, payload, label, unit, digits, colors }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: TOKENS.parchment, border: `1px solid ${alpha(TOKENS.ink, 0.15)}`, borderRadius: 6, padding: '6px 9px', fontSize: 12, color: TOKENS.ink }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{label}</div>
      {payload.filter((p) => p.value != null).map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <span style={{ color: TOKENS.muted }}>{p.name}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(p.value).toFixed(digits)}{unit}</span>
        </div>
      ))}
    </div>
  );
}

function MonthlyCharts({ v, data, baseline, colors }) {
  const bl = data.baselines[baseline];
  const rows = MONTHS.map((m, i) => ({
    month: m,
    tVintage: v.monthly[i].tmean, tBase: bl.monthly[i].tmean,
    pVintage: v.monthly[i].ppt, pBase: bl.monthly[i].ppt,
  }));
  const axis = { fontSize: 10, fill: colors.sub };
  // Round the temperature axis to whole 5°F steps rather than raw data ends
  const temps = rows.flatMap((r) => [r.tVintage, r.tBase]).filter((x) => x != null);
  const tDomain = temps.length
    ? [Math.floor((Math.min(...temps) - 2) / 5) * 5, Math.ceil((Math.max(...temps) + 2) / 5) * 5]
    : [30, 80];
  const tTicks = [];
  for (let t = tDomain[0]; t <= tDomain[1]; t += 10) tTicks.push(t);
  const common = { margin: { top: 6, right: 6, bottom: 0, left: -18 } };
  const legendStyle = { fontSize: 11, color: colors.sub };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ ...TYPE.uiLabel, color: colors.sub, marginBottom: 2 }}>Mean temperature by month (°F)</div>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={rows} {...common}>
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis dataKey="month" tick={axis} tickLine={false} axisLine={{ stroke: colors.line }} interval={1} />
            <YAxis tick={axis} tickLine={false} axisLine={false} domain={tDomain} ticks={tTicks} allowDecimals={false} />
            <Tooltip content={<ChartTooltip unit="°F" digits={1} colors={colors} />} />
            <Legend wrapperStyle={legendStyle} iconSize={10} />
            <Line type="monotone" dataKey="tBase" name={bl.label} stroke={colors.base} strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="tVintage" name={String(v.year)} stroke={colors.vintage} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div>
        <div style={{ ...TYPE.uiLabel, color: colors.sub, marginBottom: 2 }}>Precipitation by month (in)</div>
        <ResponsiveContainer width="100%" height={140}>
          <ComposedChart data={rows} {...common}>
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis dataKey="month" tick={axis} tickLine={false} axisLine={{ stroke: colors.line }} interval={1} />
            <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip content={<ChartTooltip unit=" in" digits={2} colors={colors} />} cursor={{ fill: colors.grid }} />
            <Legend wrapperStyle={legendStyle} iconSize={10} />
            <Bar dataKey="pVintage" name={String(v.year)} fill={colors.vintage} radius={[3, 3, 0, 0]} maxBarSize={12} isAnimationActive={false} />
            <Line type="monotone" dataKey="pBase" name={bl.label} stroke={colors.base} strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function ClimateVintages({ type = 'ava', entityKey, variant = 'light', compact = false }) {
  const { data, error } = useVintages(type, entityKey);
  const colors = palette(variant);
  const [baseline, setBaseline] = useState('normal');
  const [year, setYear] = useState(null);

  // Default to the latest complete (non-provisional) vintage
  const defaultYear = useMemo(() => {
    const done = data?.vintages.filter((v) => v.gdd != null && !v.provisional) ?? [];
    return done.length ? done[done.length - 1].year : data?.vintages.at(-1)?.year ?? null;
  }, [data]);
  const activeYear = year ?? defaultYear;
  const v = data?.vintages.find((x) => x.year === activeYear);

  if (error) return null;
  if (!data || !v) {
    return <div style={{ fontSize: 'var(--type-ui-label-size)', color: colors.sub }}>Loading climate…</div>;
  }

  if (compact) {
    const bl = data.baselines[baseline];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <TerroirDataChips
          variant={variant === 'glass' ? 'glass' : 'light'}
          columns={2}
          chips={[
            {
              label: `GDD ${v.year}`,
              value: fmtInt(v.gdd),
              subValue: `${v.winkler_region}${v.provisional ? ' · provisional' : ''}`,
              tone: 'amber', glow: true,
            },
            {
              label: `vs ${bl.from}–${bl.to}`,
              value: signed(v.anomaly[baseline].gdd, 0),
              subValue: v.gdd_rank != null ? `${ordinal(v.gdd_rank)} warmest of ${data.ranked_count}` : null,
              tone: 'parchment', glow: false,
            },
          ]}
        />
        <VintageStripes data={data} baseline={baseline} year={activeYear} onSelect={setYear} colors={colors} />
      </div>
    );
  }

  const selectStyle = {
    fontSize: 'var(--type-ui-label-size)', color: colors.text, background: 'transparent',
    border: `1px solid ${colors.line}`, borderRadius: 6, padding: '3px 6px', fontFamily: 'var(--font-sans)',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select aria-label="Vintage" value={activeYear} onChange={(e) => setYear(Number(e.target.value))} style={selectStyle}>
          {[...data.vintages].reverse().map((x) => (
            <option key={x.year} value={x.year}>{x.year}{x.provisional ? ' (provisional)' : ''}</option>
          ))}
        </select>
        <span style={{ fontSize: 'var(--type-ui-label-size)', color: colors.sub }}>vs</span>
        <div role="group" aria-label="Baseline" style={{ display: 'flex', border: `1px solid ${colors.line}`, borderRadius: 6, overflow: 'hidden' }}>
          {Object.entries(data.baselines).map(([k, b]) => (
            <button
              key={k}
              type="button"
              onClick={() => setBaseline(k)}
              aria-pressed={baseline === k}
              style={{
                fontSize: 'var(--type-ui-label-size)', padding: '3px 8px', border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                background: baseline === k ? colors.text : 'transparent',
                color: baseline === k ? (variant === 'glass' ? TOKENS.ink : TOKENS.parchment) : colors.sub,
              }}
            >
              {b.from}–{b.to}
            </button>
          ))}
        </div>
      </div>

      <Headline v={v} data={data} baseline={baseline} colors={colors} />
      <SeasonTiles v={v} baseline={baseline} variant={variant} />
      <MonthlyCharts v={v} data={data} baseline={baseline} colors={colors} />

      <div>
        <div style={{ ...TYPE.uiLabel, color: colors.sub, marginBottom: 6 }}>Every vintage since {data.vintages[0]?.year} — click to compare</div>
        <VintageStripes data={data} baseline={baseline} year={activeYear} onSelect={setYear} colors={colors} />
      </div>

      <div style={{ fontSize: 'var(--type-ui-label-size)', color: colors.sub, lineHeight: 1.5 }}>
        PRISM Climate Group, Oregon State University (800 m monthly). GDD = growing degree days above 50°F, Apr–Oct,
        estimated from monthly means; Winkler regions per Jones et al. (2010).
      </div>
    </div>
  );
}
