/**
 * BulkBlockImport
 *
 * 3-step wizard:
 *   1. File pick + auto-parse (PapaParse)
 *   2. Column mapping (auto-detected; user adjusts unknown columns)
 *   3. Preview + apply (calls dry-run endpoint, then real apply / submit)
 *
 * Works in two modes via the `mode` prop:
 *   • mode="admin"  → calls /api/admin/wineries/:wineryId/blocks/bulk-apply (direct)
 *   • mode="portal" → calls /api/portal/blocks/bulk-preview, then submits an
 *                     edit_request of type 'vineyard_blocks_bulk' for review.
 *
 * Props:
 *   wineryId        {number}                — required for admin mode
 *   wineryTitle     {string}                — for the header
 *   parcelLabels    {Array<{label, blocks}>}— shown as a help panel
 *   mode            {'admin'|'portal'}
 *   onComplete      {fn}                    — called on success
 *   onClose         {fn}
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import Papa from 'papaparse';
import { apiFetch, apiJson } from '../lib/api';
import { alpha, border, crimson, ink, muted, parchment, success, warning, TOKENS } from '../styles/tokens';

const CANONICAL_FIELDS = [
  { key: 'block_name',    label: 'Block Name',          required: true,  hint: 'Matching key — must match an existing block to update' },
  { key: 'hill',          label: 'Hill (disambiguator)', hint: 'Used to pick the right parcel when block names repeat (e.g. Block 2 on East Hill vs Third Hill)' },
  { key: 'parcel_label',  label: 'Parcel Label',        hint: 'Only required when inserting brand-new blocks' },
  { key: 'variety',       label: 'Variety / Varietal' },
  { key: 'clone',         label: 'Clone' },
  { key: 'rootstock',     label: 'Rootstock' },
  { key: 'rows',          label: 'Rows' },
  { key: 'spacing',       label: 'Spacing' },
  { key: 'year_planted',  label: 'Year Planted' },
  { key: 'acres',         label: 'Acres' },
  { key: 'vines',         label: 'Vines' },
  { key: 'vines_per_acre', label: 'Vines / Acre' },
  { key: 'fruit_sold_to', label: 'Fruit Sold To (pipe-separated)' },
  { key: '__ignore__',    label: '— Ignore —' },
];

const HEADER_ALIASES = {
  hill:          'hill',             // Used as parcel disambiguator
  varietal:      'variety',
  varieties:     'variety',
  variety:       'variety',
  block:         'block_name',
  block_name:    'block_name',
  blockname:     'block_name',
  buyers:        'fruit_sold_to',
  fruit_sold_to: 'fruit_sold_to',
  shape_id:      '__ignore__',
};

function autoMap(headers) {
  const out = {};
  for (const h of headers) {
    const k = String(h || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (HEADER_ALIASES[k]) { out[h] = HEADER_ALIASES[k]; continue; }
    const direct = CANONICAL_FIELDS.find(f => f.key === k);
    if (direct) { out[h] = direct.key; continue; }
    out[h] = '__ignore__';
  }
  return out;
}

const tableTd = { padding: '6px 10px', borderBottom: `1px solid ${alpha(border, 0.5)}`, fontSize: 'var(--type-mono-size)' };
const tableTh = { ...tableTd, color: muted, fontWeight: 600, textAlign: 'left', fontSize: 'var(--type-ui-label-size)' };
const btnPrimary = {
  padding: '8px 16px', borderRadius: 6, border: 'none',
  background: crimson, color: parchment, cursor: 'pointer',
  fontFamily: 'var(--font-sans)', fontSize: 'var(--type-mono-size)', fontWeight: 600,
};
const btnGhost = { ...btnPrimary, background: 'transparent', color: ink, border: `1px solid ${border}` };

export default function BulkBlockImport({ wineryId, wineryTitle, parcelLabels = [], mode = 'admin', onComplete, onClose }) {
  const [step, setStep] = useState(1); // 1 file, 2 map, 3 preview
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [columnMap, setColumnMap] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [aliasingFor, setAliasingFor] = useState(null); // { name }
  const [aliasSuggestions, setAliasSuggestions] = useState([]);
  const [parcels, setParcels] = useState([]);
  const [parcelMap, setParcelMap] = useState({}); // csv value (raw) → parcel_label, '__skip__', or '' for unmapped
  const [rowParcelOverrides, setRowParcelOverrides] = useState({}); // 1-based rowNum → parcel_label or '__skip__'

  // Fetch winery parcels (admin mode) so we can offer a mapping UI
  useEffect(() => {
    if (mode !== 'admin' || !wineryId) return;
    let cancelled = false;
    apiJson(`/api/admin/wineries/${wineryId}/parcels`)
      .then(rows => { if (!cancelled && Array.isArray(rows)) setParcels(rows); })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [mode, wineryId]);

  // Restore saved mapping for this winery (v2 cache: schema changed when
  // hill became a disambiguator instead of parcel_label).
  useEffect(() => {
    if (!wineryId || headers.length === 0) return;
    try {
      const raw = localStorage.getItem(`bulkBlockMap:v2:${wineryId}`);
      if (raw) {
        const saved = JSON.parse(raw);
        const merged = { ...autoMap(headers) };
        for (const h of headers) if (saved[h]) merged[h] = saved[h];
        setColumnMap(merged);
      }
    } catch { /* ignore */ }
    try {
      const rawP = localStorage.getItem(`bulkBlockParcelMap:v2:${wineryId}`);
      if (rawP) setParcelMap(JSON.parse(rawP));
    } catch { /* ignore */ }
  }, [wineryId, headers]);

  // Distinct CSV values from whichever column maps to parcel_label
  // (only used for inserts; updates match by block_name).
  const distinctCsvParcelValues = useMemo(() => {
    const parcelHeader = headers.find(h => columnMap[h] === 'parcel_label');
    if (!parcelHeader) return [];
    const seen = new Set();
    const out = [];
    for (const r of rawRows) {
      const v = (r[parcelHeader] || '').toString().trim();
      if (!v) continue;
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }, [headers, columnMap, rawRows]);

  // Auto-seed parcelMap: exact case-insensitive match → parcel_label
  useEffect(() => {
    if (distinctCsvParcelValues.length === 0 || parcels.length === 0) return;
    setParcelMap(prev => {
      const next = { ...prev };
      for (const v of distinctCsvParcelValues) {
        if (next[v]) continue;
        const match = parcels.find(p => (p.vineyard_name || '').toLowerCase() === v.toLowerCase());
        if (match) next[v] = match.vineyard_name;
      }
      return next;
    });
  }, [distinctCsvParcelValues, parcels]);

  function handleFile(f) {
    setFile(f);
    setError(null);
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const fields = res.meta?.fields || [];
        setHeaders(fields);
        setRawRows(res.data);
        setColumnMap(autoMap(fields));
        setStep(2);
      },
      error: (err) => setError(err.message || 'CSV parse error'),
    });
  }

  const normalizedRows = useMemo(() => {
    return rawRows.map((row, idx) => {
      const out = {};
      for (const h of headers) {
        const dest = columnMap[h];
        if (!dest || dest === '__ignore__') continue;
        if (out[dest] == null || out[dest] === '') out[dest] = row[h];
      }
      // Apply parcel mapping override
      if (out.parcel_label) {
        const mapped = parcelMap[out.parcel_label.toString().trim()];
        if (mapped === '__skip__') {
          out.__skip__ = true;
        } else if (mapped) {
          out.parcel_label = mapped;
        }
      }
      // Per-row manual override (set from Step 3 UI for unmatched rows)
      const override = rowParcelOverrides[idx + 1];
      if (override === '__skip__') {
        out.__skip__ = true;
      } else if (override) {
        out.parcel_label = override;
      }
      return out;
    });
  }, [rawRows, headers, columnMap, parcelMap]);

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const url = mode === 'admin'
        ? `/api/admin/wineries/${wineryId}/blocks/bulk-apply`
        : `/api/portal/blocks/bulk-preview`;
      const res = await apiJson(url, {
        method: 'POST',
        body: JSON.stringify({ rows: normalizedRows, column_map: {}, dry_run: true }),
      });
      setPreview(res);
      setStep(3);
      // Save mapping for next time
      try {
        localStorage.setItem(`bulkBlockMap:v2:${wineryId || 'portal'}`, JSON.stringify(columnMap));
        localStorage.setItem(`bulkBlockParcelMap:v2:${wineryId || 'portal'}`, JSON.stringify(parcelMap));
      } catch { /* ignore */ }
    } catch (e) {
      setError(e.message || 'Preview failed');
    } finally {
      setBusy(false);
    }
  }

  async function applyForReal() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'admin') {
        const res = await apiJson(`/api/admin/wineries/${wineryId}/blocks/bulk-apply`, {
          method: 'POST',
          body: JSON.stringify({ rows: normalizedRows, column_map: {}, dry_run: false }),
        });
        onComplete?.(res);
      } else {
        // Portal: submit as edit request
        const res = await apiJson('/api/portal/requests', {
          method: 'POST',
          body: JSON.stringify({
            request_type: 'vineyard_blocks_bulk',
            payload: { rows: normalizedRows, column_map: {}, filename: file?.name || null },
          }),
        });
        onComplete?.(res);
      }
    } catch (e) {
      setError(e.message || 'Apply failed');
    } finally {
      setBusy(false);
    }
  }

  // ── Inline alias picker ────────────────────────────────────────────
  async function lookupSuggestions(name) {
    setAliasingFor({ name });
    try {
      const res = await apiJson(`/api/admin/buyer-name-suggestions?name=${encodeURIComponent(name)}`);
      setAliasSuggestions(res);
    } catch {
      setAliasSuggestions([]);
    }
  }
  async function attachAlias(targetWineryId) {
    if (!aliasingFor) return;
    try {
      await apiJson(`/api/admin/wineries/${targetWineryId}/aliases`, {
        method: 'POST',
        body: JSON.stringify({ alias: aliasingFor.name }),
      });
      setAliasingFor(null);
      setAliasSuggestions([]);
      // Re-run preview so the buyer is now linked
      runPreview();
    } catch (e) {
      setError(e.message);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div style={{ background: parchment, padding: 20, borderRadius: 12, border: `1px solid ${border}`, fontFamily: 'var(--font-sans)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--type-display-italic-size)', color: ink }}>
          Bulk Import Blocks {wineryTitle ? `· ${wineryTitle}` : ''}
        </h2>
        {onClose && (
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, fontSize: 20 }}>×</button>
        )}
      </div>

      <Stepper step={step} />

      {error && (
        <div style={{ background: alpha(crimson, 0.08), color: crimson, padding: 10, borderRadius: 6, margin: '8px 0', fontSize: 'var(--type-mono-size)' }}>
          {error}
        </div>
      )}

      {step === 1 && (
        <Step1 onFile={handleFile} parcelLabels={parcelLabels} />
      )}

      {step === 2 && (
        <Step2
          headers={headers}
          columnMap={columnMap}
          onChange={(h, v) => setColumnMap(m => ({ ...m, [h]: v }))}
          onBack={() => setStep(1)}
          onNext={runPreview}
          busy={busy}
          rowsCount={rawRows.length}
          parcels={parcels}
          parcelMap={parcelMap}
          distinctCsvParcelValues={distinctCsvParcelValues}
          onParcelMapChange={(v, label) => setParcelMap(m => ({ ...m, [v]: label }))}
        />
      )}

      {step === 3 && preview && (
        <Step3
          preview={preview}
          mode={mode}
          onBack={() => setStep(2)}
          onApply={applyForReal}
          busy={busy}
          onAliasClick={mode === 'admin' ? lookupSuggestions : null}
          parcels={parcels}
          rawRows={rawRows}
          headers={headers}
          columnMap={columnMap}
          rowParcelOverrides={rowParcelOverrides}
          onRowOverrideChange={(rowNum, val) => setRowParcelOverrides(o => ({ ...o, [rowNum]: val }))}
          onRecheck={runPreview}
        />
      )}

      {aliasingFor && (
        <AliasModal
          name={aliasingFor.name}
          suggestions={aliasSuggestions}
          onPick={attachAlias}
          onClose={() => { setAliasingFor(null); setAliasSuggestions([]); }}
        />
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function Stepper({ step }) {
  const steps = ['1. Upload CSV', '2. Map Columns', '3. Preview & Apply'];
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      {steps.map((s, i) => (
        <div key={s} style={{
          padding: '4px 10px', borderRadius: 4,
          background: i + 1 === step ? alpha(crimson, 0.12) : alpha(ink, 0.04),
          color: i + 1 === step ? crimson : muted,
          fontSize: 'var(--type-ui-label-size)', fontWeight: 600,
        }}>{s}</div>
      ))}
    </div>
  );
}

function Step1({ onFile, parcelLabels }) {
  return (
    <div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
        style={{
          border: `2px dashed ${border}`, borderRadius: 8, padding: 32, textAlign: 'center',
          background: alpha(ink, 0.02),
        }}
      >
        <p style={{ color: muted, margin: '0 0 12px' }}>Drop a CSV file here, or:</p>
        <label style={{ ...btnPrimary, display: 'inline-block', cursor: 'pointer' }}>
          Choose File
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => { const f = e.target.files[0]; if (f) onFile(f); }}
            style={{ display: 'none' }}
          />
        </label>
        <p style={{ marginTop: 12 }}>
          <a href="/blocks_template.csv" download style={{ color: TOKENS.electricBlue, fontSize: 'var(--type-mono-size)' }}>
            Download CSV template ↓
          </a>
        </p>
      </div>

      {parcelLabels.length > 0 && (
        <details style={{ marginTop: 16, fontSize: 'var(--type-mono-size)', color: muted }}>
          <summary style={{ cursor: 'pointer' }}>Available parcel labels ({parcelLabels.length})</summary>
          <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
            {parcelLabels.map(p => (
              <li key={p.id}>
                <strong>{p.vineyard_name || '(unnamed)'}</strong>
                {p.block_count > 0 ? ` (${p.block_count} blocks)` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Step2({
  headers, columnMap, onChange, onBack, onNext, busy, rowsCount,
  parcels = [], parcelMap = {}, distinctCsvParcelValues = [], onParcelMapChange,
}) {
  const showParcelMap = parcels.length > 0 && distinctCsvParcelValues.length > 0;
  const unmappedCount = distinctCsvParcelValues.filter(v => {
    const m = parcelMap[v];
    return !m || m === '';
  }).length;

  return (
    <div>
      <p style={{ color: muted, fontSize: 'var(--type-mono-size)' }}>
        {rowsCount} rows parsed. Confirm how each CSV column maps to a Terranthro field.
      </p>
      <div style={{ maxHeight: 280, overflowY: 'auto', border: `1px solid ${border}`, borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr><th style={tableTh}>CSV Column</th><th style={tableTh}>→ Field</th></tr>
          </thead>
          <tbody>
            {headers.map(h => (
              <tr key={h}>
                <td style={tableTd}><code>{h}</code></td>
                <td style={tableTd}>
                  <select
                    value={columnMap[h] || '__ignore__'}
                    onChange={(e) => onChange(h, e.target.value)}
                    style={{ padding: '4px 6px', fontSize: 'var(--type-mono-size)' }}
                  >
                    {CANONICAL_FIELDS.map(f => (
                      <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showParcelMap && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
            <h4 style={{ margin: 0, fontSize: 'var(--type-mono-size)', color: ink }}>
              Map CSV parcel values → winery parcels <span style={{ fontWeight: 400, color: muted }}>(only used for new blocks)</span>
            </h4>
            <span style={{ fontSize: 'var(--type-ui-label-size)', color: unmappedCount > 0 ? warning : muted }}>
              {unmappedCount > 0 ? `${unmappedCount} unmapped` : 'All mapped ✓'}
            </span>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: 'var(--type-ui-label-size)', color: muted }}>
            Existing blocks are matched by name and updated in place — no parcel needed.
            These mappings are only used when inserting brand-new blocks.
          </p>
          <div style={{ border: `1px solid ${border}`, borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr><th style={tableTh}>CSV Value</th><th style={tableTh}>→ Winery Parcel</th></tr>
              </thead>
              <tbody>
                {distinctCsvParcelValues.map(v => (
                  <tr key={v}>
                    <td style={tableTd}><code>{v}</code></td>
                    <td style={tableTd}>
                      <select
                        value={parcelMap[v] || ''}
                        onChange={(e) => onParcelMapChange(v, e.target.value)}
                        style={{ padding: '4px 6px', fontSize: 'var(--type-mono-size)', minWidth: 280 }}
                      >
                        <option value="">— Unmapped (will error) —</option>
                        <option value="__skip__">⊘ Skip rows with this value</option>
                        {parcels.map(p => (
                          <option key={p.id} value={p.vineyard_name || ''}>
                            {p.vineyard_name || '(unnamed)'}
                            {p.block_count > 0 ? ` · ${p.block_count} blocks` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={onBack} style={btnGhost}>← Back</button>
        <button onClick={onNext} disabled={busy} style={btnPrimary}>{busy ? 'Computing preview…' : 'Preview Changes →'}</button>
      </div>
    </div>
  );
}

function Step3({
  preview, mode, onBack, onApply, busy, onAliasClick,
  parcels = [], rawRows = [], headers = [], columnMap = {},
  rowParcelOverrides = {}, onRowOverrideChange, onRecheck,
}) {
  const { summary, errors, unlinked_buyers, flagged_parcels, per_parcel } = preview;
  const totalChanges = summary.updated + summary.inserted;

  // Errors that look like they're "no parcel found" — eligible for manual linking.
  const linkableErrors = errors.filter(e =>
    /no parcel/i.test(e.message)
    || /requires a parcel_label/i.test(e.message)
    || /exists in multiple parcels/i.test(e.message)
  );
  const otherErrors = errors.filter(e => !linkableErrors.includes(e));

  // Helper: pluck CSV row context for display
  function rowContext(rowNum) {
    const raw = rawRows[rowNum - 1] || {};
    const blockHeader = headers.find(h => columnMap[h] === 'block_name');
    const hillHeader  = headers.find(h => columnMap[h] === 'hill');
    return {
      block: blockHeader ? raw[blockHeader] : '',
      hill:  hillHeader  ? raw[hillHeader]  : '',
    };
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <Stat label="Updated" value={summary.updated} />
        <Stat label="Inserted" value={summary.inserted} tone="success" />
        <Stat label="Skipped" value={summary.skipped} tone={summary.skipped > 0 ? 'warning' : null} />
        <Stat label="Buyers linked" value={summary.buyer_links_added} />
        <Stat label="Buyers removed" value={summary.buyer_links_removed} />
        <Stat label="Parcels touched" value={summary.parcels_touched} />
      </div>

      {flagged_parcels.length > 0 && (
        <Section title={`⚠ Flagged: acreage change ≥ 5%`} tone="warning">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--type-mono-size)' }}>
            {flagged_parcels.map(f => (
              <li key={f.parcel_id}>
                Parcel #{f.parcel_id}: {Number(f.before_acres).toFixed(1)} → {Number(f.after_acres).toFixed(1)} acres ({f.pct_change}%)
              </li>
            ))}
          </ul>
        </Section>
      )}

      {per_parcel.length > 0 && (
        <Section title="Per-parcel breakdown">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={tableTh}>Parcel</th><th style={tableTh}>Updated</th><th style={tableTh}>Inserted</th></tr></thead>
            <tbody>
              {per_parcel.map(p => (
                <tr key={p.parcel_id}>
                  <td style={tableTd}>{p.vineyard_name || `#${p.parcel_id}`}</td>
                  <td style={tableTd}>{p.updated}</td>
                  <td style={tableTd}>{p.inserted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {unlinked_buyers.length > 0 && (
        <Section title={`Unlinked buyer names (${unlinked_buyers.length})`} tone="warning">
          <p style={{ margin: '0 0 8px', fontSize: 'var(--type-mono-size)', color: muted }}>
            These buyer names didn't match any winery in our database. They'll be saved as raw text but won't link.
            {onAliasClick && ' Click "Link…" to map a name to an existing winery.'}
          </p>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {unlinked_buyers.map(b => (
              <li key={b.name} style={{
                background: alpha(warning, 0.1), padding: '3px 8px', borderRadius: 4,
                fontSize: 'var(--type-mono-size)', display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
                {b.name} <span style={{ color: muted }}>×{b.count}</span>
                {onAliasClick && (
                  <button onClick={() => onAliasClick(b.name)} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: TOKENS.electricBlue, fontSize: 'var(--type-ui-label-size)',
                  }}>Link…</button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {linkableErrors.length > 0 && (
        <Section title={`Manually link ${linkableErrors.length} unmatched row${linkableErrors.length === 1 ? '' : 's'}`} tone="warning">
          <p style={{ margin: '0 0 8px', fontSize: 'var(--type-ui-label-size)', color: muted }}>
            These rows could not be auto-matched to a parcel. Pick a target parcel for each
            (or skip it), then click <strong>Re-check</strong> to validate.
          </p>
          <div style={{ maxHeight: 320, overflowY: 'auto', border: `1px solid ${border}`, borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={tableTh}>Row</th>
                  <th style={tableTh}>Block</th>
                  <th style={tableTh}>Hill</th>
                  <th style={tableTh}>→ Target parcel</th>
                </tr>
              </thead>
              <tbody>
                {linkableErrors.map(e => {
                  const ctx = rowContext(e.row);
                  return (
                    <tr key={e.row}>
                      <td style={tableTd}>{e.row}</td>
                      <td style={tableTd}><code>{ctx.block}</code></td>
                      <td style={tableTd}>{ctx.hill}</td>
                      <td style={tableTd}>
                        <select
                          value={rowParcelOverrides[e.row] || ''}
                          onChange={(ev) => onRowOverrideChange(e.row, ev.target.value)}
                          style={{ padding: '4px 6px', fontSize: 'var(--type-mono-size)', minWidth: 280 }}
                        >
                          <option value="">— Pick a vineyard —</option>
                          <option value="__skip__">⊘ Skip this row</option>
                          {parcels.map(p => (
                            <option key={p.id} value={p.vineyard_name || ''}>
                              {p.vineyard_name || '(unnamed)'}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {onRecheck && (
            <div style={{ marginTop: 8 }}>
              <button onClick={onRecheck} disabled={busy} style={btnGhost}>
                {busy ? 'Re-checking…' : '↻ Re-check with selections'}
              </button>
            </div>
          )}
        </Section>
      )}

      {otherErrors.length > 0 && (
        <Section title={`Other row errors (${otherErrors.length})`} tone="warning">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--type-mono-size)', maxHeight: 200, overflowY: 'auto' }}>
            {otherErrors.map((e, i) => (
              <li key={i}>Row {e.row}: {e.message}</li>
            ))}
          </ul>
        </Section>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={onBack} style={btnGhost}>← Back</button>
        <button onClick={onApply} disabled={busy || totalChanges === 0} style={btnPrimary}>
          {busy
            ? (mode === 'admin' ? 'Applying…' : 'Submitting…')
            : (mode === 'admin' ? `Apply ${totalChanges} changes` : `Submit ${totalChanges} changes for review`)}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const color = tone === 'success' ? success : tone === 'warning' ? warning : ink;
  return (
    <div style={{ minWidth: 100 }}>
      <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 'var(--type-display-italic-size)', color, fontFamily: 'var(--font-display)' }}>{value}</div>
    </div>
  );
}

function Section({ title, tone, children }) {
  const accent = tone === 'warning' ? warning : ink;
  return (
    <div style={{ marginBottom: 12, padding: 12, border: `1px solid ${alpha(accent, 0.2)}`, borderRadius: 6, background: alpha(accent, 0.03) }}>
      <h4 style={{ margin: '0 0 8px', fontSize: 'var(--type-mono-size)', color: accent, fontWeight: 700 }}>{title}</h4>
      {children}
    </div>
  );
}

function AliasModal({ name, suggestions, onPick, onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: alpha(ink, 0.4), zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: parchment, padding: 20, borderRadius: 8, minWidth: 360,
        maxWidth: 480,
      }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px', fontSize: 'var(--type-mono-size)', color: ink }}>
          Link &ldquo;{name}&rdquo; to a winery
        </h3>
        {suggestions.length === 0 ? (
          <p style={{ color: muted, fontSize: 'var(--type-mono-size)' }}>No matching wineries found.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 320, overflowY: 'auto' }}>
            {suggestions.map(w => (
              <li key={w.id} style={{ padding: '6px 0', borderBottom: `1px solid ${alpha(border, 0.3)}` }}>
                <button onClick={() => onPick(w.id)} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: ink, fontSize: 'var(--type-mono-size)', textAlign: 'left', width: '100%',
                }}>{w.title}</button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
