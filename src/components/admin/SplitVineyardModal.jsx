/**
 * SplitVineyardModal
 *
 * Admin tool: reassign a subset of a vineyard's BLOCKS to new vineyard names
 * so that one big vineyard becomes 2+ smaller vineyards. E.g. "Shea Vineyard"
 * with 40 blocks → "Shea Vineyard - West Hill", "Shea Vineyard - East Hill".
 * Blocks given the same new name land in ONE new vineyard; footprints refresh
 * automatically (trg_vineyard_footprint).
 *
 * UX:
 *   - Lists every block as a row with a "New name" text input.
 *   - Quick-assign bar above: type a name + check the blocks you want it
 *     applied to + click Apply.
 *   - Submit posts to /api/admin/vineyards/:parcelId/split.
 */

import { useEffect, useMemo, useState } from 'react';
import { alpha, border, crimson, ink, muted, parchment, TOKENS } from '../../styles/tokens';
import { apiFetch } from '../../lib/api';

export default function SplitVineyardModal({
  parcelId,           // the vineyard id — used as the route parameter
  siblings,           // the vineyard's blocks: [{ id, vineyard_name, block_name, acres, source_dataset }]
  currentName,        // current vineyard name (for header copy)
  onClose,
  onApplied,          // called after successful split with { moved, new_vineyard_ids, source_deleted }
}) {
  // names keyed by parcel id
  const [names, setNames] = useState(() => {
    const m = {};
    siblings.forEach((s) => { m[s.id] = s.vineyard_name || ''; });
    return m;
  });
  const [selected, setSelected] = useState(() => new Set());
  const [bulkValue, setBulkValue] = useState('');
  const [status, setStatus] = useState(null); // null | 'submitting' | 'error'
  const [error, setError] = useState(null);

  // Re-seed if siblings change (parcel switched while modal closed).
  useEffect(() => {
    setNames(() => {
      const m = {};
      siblings.forEach((s) => { m[s.id] = s.vineyard_name || ''; });
      return m;
    });
    setSelected(new Set());
  }, [siblings]);

  const toggleSel = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(siblings.map((s) => s.id)));
  const selectNone = () => setSelected(new Set());

  const applyBulk = () => {
    if (!bulkValue.trim() || selected.size === 0) return;
    setNames((prev) => {
      const next = { ...prev };
      selected.forEach((id) => { next[id] = bulkValue; });
      return next;
    });
    setSelected(new Set());
  };

  // Distinct names that will exist after the split (for the preview).
  const grouped = useMemo(() => {
    const m = new Map();
    siblings.forEach((s) => {
      const n = (names[s.id] || '').trim() || '(unnamed)';
      if (!m.has(n)) m.set(n, []);
      m.get(n).push(s);
    });
    return m;
  }, [names, siblings]);

  // Count how many parcels actually changed name vs. their current value.
  const changedCount = siblings.reduce((acc, s) => {
    const before = (s.vineyard_name || '').trim();
    const after  = (names[s.id]   || '').trim();
    return acc + (before !== after ? 1 : 0);
  }, 0);

  async function handleSubmit() {
    if (changedCount === 0) return;
    setStatus('submitting');
    setError(null);
    try {
      const assignments = siblings
        .filter((s) => {
          const after = (names[s.id] || '').trim();
          return after && after !== (s.vineyard_name || '').trim();
        })
        .map((s) => ({ block_id: s.id, new_vineyard_name: (names[s.id] || '').trim() }));

      const res = await apiFetch(`/api/admin/vineyards/${parcelId}/split`, {
        method: 'POST',
        body: JSON.stringify({ assignments }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Server error');
      }
      const body = await res.json();
      onApplied?.(body);
    } catch (e) {
      setError(e.message || 'Failed to split');
      setStatus(null);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: alpha(ink, 0.55),
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: parchment,
          borderRadius: 12,
          width: 'min(900px, 100%)',
          maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: `0 20px 60px ${alpha(ink, 0.3)}`,
          fontFamily: 'var(--font-sans)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${border}` }}>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--type-subhead-size)',
            fontWeight: 600, color: ink,
            margin: '0 0 4px',
          }}>
            Split Vineyard
          </h2>
          <p style={{ color: muted, fontSize: 'var(--type-mono-size)', margin: 0 }}>
            {currentName ? `“${currentName}” currently spans ${siblings.length} blocks.` : `${siblings.length} blocks in this vineyard.`}
            {' '}Rename any subset to break the vineyard into multiple vineyards.
          </p>
        </div>

        {/* Quick-assign bar */}
        <div style={{
          padding: '14px 24px',
          background: alpha(ink, 0.03),
          borderBottom: `1px solid ${border}`,
          display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        }}>
          <input
            type="text"
            value={bulkValue}
            onChange={(e) => setBulkValue(e.target.value)}
            placeholder="New vineyard name…"
            style={{
              flex: '1 1 220px',
              padding: '8px 12px',
              border: `1px solid ${border}`,
              borderRadius: 6,
              background: parchment,
              color: ink,
              fontSize: 'var(--type-mono-size)',
              fontFamily: 'var(--font-sans)',
            }}
          />
          <button
            onClick={applyBulk}
            disabled={!bulkValue.trim() || selected.size === 0}
            style={{
              ...primaryBtn,
              opacity: (!bulkValue.trim() || selected.size === 0) ? 0.45 : 1,
              cursor: (!bulkValue.trim() || selected.size === 0) ? 'not-allowed' : 'pointer',
            }}
          >
            Apply to {selected.size} selected
          </button>
          <button onClick={selectAll} style={ghostBtn}>Select all</button>
          <button onClick={selectNone} style={ghostBtn}>Clear</button>
        </div>

        {/* Parcel list */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '0 24px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--type-mono-size)' }}>
            <thead style={{ position: 'sticky', top: 0, background: parchment }}>
              <tr>
                <th style={thStyle}>{/* checkbox */}</th>
                <th style={thStyle}>#</th>
                <th style={thStyle}>Block</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Acres</th>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>New Vineyard Name</th>
              </tr>
            </thead>
            <tbody>
              {siblings.map((s, i) => {
                const before = (s.vineyard_name || '').trim();
                const after  = (names[s.id]   || '').trim();
                const dirty  = before !== after;
                return (
                  <tr key={s.id} style={{
                    borderBottom: `1px solid ${alpha(border, 0.6)}`,
                    background: dirty ? alpha(TOKENS.amber, 0.08) : 'transparent',
                  }}>
                    <td style={tdStyle}>
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggleSel(s.id)}
                      />
                    </td>
                    <td style={{ ...tdStyle, color: muted }}>{i + 1}</td>
                    <td style={tdStyle}>
                      {s.block_name || <span style={{ color: muted, fontStyle: 'italic' }}>Block {s.id}</span>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: muted }}>
                      {s.acres ? Number(s.acres).toFixed(1) : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: muted }}>
                      {s.source_dataset || '—'}
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={names[s.id] || ''}
                        onChange={(e) => setNames((prev) => ({ ...prev, [s.id]: e.target.value }))}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          border: `1px solid ${dirty ? TOKENS.amber : border}`,
                          borderRadius: 4,
                          background: parchment,
                          color: ink,
                          fontSize: 'var(--type-mono-size)',
                          fontFamily: 'var(--font-sans)',
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Preview + Footer */}
        <div style={{
          borderTop: `1px solid ${border}`,
          padding: '14px 24px',
          background: alpha(ink, 0.02),
        }}>
          <p style={{
            fontSize: 'var(--type-ui-label-size)', color: muted,
            textTransform: 'uppercase', letterSpacing: '0.08em',
            margin: '0 0 8px', fontWeight: 600,
          }}>
            Preview · {grouped.size} vineyard{grouped.size !== 1 ? 's' : ''} after split
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {[...grouped.entries()].map(([name, ps]) => (
              <span key={name} style={{
                padding: '4px 10px',
                borderRadius: 12,
                background: alpha(TOKENS.amber, 0.15),
                color: ink,
                fontSize: 'var(--type-mono-size)',
              }}>
                {name} <span style={{ color: muted }}>· {ps.length}</span>
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <p style={{ margin: 0, color: muted, fontSize: 'var(--type-mono-size)' }}>
              {changedCount === 0
                ? 'No changes pending'
                : `${changedCount} block${changedCount !== 1 ? 's' : ''} will be reassigned`}
              {error && <span style={{ color: crimson, marginLeft: 12 }}>{error}</span>}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={ghostBtn}>Cancel</button>
              <button
                onClick={handleSubmit}
                disabled={changedCount === 0 || status === 'submitting'}
                style={{
                  ...primaryBtn,
                  background: ink,
                  opacity: (changedCount === 0 || status === 'submitting') ? 0.45 : 1,
                  cursor: (changedCount === 0 || status === 'submitting') ? 'not-allowed' : 'pointer',
                }}
              >
                {status === 'submitting' ? 'Splitting…' : 'Apply Split'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const thStyle = {
  textAlign: 'left',
  padding: '10px 8px',
  fontSize: 'var(--type-ui-label-size)',
  color: muted,
  fontWeight: 600,
  borderBottom: `1px solid ${border}`,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '8px',
  color: ink,
  verticalAlign: 'middle',
};

const primaryBtn = {
  padding: '7px 14px',
  borderRadius: 6,
  border: 'none',
  background: TOKENS.amber,
  color: ink,
  fontWeight: 600,
  fontSize: 'var(--type-mono-size)',
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const ghostBtn = {
  padding: '7px 14px',
  borderRadius: 6,
  border: `1px solid ${border}`,
  background: 'transparent',
  color: muted,
  fontSize: 'var(--type-mono-size)',
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
};
