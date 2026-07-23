/**
 * EditableBlocksTable
 *
 * Block list for a single vineyard, with two distinct presentations:
 *
 *   READ MODE  → a compact table. Only the essential columns (Block, Variety,
 *                Planted, Acres) show; the rest (Clone, Rootstock, Rows, Vines,
 *                Spacing), per-block terroir, and Notes live in an expandable
 *                per-row detail panel. Never scrolls horizontally.
 *
 *   EDIT MODE  → one labelled card per block (no shared table header, so there's
 *                no ambiguity about what's editable). Every field has its own
 *                label; Acres and terroir are shown read-only.
 *
 * Editing is controlled by the `editMode` prop (the parent owns the Edit button).
 * Submitting sends a single `vineyard_blocks` request with only the changed rows
 * (or applies directly on the admin path).
 *
 * Props:
 *   parcelId, blocks, editMode, selectedBlockId, onRowSelect,
 *   onEditCancel, onEditComplete, onSubmit, onDirectApply, allowDelete
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiPost } from '../lib/api';
import { alpha, border, crimson, electricBlue, ink, muted, parchment, TOKENS, TYPE } from '../styles/tokens';

const NOTES_MAX = 500;

const UI = {
  dirtyRowBg: alpha(TOKENS.crimson, 0.04),
  dirtyCardBg: alpha(TOKENS.crimson, 0.03),
  selectedRowBg: alpha(electricBlue, 0.10),
  hoverRowBg: alpha(electricBlue, 0.06),
  successText: TOKENS.success,
  borderFaded: (color) => alpha(color, 0.09),
  borderVeryFaded: (color) => alpha(color, 0.25),
};

// All editable/derived block fields. In READ mode every field is a table column
// (the table scrolls horizontally); in EDIT mode every field is a labelled card
// input. `acres` is read-only (auto-computed from block geometry).
const COLUMNS = [
  { key: 'block_name',   label: 'Block Name',      type: 'text' },
  { key: 'variety',      label: 'Variety',         type: 'text' },
  { key: 'year_planted', label: 'Year Planted',    type: 'number' },
  { key: 'acres',        label: 'Acres',           type: 'number', readonly: true },
  { key: 'clone',        label: 'Clone',           type: 'text' },
  { key: 'rootstock',    label: 'Rootstock',       type: 'text' },
  { key: 'trellis',      label: 'Trellis',         type: 'text' },
  { key: 'rows',         label: 'Number of Rows',  type: 'number' },
  { key: 'vines',        label: 'Number of Vines', type: 'number' },
  { key: 'spacing',      label: 'Spacing',         type: 'text' },
];

// Read-only terroir stat columns appended to the read-mode table (from block.topo).
const TERROIR_COLUMNS = [
  { key: 'elevation', label: 'Elevation', get: (t) => (t?.elevation_mean_ft != null ? `${Math.round(Number(t.elevation_mean_ft))} ft` : '') },
  { key: 'slope',     label: 'Slope',     get: (t) => (t?.slope_mean_deg != null ? `${Number(t.slope_mean_deg).toFixed(1)}°` : '') },
  { key: 'aspect',    label: 'Aspect',    get: (t) => (t?.aspect_bucket || (t?.aspect_dominant_deg != null && Number(t.aspect_dominant_deg) >= 0 ? `${Math.round(Number(t.aspect_dominant_deg))}°` : '')) },
];

function rowKey(b) { return b.id; }

function blockToStr(b) {
  const acc = COLUMNS.reduce((acc, col) => {
    acc[col.key] = b[col.key] != null ? String(b[col.key]) : '';
    return acc;
  }, {});
  acc.notes = b.notes != null ? String(b.notes) : '';
  return acc;
}

function hasChanged(original, edited) {
  const colChanged = COLUMNS.some((col) => {
    if (col.readonly) return false;
    return (original[col.key] != null ? String(original[col.key]) : '') !== edited[col.key];
  });
  const noteChanged = (original.notes != null ? String(original.notes) : '') !== (edited.notes ?? '');
  return colChanged || noteChanged;
}

let _tmpSeq = 0;
function newBlankRow() {
  return COLUMNS.reduce((acc, col) => { acc[col.key] = ''; return acc; }, { _tmpId: `new_${++_tmpSeq}`, notes: '' });
}

// Format a block's terroir stats into a compact one-line summary.
function fmtTopo(topo) {
  if (!topo) return null;
  const parts = [];
  if (topo.elevation_mean_ft != null) parts.push(`${Math.round(Number(topo.elevation_mean_ft))} ft`);
  if (topo.slope_mean_deg != null) parts.push(`${Number(topo.slope_mean_deg).toFixed(1)}° slope`);
  if (topo.aspect_bucket) parts.push(`${topo.aspect_bucket} aspect`);
  else if (topo.aspect_dominant_deg != null && Number(topo.aspect_dominant_deg) >= 0) parts.push(`${Math.round(Number(topo.aspect_dominant_deg))}° aspect`);
  return parts.length ? parts.join(' · ') : null;
}

export default function EditableBlocksTable({
  parcelId,
  blocks,
  editMode = false,
  selectedBlockId = null,
  onRowSelect,
  onEditCancel,
  onEditComplete,
  onSubmit,
  onDirectApply,
  allowDelete = false,
  // When true, the portal applies these edits immediately (no admin review) —
  // adjusts button/footer copy accordingly.
  autoApply = false,
}) {
  const [hoveredRow, setHoveredRow] = useState(null);
  // editMap: {blockId: {col: value, ...}} — only tracks dirty existing rows
  const [editMap, setEditMap] = useState({});
  const [newRows, setNewRows] = useState([]);
  const [deletedIds, setDeletedIds] = useState([]);
  const [status, setStatus] = useState(null); // null | 'submitting' | 'success' | 'error'
  // Row DOM refs so a map-driven selection can scroll the matching row into view.
  const rowRefs = useRef({});

  useEffect(() => {
    if (selectedBlockId == null) return;
    if (String(hoveredRow) === String(selectedBlockId)) return;
    const el = rowRefs.current[selectedBlockId];
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedBlockId, hoveredRow]);

  // Reset dirty state whenever editMode is turned off externally
  useEffect(() => {
    if (!editMode) {
      setEditMap({});
      setNewRows([]);
      setDeletedIds([]);
      setStatus(null);
    }
  }, [editMode]);

  const setCell = useCallback((blockId, colKey, value) => {
    setEditMap((prev) => ({
      ...prev,
      [blockId]: {
        ...(prev[blockId] || blockToStr(blocks.find((b) => b.id === blockId))),
        [colKey]: value,
      },
    }));
  }, [blocks]);

  const revertRow = useCallback((blockId) => {
    setEditMap((prev) => {
      const next = { ...prev };
      delete next[blockId];
      return next;
    });
  }, []);

  /* ── New-row helpers ── */
  const addNewRow = () => setNewRows((prev) => [...prev, newBlankRow()]);
  const setNewCell = useCallback((tmpId, colKey, value) => {
    setNewRows((prev) => prev.map((r) => r._tmpId === tmpId ? { ...r, [colKey]: value } : r));
  }, []);
  const removeNewRow = useCallback((tmpId) => {
    setNewRows((prev) => prev.filter((r) => r._tmpId !== tmpId));
  }, []);

  const splitRow = useCallback((block) => {
    const seed = newBlankRow();
    COLUMNS.forEach((col) => {
      if (col.readonly) return;
      const v = block[col.key];
      seed[col.key] = v != null ? String(v) : '';
    });
    if (seed.block_name) seed.block_name = `${seed.block_name} B`;
    setNewRows((prev) => [...prev, seed]);
  }, []);

  const toggleDelete = useCallback((blockId) => {
    setDeletedIds((prev) =>
      prev.includes(blockId) ? prev.filter((id) => id !== blockId) : [...prev, blockId]
    );
  }, []);

  const changedBlocks = (blocks || []).filter((b) => {
    const edited = editMap[b.id];
    return edited && hasChanged(b, edited);
  });

  const pendingNewRows = newRows.filter((r) =>
    COLUMNS.some((col) => !col.readonly && r[col.key] !== '') || (r.notes || '') !== ''
  );

  const hasChanges = changedBlocks.length > 0 || pendingNewRows.length > 0 || deletedIds.length > 0;

  async function handleSubmit() {
    if (!hasChanges) return;
    setStatus('submitting');
    try {
      const changes = changedBlocks.map((b) => {
        const edited = editMap[b.id];
        const fieldChanges = [];
        COLUMNS.forEach((col) => {
          if (col.readonly) return;
          const orig = b[col.key] != null ? String(b[col.key]) : '';
          if (edited[col.key] !== orig) {
            fieldChanges.push({
              field: col.key,
              label: col.label,
              old: orig || null,
              new: edited[col.key] === '' ? null : edited[col.key],
            });
          }
        });
        const origNotes = b.notes != null ? String(b.notes) : '';
        const newNotes = edited.notes ?? '';
        if (newNotes !== origNotes) {
          fieldChanges.push({ field: 'notes', label: 'Notes', old: origNotes || null, new: newNotes === '' ? null : newNotes });
        }
        return { id: b.id, block_name: b.block_name || null, field_changes: fieldChanges };
      });

      const newBlocks = pendingNewRows.map((r) => {
        const obj = {};
        COLUMNS.forEach((col) => {
          if (!col.readonly && r[col.key] !== '') obj[col.key] = r[col.key];
        });
        if ((r.notes || '') !== '') obj.notes = r.notes;
        return obj;
      });

      if (onDirectApply) {
        await onDirectApply({ block_changes: changes, new_blocks: newBlocks, deleted_block_ids: deletedIds });
      } else {
        await apiPost('/api/portal/requests', {
          request_type: 'vineyard_blocks',
          target_id: parcelId,
          payload: { block_changes: changes, new_blocks: newBlocks },
        });
      }

      setStatus('success');
      setEditMap({});
      setNewRows([]);
      setDeletedIds([]);
      onSubmit?.();
      onEditComplete?.();
    } catch {
      setStatus('error');
    }
  }

  return (
    <div>
      {editMode ? (
        /* ── EDIT MODE — labelled card per block ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(blocks || []).map((block) => {
            const isDirty = editMap[block.id] && hasChanged(block, editMap[block.id]);
            const rowData = editMap[block.id] || blockToStr(block);
            const isDeleted = deletedIds.includes(block.id);
            return (
              <BlockEditCard
                key={rowKey(block)}
                cardRef={(el) => { rowRefs.current[block.id] = el; }}
                title={block.display_name || block.block_name || 'Unnamed block'}
                displayName={block.display_name}
                rowData={rowData}
                topo={block.topo}
                isDirty={isDirty}
                isDeleted={isDeleted}
                isSelected={String(block.id) === String(selectedBlockId)}
                allowDelete={allowDelete}
                onHover={() => onRowSelect?.(block.id)}
                onCell={(key, val) => setCell(block.id, key, val)}
                onRevert={() => revertRow(block.id)}
                onSplit={() => splitRow(block)}
                onToggleDelete={() => toggleDelete(block.id)}
              />
            );
          })}

          {newRows.map((row) => (
            <BlockEditCard
              key={row._tmpId}
              title="New block"
              isNew
              rowData={row}
              isDirty
              onCell={(key, val) => setNewCell(row._tmpId, key, val)}
              onRemoveNew={() => removeNewRow(row._tmpId)}
            />
          ))}
        </div>
      ) : (
        /* ── READ MODE — full table, horizontally scrollable ── */
        <div style={{ borderRadius: 8, border: `1px solid ${border}`, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 'var(--type-mono-size)', minWidth: '100%' }}>
            <thead>
              <tr style={{ background: parchment }}>
                {COLUMNS.map((col, i) => (
                  <th key={col.key} style={i === 0 ? stickyHeadThStyle : headThStyle}>{col.label}</th>
                ))}
                {TERROIR_COLUMNS.map((col) => (<th key={col.key} style={headThStyle}>{col.label}</th>))}
                <th style={headThStyle}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {(blocks || []).map((block) => {
                const rowData = blockToStr(block);
                const isSelected = String(block.id) === String(selectedBlockId);
                const isHovered = hoveredRow === block.id;
                const rowBg = isSelected ? UI.selectedRowBg : isHovered ? UI.hoverRowBg : parchment;

                return (
                  <tr
                    key={rowKey(block)}
                    ref={(el) => { rowRefs.current[block.id] = el; }}
                    onMouseEnter={() => { setHoveredRow(block.id); onRowSelect?.(block.id); }}
                    onMouseLeave={() => setHoveredRow(null)}
                    onClick={() => onRowSelect?.(block.id)}
                    style={{
                      borderBottom: `1px solid ${UI.borderFaded(border)}`,
                      background: rowBg, cursor: onRowSelect ? 'pointer' : 'default', transition: 'background 0.12s',
                    }}
                  >
                    {COLUMNS.map((col, i) => {
                      const cellVal = col.key === 'block_name' ? (rowData[col.key] || block.display_name) : rowData[col.key];
                      return (
                        <td key={col.key} style={i === 0 ? { ...stickyCellStyle, background: rowBg } : plainCellStyle}>
                          <span style={cellTextStyle(cellVal, i === 0 && isSelected)}>{cellVal || '—'}</span>
                        </td>
                      );
                    })}
                    {TERROIR_COLUMNS.map((col) => {
                      const val = col.get(block.topo);
                      return (
                        <td key={col.key} style={plainCellStyle}>
                          <span style={cellTextStyle(val)}>{val || '—'}</span>
                        </td>
                      );
                    })}
                    <td style={{ ...plainCellStyle, maxWidth: 240 }}>
                      <span style={notesCellStyle(block.notes)} title={block.notes || ''}>{block.notes || '—'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer bar — only shown in edit mode */}
      {editMode && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', bottom: 0,
          background: parchment, borderTop: `1px solid ${UI.borderFaded(border)}`,
          marginTop: 12, padding: '10px 0 2px', flexWrap: 'wrap', gap: 8,
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={addNewRow} style={addRowBtnStyle}>+ Add Block</button>
            <p style={{ fontSize: 'var(--type-body-size)', color: muted, margin: 0 }}>
              {hasChanges
                ? `${changedBlocks.length + pendingNewRows.length} change${changedBlocks.length + pendingNewRows.length !== 1 ? 's' : ''}${deletedIds.length > 0 ? `, ${deletedIds.length} deletion${deletedIds.length !== 1 ? 's' : ''}` : ''} pending${(onDirectApply || autoApply) ? '' : ' — submit for admin review'}`
                : 'Edit the cards above · Acres are calculated automatically'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {status === 'success' && <span style={{ fontSize: 'var(--type-body-size)', color: UI.successText, fontWeight: 600 }}>{(onDirectApply || autoApply) ? '✓ Saved' : '✓ Submitted'}</span>}
            {status === 'error' && <span style={{ fontSize: 'var(--type-body-size)', color: crimson }}>Error — try again</span>}
            <button
              onClick={() => { setEditMap({}); setNewRows([]); setDeletedIds([]); setStatus(null); onEditCancel?.(); }}
              style={secondaryBtnStyle}
            >
              Cancel
            </button>
            {hasChanges && (
              <button onClick={handleSubmit} disabled={status === 'submitting'} style={primaryBtnStyle}>
                {status === 'submitting' ? 'Saving…' : (onDirectApply || autoApply ? 'Save Changes' : 'Save for Review')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Labelled edit card (one per block) ── */
function BlockEditCard({ cardRef, title, displayName, rowData, topo, isNew, isDirty, isDeleted, isSelected, allowDelete, onHover, onCell, onRevert, onSplit, onToggleDelete, onRemoveNew }) {
  const terroir = fmtTopo(topo);
  // Selection highlight mirrors the portal card pattern: electric-blue border + title.
  const borderColor = isDeleted ? alpha(crimson, 0.4) : isSelected ? electricBlue : isDirty ? alpha(crimson, 0.35) : border;
  const bg = isDeleted ? alpha(crimson, 0.05) : isDirty ? UI.dirtyCardBg : isSelected ? UI.selectedRowBg : parchment;
  return (
    <div
      ref={cardRef}
      onMouseEnter={onHover}
      style={{
        border: `1px solid ${borderColor}`,
        background: bg,
        borderRadius: 8, padding: '12px 14px', opacity: isDeleted ? 0.6 : 1,
        transition: 'border-color 0.12s, background 0.12s',
      }}
    >
      {/* Card header: title + row actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
        <span style={{ fontSize: 'var(--type-body-size)', fontWeight: 600, color: isSelected ? electricBlue : ink }}>
          {isNew ? '＋ New block' : (rowData.block_name || title)}
          {isDirty && !isNew && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: crimson, marginLeft: 8, verticalAlign: 'middle' }} title="Unsaved change" />}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isNew ? (
            <button onClick={onRemoveNew} title="Remove this new block" style={textBtnStyle}>✕ Remove</button>
          ) : (
            <>
              {isDirty && <button onClick={onRevert} title="Discard changes to this block" style={textBtnStyle}>↩ Revert</button>}
              {allowDelete && !isDirty && !isDeleted && <button onClick={onSplit} title="Split into two varietals" style={splitBtnStyle}>Split</button>}
              {allowDelete && !isDirty && (
                <button onClick={onToggleDelete} title={isDeleted ? 'Undo delete' : 'Delete this block'} style={{ ...textBtnStyle, color: isDeleted ? crimson : muted }}>
                  {isDeleted ? '↩ Undo' : '🗑 Delete'}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Labelled fields */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
        {COLUMNS.map((col) => (
          <label key={col.key} style={{ display: 'block' }}>
            <span style={detailLabelStyle}>{col.label}</span>
            {col.readonly ? (
              <span style={{ display: 'block', padding: '7px 9px', color: rowData[col.key] ? ink : muted, fontStyle: 'italic', fontSize: 'var(--type-mono-size)' }}>
                {rowData[col.key] || (isNew ? 'auto' : '—')}
              </span>
            ) : (
              <input
                type={col.type}
                value={rowData[col.key] || ''}
                onChange={(e) => onCell(col.key, e.target.value)}
                placeholder={col.key === 'block_name' ? (displayName || col.label) : (isNew ? col.label : '')}
                style={detailInputStyle}
              />
            )}
          </label>
        ))}
      </div>

      {/* Terroir (read-only) */}
      {terroir && (
        <p style={{ margin: '10px 0 0', fontSize: 'var(--type-mono-size)', color: muted }}>
          <span style={{ ...TYPE.uiLabel, fontSize: 'var(--type-ui-label-size)', color: muted, marginRight: 8 }}>Terroir</span>
          {terroir}
        </p>
      )}

      {/* Notes */}
      <label style={{ display: 'block', marginTop: 10 }}>
        <span style={{ ...detailLabelStyle, display: 'flex', justifyContent: 'space-between' }}>
          <span>Notes</span>
          <span style={{ color: (rowData.notes || '').length >= NOTES_MAX ? crimson : muted }}>{(rowData.notes || '').length}/{NOTES_MAX}</span>
        </span>
        <textarea
          value={rowData.notes || ''}
          maxLength={NOTES_MAX}
          onChange={(e) => onCell('notes', e.target.value)}
          placeholder="Add context about this block that the columns can't capture…"
          rows={2}
          style={{ ...detailInputStyle, resize: 'vertical', lineHeight: 1.4 }}
        />
      </label>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────── */

const headThStyle = {
  ...TYPE.uiLabel,
  textAlign: 'left', padding: '9px 12px', color: muted, fontWeight: 600,
  fontSize: 'var(--type-ui-label-size)', borderBottom: `1px solid ${border}`, whiteSpace: 'nowrap',
};

// First column (Block Name) stays pinned while the table scrolls horizontally.
const stickyHeadThStyle = {
  ...headThStyle,
  position: 'sticky', left: 0, zIndex: 2, background: parchment,
  borderRight: `1px solid ${border}`,
};

const plainCellStyle = { padding: 0, verticalAlign: 'middle' };

const stickyCellStyle = {
  padding: 0, verticalAlign: 'middle',
  position: 'sticky', left: 0, zIndex: 1,
  borderRight: `1px solid ${alpha(border, 0.6)}`,
};

function cellTextStyle(value, blue = false) {
  return {
    display: 'block', padding: '9px 12px', whiteSpace: 'nowrap',
    color: blue ? electricBlue : value ? ink : muted,
    fontWeight: blue ? 600 : 400,
    fontStyle: value ? 'normal' : 'italic',
  };
}

function notesCellStyle(value) {
  return {
    display: 'block', padding: '9px 12px',
    maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: value ? ink : muted, fontStyle: value ? 'normal' : 'italic',
  };
}

const detailLabelStyle = {
  ...TYPE.uiLabel,
  display: 'block', fontSize: 'var(--type-ui-label-size)', color: muted, marginBottom: 4,
};

const detailInputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '7px 9px',
  border: `1px solid ${border}`, borderRadius: 6, background: parchment,
  fontSize: 'var(--type-mono-size)', fontFamily: 'var(--font-sans)', color: ink, outline: 'none',
};

const textBtnStyle = {
  background: 'none', border: 'none', cursor: 'pointer', color: muted,
  fontSize: 'var(--type-mono-size)', fontWeight: 600, fontFamily: 'var(--font-sans)',
  padding: '2px 6px', whiteSpace: 'nowrap',
};

const splitBtnStyle = {
  background: alpha(TOKENS.amber, 0.12), border: `1px solid ${alpha(TOKENS.amber, 0.45)}`,
  color: TOKENS.amber, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-sans)',
  padding: '3px 9px', borderRadius: 4, whiteSpace: 'nowrap',
};

const addRowBtnStyle = {
  padding: '5px 12px', borderRadius: 6, border: `1px solid ${border}`,
  background: 'transparent', color: ink, cursor: 'pointer',
  fontSize: 'var(--type-body-size)', fontWeight: 600, fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
};

const primaryBtnStyle = {
  padding: '7px 18px', borderRadius: 6, border: 'none', background: ink, color: parchment,
  cursor: 'pointer', fontSize: 'var(--type-mono-size)', fontWeight: 600, fontFamily: 'var(--font-sans)',
};

const secondaryBtnStyle = {
  padding: '7px 14px', borderRadius: 6, border: `1px solid ${border}`,
  background: 'transparent', color: muted, cursor: 'pointer',
  fontSize: 'var(--type-mono-size)', fontFamily: 'var(--font-sans)',
};
