/**
 * QueryBuilder — OWB's self-serve questions against a published release.
 *
 * A query is: which blocks (population), grouped by up to two fields,
 * narrowed by filters, shown as a summary table or a block list. The spec
 * lives in the URL (?q=…), so any result can be bookmarked or emailed, and
 * every result downloads as CSV. The server applies the same acreage rules as
 * the rest of the Data tab (services/contractQuery.js).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { alpha, crimson, ink, muted, TOKENS } from '@terranthro/shared/styles/tokens.js';
import { apiJson, apiUrl } from '@terranthro/shared/lib/api.js';

const DEFAULT_SPEC = { population: 'headline', group_by: ['ava'], filters: {}, mode: 'summary' };

const PRESETS = [
  { label: 'Acres by AVA', spec: { group_by: ['ava'] } },
  { label: 'Acres by county', spec: { group_by: ['county'] } },
  { label: 'Variety by AVA', spec: { group_by: ['ava', 'variety'] } },
  { label: 'Elevation profile', spec: { group_by: ['elevation_band'] } },
  { label: 'Soils by AVA', spec: { group_by: ['ava', 'soil_class'] } },
  { label: 'Block sizes by county', spec: { group_by: ['county', 'size_class'] } },
];

const small = { fontSize: 'var(--type-mono-size)', color: muted };
const acresFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat('en-US');
const pct = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

export default function QueryBuilder({ releaseId, initialSpec, onSpecChange }) {
  const [schema, setSchema] = useState(null);
  const [spec, setSpec] = useState(() => ({ ...DEFAULT_SPEC, ...(initialSpec || {}) }));
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSchema(null);
    apiJson(`/api/client/releases/${releaseId}/query/schema`).then(setSchema).catch((err) => setError(err.message));
  }, [releaseId]);

  const q = useMemo(() => JSON.stringify(spec), [spec]);
  useEffect(() => { onSpecChange?.(spec); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run the query whenever the spec changes (debounced while typing ranges).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      apiJson(`/api/client/releases/${releaseId}/query?q=${encodeURIComponent(q)}`)
        .then((r) => { if (!cancelled) { setResult(r); setError(''); } })
        .catch((err) => { if (!cancelled) setError(err.message); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [releaseId, q]);

  if (!schema) return error ? <p style={{ color: crimson }}>{error}</p> : <p style={small}>Loading…</p>;

  const dims = Object.fromEntries(schema.dimensions.map((d) => [d.key, d]));
  const ranges = Object.fromEntries(schema.ranges.map((r) => [r.key, r]));
  const update = (patch) => setSpec((s) => ({ ...s, ...patch }));
  const setFilter = (key, value) => setSpec((s) => {
    const filters = { ...s.filters };
    if (value == null) delete filters[key]; else filters[key] = value;
    return { ...s, filters };
  });
  const usesGrower = [...spec.group_by, ...Object.keys(spec.filters)].some((k) => dims[k]?.grower || ranges[k]?.grower);
  const csvHref = apiUrl(`/api/client/releases/${releaseId}/query?q=${encodeURIComponent(q)}&format=csv`);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt('Copy this link:', window.location.href);
    }
  }

  return (
    <div>
      {/* Presets */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={{ ...small, alignSelf: 'center', marginRight: 4 }}>Start from:</span>
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => setSpec({ ...DEFAULT_SPEC, ...p.spec })} className="tx-link" style={chip}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 12 }}>
        <Control label="Include">
          <select value={spec.population} onChange={(e) => update({ population: e.target.value })} style={select}>
            {schema.populations.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </Control>
        <Control label="Group by">
          <DimSelect dims={schema.dimensions} value={spec.group_by[0] || ''} placeholder="Nothing (totals only)"
            onChange={(v) => update({ group_by: v ? [v, ...spec.group_by.slice(1).filter((x) => x !== v)] : [], mode: 'summary' })} />
        </Control>
        <Control label="Then by">
          <DimSelect dims={schema.dimensions.filter((d) => d.key !== spec.group_by[0])} value={spec.group_by[1] || ''}
            placeholder="—" disabled={!spec.group_by[0]}
            onChange={(v) => update({ group_by: v ? [spec.group_by[0], v] : spec.group_by.slice(0, 1), mode: 'summary' })} />
        </Control>
        <Control label="Show">
          <select value={spec.mode} onChange={(e) => update({ mode: e.target.value })} style={select}>
            <option value="summary">Summary table</option>
            <option value="blocks">List of blocks</option>
          </select>
        </Control>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <span style={small}>Filters:</span>
        {Object.entries(spec.filters).map(([key, val]) => (
          dims[key] ? (
            <MultiSelect key={key} label={dims[key].label} options={schema.values[key] || []} value={val}
              onChange={(v) => setFilter(key, v)} onRemove={() => setFilter(key, null)} />
          ) : (
            <RangeFilter key={key} label={ranges[key].label} value={val}
              onChange={(v) => setFilter(key, v)} onRemove={() => setFilter(key, null)} />
          )
        ))}
        <AddFilter schema={schema} used={Object.keys(spec.filters)}
          onAdd={(key) => setFilter(key, dims[key] ? [] : { min: '', max: '' })} />
      </div>

      {error && <p style={{ color: crimson }}>{error}</p>}
      {result && <Result result={result} dims={dims} usesGrower={usesGrower} loading={loading} />}

      <div style={{ display: 'flex', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
        <a href={csvHref} className="tx-link" style={{ ...small, color: TOKENS.interactive }}>
          Download CSV{spec.mode === 'blocks' ? ' (all matching blocks)' : ''}
        </a>
        <button onClick={copyLink} className="tx-link" style={{ ...linkBtn, ...small, color: TOKENS.interactive }}>
          {copied ? 'Link copied' : 'Copy link to this query'}
        </button>
      </div>
    </div>
  );
}

// ─── Results ─────────────────────────────────────────────────────

function Result({ result, dims, usesGrower, loading }) {
  const { totals, spec } = result;
  const growerShare = pct(totals.grower_acres, totals.acres);
  return (
    <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s' }}>
      <p style={{ margin: '0 0 6px', fontSize: 'var(--type-body-size)' }}>
        <strong style={{ fontSize: 20 }}>{acresFmt.format(totals.acres)} acres</strong>{' '}
        in {intFmt.format(totals.blocks)} blocks across {intFmt.format(totals.vineyards)} vineyards.
      </p>
      <p style={{ ...small, margin: '0 0 12px' }}>
        Planting details (variety, clone, rootstock, planting year…) are on file for {acresFmt.format(totals.grower_acres)} of these acres ({growerShare}).
        {usesGrower && ' Blocks without them show as "Not reported" (nothing on file yet) or "Not shared" (details the grower entered and has not yet agreed to share).'}
        {result.overlapping && ' Grouping by AVA counts nested AVAs inside their parent too, so rows overlap.'}
      </p>

      {spec.mode === 'blocks'
        ? <BlockTable rows={result.blocks} truncated={result.truncated} total={totals.blocks} />
        : spec.group_by.length > 0 && <SummaryTable rows={result.rows} spec={spec} dims={dims} truncated={result.truncated} />}
    </div>
  );
}

function SummaryTable({ rows, spec, dims, truncated }) {
  const maxAcres = Math.max(1, ...rows.map((r) => r.acres));
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={table}>
        <thead>
          <tr>
            {spec.group_by.map((g) => <th key={g} style={th}>{dims[g].label}</th>)}
            <th style={{ ...th, ...right }}>Blocks</th>
            <th style={{ ...th, ...right }}>Vineyards</th>
            <th style={{ ...th, ...right, minWidth: 150 }}>Acres</th>
            <th style={{ ...th, ...right }}>Planting details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const repeat = spec.group_by.length === 2 && i > 0 && rows[i - 1].g0 === r.g0;
            return (
              <tr key={`${r.g0}|${r.g1 ?? ''}`}>
                <td style={{ ...td, color: repeat ? alpha(TOKENS.ink, 0.3) : ink }}>{r.g0}</td>
                {spec.group_by.length === 2 && <td style={td}>{r.g1}</td>}
                <td style={{ ...td, ...right }}>{intFmt.format(r.blocks)}</td>
                <td style={{ ...td, ...right }}>{intFmt.format(r.vineyards)}</td>
                <td style={{ ...td, ...right }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
                    <span aria-hidden style={{ flex: '0 1 80px', height: 6, borderRadius: 3, background: alpha(TOKENS.ink, 0.07), overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: '100%', width: `${(r.acres / maxAcres) * 100}%`, background: TOKENS.electricBlue }} />
                    </span>
                    {acresFmt.format(r.acres)}
                  </span>
                </td>
                <td style={{ ...td, ...right, color: muted }}>{pct(r.grower_acres, r.acres)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {truncated && <p style={small}>Showing the first 1,000 rows — download the CSV for the rest, or add a filter.</p>}
    </div>
  );
}

function BlockTable({ rows, truncated, total }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={table}>
        <thead>
          <tr>
            {['Vineyard', 'Block', 'Acres', 'County', 'AVAs', 'Elev. (ft)', 'Soil series', 'Variety', 'Clone', 'Planted'].map((h, i) => (
              <th key={h} style={{ ...th, ...([2, 5, 9].includes(i) ? right : {}) }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.block_id}>
              <td style={td}>{b.vineyard_name || 'Unnamed'}</td>
              <td style={td}>{b.block_name || '—'}</td>
              <td style={{ ...td, ...right }}>{acresFmt.format(b.acres)}</td>
              <td style={td}>{b.county_name || '—'}</td>
              <td style={{ ...td, maxWidth: 220 }}>{(b.ava_names || []).join(', ') || '—'}</td>
              <td style={{ ...td, ...right }}>{b.elevation_mean_ft == null ? '—' : intFmt.format(Math.round(b.elevation_mean_ft))}</td>
              <td style={td}>{b.soil_series || '—'}</td>
              <td style={{ ...td, color: b.grower_data ? ink : muted }}>{b.grower_data ? (b.variety || '—') : 'Not shared'}</td>
              <td style={td}>{b.grower_data ? (b.clone || '—') : ''}</td>
              <td style={{ ...td, ...right }}>{b.grower_data ? (b.year_planted || '—') : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && (
        <p style={small}>Showing {intFmt.format(rows.length)} of {intFmt.format(total)} blocks — the CSV has all of them, with every attribute.</p>
      )}
    </div>
  );
}

// ─── Controls ────────────────────────────────────────────────────

function Control({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ ...small, display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

function DimSelect({ dims, value, onChange, placeholder, disabled }) {
  const groups = [...new Set(dims.map((d) => d.group))];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={{ ...select, opacity: disabled ? 0.5 : 1 }}>
      <option value="">{placeholder}</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {dims.filter((d) => d.group === g).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function AddFilter({ schema, used, onAdd }) {
  const dims = schema.dimensions.filter((d) => !used.includes(d.key));
  const ranges = schema.ranges.filter((r) => !used.includes(r.key));
  const groups = [...new Set(dims.map((d) => d.group))];
  return (
    <select value="" onChange={(e) => e.target.value && onAdd(e.target.value)} style={{ ...select, width: 'auto' }} aria-label="Add a filter">
      <option value="">+ Add filter</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {dims.filter((d) => d.group === g).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </optgroup>
      ))}
      <optgroup label="Ranges">
        {ranges.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
      </optgroup>
    </select>
  );
}

/** A filter chip that opens a searchable checkbox list. */
function MultiSelect({ label, options, value, onChange, onRemove }) {
  const [open, setOpen] = useState(value.length === 0);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const labelOf = (v) => options.find((o) => o.value === v)?.label ?? v;
  const shown = options.filter((o) => String(o.label).toLowerCase().includes(search.toLowerCase())).slice(0, 300);
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const summary = value.length === 0 ? 'any' : value.length <= 2 ? value.map(labelOf).join(', ') : `${value.length} selected`;

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <span style={chipActive}>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ ...linkBtn, color: ink }}>
          {label}: <strong>{summary}</strong> ▾
        </button>
        <button onClick={onRemove} aria-label={`Remove ${label} filter`} style={{ ...linkBtn, color: muted, marginLeft: 6 }}>×</button>
      </span>
      {open && (
        <div style={popover}>
          <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`}
            style={{ ...select, marginBottom: 6 }} />
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {shown.map((o) => (
              <label key={o.value} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 2px', fontSize: 'var(--type-body-size)', cursor: 'pointer' }}>
                <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
                <span style={{ flex: 1 }}>{o.label}</span>
                <span style={small}>{intFmt.format(o.blocks)}</span>
              </label>
            ))}
            {shown.length === 0 && <p style={{ ...small, margin: 4 }}>No matches.</p>}
          </div>
        </div>
      )}
    </span>
  );
}

function RangeFilter({ label, value, onChange, onRemove }) {
  const input = { ...select, width: 80, padding: '3px 6px' };
  return (
    <span style={chipActive}>
      {label}
      <input aria-label={`${label} minimum`} inputMode="decimal" placeholder="min" value={value.min ?? ''}
        onChange={(e) => onChange({ ...value, min: e.target.value })} style={{ ...input, marginLeft: 6 }} />
      <span style={{ margin: '0 4px' }}>–</span>
      <input aria-label={`${label} maximum`} inputMode="decimal" placeholder="max" value={value.max ?? ''}
        onChange={(e) => onChange({ ...value, max: e.target.value })} style={input} />
      <button onClick={onRemove} aria-label={`Remove ${label} filter`} style={{ ...linkBtn, color: muted, marginLeft: 6 }}>×</button>
    </span>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const select = {
  width: '100%', boxSizing: 'border-box', padding: '7px 8px', borderRadius: 6,
  border: `1px solid ${alpha(TOKENS.ink, 0.25)}`, background: 'transparent', color: ink,
  font: 'inherit', fontSize: 'var(--type-body-size)',
};
const chip = {
  background: 'none', border: `1px solid ${alpha(TOKENS.ink, 0.2)}`, borderRadius: 14, padding: '4px 11px',
  font: 'inherit', fontSize: 'var(--type-mono-size)', color: ink, cursor: 'pointer',
};
const chipActive = {
  display: 'inline-flex', alignItems: 'center', border: `1px solid ${alpha(TOKENS.electricBlue, 0.45)}`,
  background: alpha(TOKENS.electricBlue, 0.07), borderRadius: 14, padding: '3px 10px',
  fontSize: 'var(--type-mono-size)', color: ink,
};
const popover = {
  position: 'absolute', top: '100%', left: 0, zIndex: 20, marginTop: 4, width: 280, padding: 8,
  background: 'var(--color-parchment)', border: `1px solid ${alpha(TOKENS.ink, 0.2)}`, borderRadius: 8,
  boxShadow: `0 6px 24px ${alpha(TOKENS.ink, 0.15)}`,
};
const linkBtn = { background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' };
const table = { width: '100%', borderCollapse: 'collapse' };
const th = { ...small, textAlign: 'left', fontWeight: 500, padding: '4px 12px 6px 0', whiteSpace: 'nowrap' };
const td = {
  fontSize: 'var(--type-body-size)', padding: '6px 12px 6px 0', borderTop: `1px solid ${alpha(TOKENS.ink, 0.07)}`,
  fontVariantNumeric: 'tabular-nums', verticalAlign: 'top',
};
const right = { textAlign: 'right' };
