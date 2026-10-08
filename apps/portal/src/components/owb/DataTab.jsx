/**
 * DataTab — OWB's report numbers and downloads.
 *
 * Vineyard figures come only from published releases: frozen snapshots of
 * the dataset tied to a delivered milestone, so a figure OWB cites never
 * moves. Statewide AVA context (climate normals, terrain, soils) is shown
 * from day one, before any vineyard data is delivered.
 */
import { useEffect, useState } from 'react';
import { alpha, crimson, ink, muted, TOKENS } from '@terranthro/shared/styles/tokens.js';
import { apiJson, apiUrl } from '@terranthro/shared/lib/api.js';
import { fmtDate } from '../../lib/contractFormat';

const line = alpha(TOKENS.ink, 0.15);
const card = { border: `1px solid ${line}`, borderRadius: 10, padding: '18px 18px', marginBottom: 20 };
const h2 = { fontSize: 'var(--type-display-italic-size)', fontFamily: 'var(--font-display)', fontWeight: 600, margin: 0 };
const small = { fontSize: 'var(--type-mono-size)', color: muted };
const acresFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat('en-US');
const ac = (v) => (v == null ? '—' : acresFmt.format(v));
const n = (v) => (v == null ? '—' : intFmt.format(v));

export default function DataTab({ data }) {
  const contractId = data.contract.id;
  const [releases, setReleases] = useState(null);
  const [releaseId, setReleaseId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiJson(`/api/client/contracts/${contractId}/releases`)
      .then((rs) => {
        setReleases(rs);
        if (rs.length) setReleaseId(rs[0].id);
      })
      .catch((err) => setError(err.message));
  }, [contractId]);

  const release = releases?.find((r) => r.id === releaseId);
  const nextDelivery = data.milestones.find((m) => m.number === 2);

  return (
    <>
      {error && <p style={{ color: crimson }}>{error}</p>}

      <section style={card}>
        <SectionHead title="Vineyard data">
          {releases?.length > 1 && (
            <label style={{ ...small, display: 'flex', gap: 8, alignItems: 'center' }}>
              Release
              <select value={releaseId ?? ''} onChange={(e) => setReleaseId(Number(e.target.value))} style={selectStyle}>
                {releases.map((r) => (
                  <option key={r.id} value={r.id}>{r.label} · {fmtDate(r.published_at)}</option>
                ))}
              </select>
            </label>
          )}
        </SectionHead>

        {!releases && !error && <p style={small}>Loading…</p>}
        {releases?.length === 0 && (
          <p style={{ margin: 0, lineHeight: 1.55, maxWidth: 680 }}>
            No vineyard data has been released yet. The first release comes with{' '}
            <strong>Milestone 2: Willamette Valley sub-AVAs</strong>
            {nextDelivery?.due_label && <> (target {nextDelivery.due_label})</>}. Each release is a frozen copy
            of the dataset as delivered, so the figures you cite from it will not change; corrections arrive
            as a new release.
          </p>
        )}
        {release && <ReleaseView release={release} />}
      </section>

      <AvaContext />
    </>
  );
}

// ─── A release ───────────────────────────────────────────────────

function ReleaseView({ release }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setStats(null);
    apiJson(`/api/client/releases/${release.id}/stats`).then(setStats).catch((err) => setError(err.message));
  }, [release.id]);

  const csv = (table) => apiUrl(`/api/client/releases/${release.id}/csv/${table}`);

  if (error) return <p style={{ color: crimson }}>{error}</p>;
  if (!stats) return <p style={small}>Loading…</p>;
  const s = stats.summary;

  return (
    <>
      <p style={{ ...small, margin: '0 0 14px' }}>
        <strong style={{ color: ink }}>{release.label}</strong> · published {fmtDate(release.published_at)}
        {s.imagery_years?.length > 0 && ` · OSIP ${s.imagery_years.join(', ')} imagery`}
      </p>
      {release.notes && <p style={{ margin: '0 0 14px', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{release.notes}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 6 }}>
        <Stat value={ac(s.headline_acres)} label="Vineyard acres (headline)" />
        <Stat value={n(s.headline_blocks)} label="Blocks in headline" />
        <Stat value={n(s.vineyards)} label="Vineyards" />
        {s.planted_acres != null && <Stat value={ac(s.planted_acres)} label="Planted acres" />}
        <Stat value={ac(s.removed_acres)} label="Removed acres" />
      </div>
      <p style={{ ...small, margin: '0 0 18px', lineHeight: 1.5 }}>
        Headline acres count standing blocks, excluding isolated blocks under 2 acres
        ({n(s.small_isolated_blocks)} blocks, {ac(s.small_isolated_acres)} ac), per the contract's inclusion standard.
        {s.needs_field > 0 && ` ${n(s.needs_field)} blocks are flagged for spring field verification.`}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        <TableCard
          title="Acres by AVA"
          note="Nested AVAs are counted in their parent too, so these do not sum to the total."
          csvHref={csv('by-ava')}
          columns={[['name', 'AVA'], ['blocks', 'Blocks', n], ['acres', 'Acres', ac]]}
          rows={stats.by_ava}
        />
        <TableCard
          title="Acres by county"
          csvHref={csv('by-county')}
          columns={[['county', 'County'], ['blocks', 'Blocks', n], ['acres', 'Acres', ac]]}
          rows={stats.by_county}
        />
        <TableCard
          title="Blocks by size"
          csvHref={csv('by-size-class')}
          columns={[['size_class', 'Size class'], ['blocks', 'Blocks', n], ['acres', 'Acres', ac]]}
          rows={stats.by_size_class}
        />
        <TableCard
          title="Change over time"
          note={stats.change.steps.length ? 'Planted and removed between OSIP imagery years.' : 'Historical change arrives with the historical-mapping milestones.'}
          csvHref={stats.change.steps.length ? csv('change') : null}
          columns={[
            ['period', 'Period'], ['planted_acres', 'Planted', ac], ['removed_acres', 'Removed', ac], ['net_acres', 'Net', ac],
          ]}
          rows={stats.change.steps.map((st) => ({ ...st, period: `${st.from}–${st.to}` }))}
        />
      </div>

      <div style={{ marginTop: 20, paddingTop: 14, borderTop: `1px solid ${line}` }}>
        <strong style={{ display: 'block', marginBottom: 6 }}>Download the full dataset</strong>
        <a href={csv('blocks')} className="tx-link" style={{ color: TOKENS.interactive }}>
          All {n(s.blocks)} blocks with their attributes (CSV)
        </a>
        <p style={{ ...small, margin: '6px 0 0' }}>
          One row per block: acreage, county, AVAs, status, size class, terrain, soils, bedrock and imagery
          observations. Need the boundaries in GIS? Ask for the GeoPackage.
        </p>
      </div>
    </>
  );
}

// ─── Statewide AVA context ───────────────────────────────────────

function AvaContext() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    apiJson('/api/client/ava-context').then(setRows).catch((err) => setError(err.message));
  }, []);

  const pctLabel = (v) => (v ? `${v.class} (${v.pct}%)` : '—');
  return (
    <section style={card}>
      <SectionHead title="Oregon AVAs at a glance">
        <a href={apiUrl('/api/client/ava-context?format=csv')} className="tx-link" style={{ ...small, color: TOKENS.interactive }}>
          Download CSV
        </a>
      </SectionHead>
      <p style={{ ...small, margin: '0 0 12px', lineHeight: 1.5 }}>
        Each AVA's Oregon land: PRISM 1991–2020 climate normals (growing season April–October), DOGAMI lidar
        terrain, SSURGO soils and Oregon geologic map bedrock. Covers the whole AVA, not only its vineyards.
      </p>
      {error && <p style={{ color: crimson }}>{error}</p>}
      {!rows && !error && <p style={small}>Loading…</p>}
      {rows && (
        <DataTable
          columns={[
            ['name', 'AVA'],
            ['oregon_acres', 'Oregon acres', n],
            ['gdd_normal', 'GDD (°F)', n],
            ['growing_season_temp_f', 'Season temp (°F)', (v) => (v ?? '—'), 'right'],
            ['growing_season_precip_in', 'Season rain (in)', (v) => (v ?? '—'), 'right'],
            ['elevation', 'Elevation (ft)', null, 'right'],
            ['soil', 'Dominant soil', pctLabel],
            ['bedrock', 'Dominant bedrock', pctLabel],
          ]}
          rows={rows.map((r) => ({
            ...r,
            elevation: r.elevation_min_ft == null ? '—' : `${n(r.elevation_min_ft)}–${n(r.elevation_max_ft)}`,
          }))}
        />
      )}
    </section>
  );
}

// ─── Bits ────────────────────────────────────────────────────────

function SectionHead({ title, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
      <h2 style={h2}>{title}</h2>
      {children}
    </div>
  );
}

function Stat({ value, label }) {
  return (
    <div>
      <div style={{ fontSize: 26, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={small}>{label}</div>
    </div>
  );
}

function TableCard({ title, note, csvHref, columns, rows }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <strong>{title}</strong>
        {csvHref && rows.length > 0 && (
          <a href={csvHref} className="tx-link" style={{ ...small, color: TOKENS.interactive }}>CSV</a>
        )}
      </div>
      {rows.length ? <DataTable columns={columns} rows={rows} /> : <p style={{ ...small, margin: 0 }}>Nothing yet.</p>}
      {note && <p style={{ ...small, margin: '6px 0 0' }}>{note}</p>}
    </div>
  );
}

function DataTable({ columns, rows }) {
  const th = { ...small, textAlign: 'left', fontWeight: 500, padding: '4px 10px 6px 0', whiteSpace: 'nowrap' };
  const td = {
    fontSize: 'var(--type-body-size)', padding: '6px 10px 6px 0', borderTop: `1px solid ${alpha(TOKENS.ink, 0.07)}`,
    fontVariantNumeric: 'tabular-nums', verticalAlign: 'top',
  };
  // Number columns (formatted with n / ac, or flagged 'right') align right.
  const numeric = (i) => [n, ac].includes(columns[i][2]) || columns[i][3] === 'right';
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map(([key, label], i) => (
              <th key={key} style={{ ...th, textAlign: numeric(i) ? 'right' : 'left' }}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r.slug ?? r.county ?? r.size_class ?? r.period ?? ri}>
              {columns.map(([key, , fmt], i) => (
                <td key={key} style={{ ...td, textAlign: numeric(i) ? 'right' : 'left' }}>
                  {fmt ? fmt(r[key]) : (r[key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const selectStyle = {
  padding: '5px 8px', borderRadius: 6, border: `1px solid ${alpha(TOKENS.ink, 0.25)}`,
  background: 'transparent', color: ink, font: 'inherit', fontSize: 'var(--type-mono-size)',
};
