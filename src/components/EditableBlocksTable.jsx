/**
 * EditableBlocksTable
 *
 * An inline-editable spreadsheet for vineyard block data.
 * Renders a clean table; clicking any cell makes that row editable.
 * Changed rows are highlighted. Submitting sends a single
 * `vineyard_blocks` request containing only the changed rows.
 *
 * Props:
 *   parcelId   {number}  vineyard_parcels.id — used as target_id in the request
 *   blocks     {Array}   Array of block objects from the portal API
 *   onSubmit   {fn}      Called with the submitted payload (optional, for parent refresh)
 */

import { Fragment, useState, useEffect, useCallback } from 'react';
import { apiPost } from '../lib/api';
import { alpha, border, crimson, electricBlue, ink, muted, parchment, TOKENS, TYPE } from '../styles/tokens';

const NOTES_MAX = 500;

const UI = {
  dirtyRowBg: alpha(TOKENS.crimson, 0.04),
  hoverRowBg: alpha(electricBlue, 0.06),
  successText: TOKENS.success,
  borderFaded: (color) => alpha(color, 0.09),
  borderVeryFaded: (color) => alpha(color, 0.25),
};

const COLUMNS = [
  { key: 'block_name',   label: 'Block',      type: 'text',   width: '13%' },
  { key: 'variety',      label: 'Variety',    type: 'text',   width: '14%' },
  { key: 'clone',        label: 'Clone',      type: 'text',   width: '9%' },
  { key: 'rootstock',    label: 'Rootstock',  type: 'text',   width: '9%' },
  { key: 'trellis',      label: 'Trellis',    type: 'text',   width: '9%' },
  { key: 'year_planted', label: 'Planted',    type: 'number', width: '8%' },
  { key: 'rows',         label: 'Rows',       type: 'number', width: '6%'  },
  { key: 'vines',        label: 'Vines',      type: 'number', width: '7%'  },
  { key: 'spacing',      label: 'Spacing',    type: 'text',   width: '7%'  },
  { key: 'acres',        label: 'Acres',      type: 'number', width: '7%', readonly: true },
];

function rowKey(b) { return b.id; }

function blockToStr(b) {
  const acc = COLUMNS.reduce((acc, col) => {
    acc[col.key] = b[col.key] != null ? String(b[col.key]) : '';
    return acc;
  }, {});
  // `notes` is edited via a dedicated per-row editor, not a table column.
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
  return COLUMNS.reduce((acc, col) => { acc[col.key] = ''; return acc; }, { _tmpId: `new_${++_tmpSeq}` });
}

export default function EditableBlocksTable({ parcelId, blocks, editMode = false, onEditCancel, onEditComplete, onSubmit, onDirectApply, allowDelete = false }) {
  const [hoveredRow, setHoveredRow] = useState(null);
  // editMap: {blockId: {col: value, ...}} — only tracks dirty existing rows
  const [editMap, setEditMap] = useState({});
  // newRows: unsaved rows being added
  const [newRows, setNewRows] = useState([]);
  // deletedIds: block ids marked for deletion (admin only)
  const [deletedIds, setDeletedIds] = useState([]);
  // submission state
  const [status, setStatus] = useState(null); // null | 'submitting' | 'success' | 'error'

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

  /* Split a row: appends a new row pre-filled from `block`, suffixed " B".
     The original row is left untouched — user adjusts variety/clone/acres on
     each side and saves. Useful when one block actually contains two varietals. */
  const splitRow = useCallback((block) => {
    const seed = newBlankRow();
    COLUMNS.forEach((col) => {
      if (col.readonly) return;
      const v = block[col.key];
      seed[col.key] = v != null ? String(v) : '';
    });
    // Suffix the cloned row's name so the two are distinguishable.
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
    COLUMNS.some((col) => !col.readonly && r[col.key] !== '')
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
        // Notes — edited via the per-row editor, not a COLUMNS cell.
        const origNotes = b.notes != null ? String(b.notes) : '';
        const newNotes = edited.notes ?? '';
        if (newNotes !== origNotes) {
          fieldChanges.push({
            field: 'notes',
            label: 'Notes',
            old: origNotes || null,
            new: newNotes === '' ? null : newNotes,
          });
        }
        return { id: b.id, block_name: b.block_name || null, field_changes: fieldChanges };
      });

      const newBlocks = pendingNewRows.map((r) => {
        const obj = {};
        COLUMNS.forEach((col) => {
          if (!col.readonly && r[col.key] !== '') obj[col.key] = r[col.key];
        });
        return obj;
      });

      if (onDirectApply) {
        // Admin path: apply immediately without an edit_request
        await onDirectApply({ block_changes: changes, new_blocks: newBlocks, deleted_block_ids: deletedIds });
      } else {
        // Portal path: submit for admin review
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
      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: 8, border: `1px solid ${border}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--type-mono-size)', minWidth: 560 }}>
          <thead>
            <tr style={{ background: parchment }}>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  style={{
                    ...TYPE.uiLabel,
                    textAlign: 'left',
                    padding: '9px 10px',
                    color: muted,
                    fontWeight: 600,
                    fontSize: 'var(--type-ui-label-size)',
                    borderBottom: `1px solid ${border}`,
                    width: col.width,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.label}
                </th>
              ))}
              <th style={{ width: 96, borderBottom: `1px solid ${border}` }} />
            </tr>
          </thead>
          <tbody>
            {(blocks || []).map((block, idx) => {
              const isEditing = editMode;
              const isDirty = editMap[block.id] && hasChanged(block, editMap[block.id]);
              const rowData = editMap[block.id] || blockToStr(block);
              const isLast = idx === (blocks || []).length - 1 && newRows.length === 0;
              const isHovered = hoveredRow === block.id;

              return (
                <Fragment key={rowKey(block)}>
                <tr
                  onMouseEnter={() => setHoveredRow(block.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{
                    borderBottom: isLast ? 'none' : `1px solid ${UI.borderFaded(border)}`,
                    background: deletedIds.includes(block.id)
                      ? alpha(crimson, 0.08)
                      : isDirty
                      ? UI.dirtyRowBg
                      : isHovered
                      ? UI.hoverRowBg
                      : 'transparent',
                    opacity: deletedIds.includes(block.id) ? 0.5 : 1,
                    cursor: 'default',
                    transition: 'background 0.12s',
                  }}
                >
                  {COLUMNS.map((col) => (
                    <td key={col.key} style={{ padding: '0', verticalAlign: 'middle' }}>
                      {isEditing && !col.readonly ? (
                        <input
                          type={col.type}
                          value={rowData[col.key]}
                          onChange={(e) => setCell(block.id, col.key, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            border: 'none',
                            borderBottom: isDirty
                              ? `2px solid ${crimson}`
                              : `2px solid transparent`,
                            background: 'transparent',
                            fontSize: 'var(--type-mono-size)',
                            fontFamily: 'var(--font-sans)',
                            color: ink,
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                          autoFocus={col.key === 'block_name'}
                        />
                      ) : (
                        <span style={{
                          display: 'block',
                          padding: '9px 10px',
                          color: rowData[col.key] ? ink : muted,
                          fontStyle: rowData[col.key] ? 'normal' : 'italic',
                        }}>
                          {rowData[col.key] || '—'}
                        </span>
                      )}
                    </td>
                  ))}
                  {/* Row action */}
                  <td style={{ padding: '0 4px', verticalAlign: 'middle', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {isEditing && isDirty ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); revertRow(block.id); }}
                        title="Discard changes to this row"
                        style={iconBtnStyle}
                      >
                        ✕
                      </button>
                    ) : isEditing && allowDelete && !isDirty ? (
                      <>
                        {!deletedIds.includes(block.id) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); splitRow(block); }}
                            title="Split this block — duplicates the row so you can separate it into two varietals"
                            style={splitBtnStyle}
                          >
                            Split
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleDelete(block.id); }}
                          title={deletedIds.includes(block.id) ? 'Undo delete' : 'Delete this block'}
                          style={{ ...iconBtnStyle, color: deletedIds.includes(block.id) ? crimson : muted }}
                        >
                          {deletedIds.includes(block.id) ? '↩' : '🗑'}
                        </button>
                      </>
                    ) : isDirty ? (
                      <span style={{
                        display: 'inline-block', width: 6, height: 6,
                        borderRadius: '50%', background: crimson,
                      }} title="Unsaved change" />
                    ) : null}
                  </td>
                </tr>

                {/* Per-block notes — free-text (≤500 chars). Editable inline;
                    otherwise shown read-only when the block has a note. */}
                {isEditing ? (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} style={{ padding: '4px 10px 12px' }}>
                      <label style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                        fontSize: 'var(--type-ui-label-size)', color: muted, marginBottom: 4,
                      }}>
                        <span>Notes {block.block_name ? `for ${block.block_name}` : ''}</span>
                        <span style={{ color: (rowData.notes || '').length >= NOTES_MAX ? crimson : muted }}>
                          {(rowData.notes || '').length}/{NOTES_MAX}
                        </span>
                      </label>
                      <textarea
                        value={rowData.notes || ''}
                        maxLength={NOTES_MAX}
                        onChange={(e) => setCell(block.id, 'notes', e.target.value)}
                        placeholder="Add context about this block that the table columns can't capture…"
                        rows={2}
                        className="ds-input"
                        style={{
                          width: '100%', boxSizing: 'border-box', padding: '8px 10px',
                          border: `1px solid ${border}`, borderRadius: 6, resize: 'vertical',
                          fontSize: 'var(--type-mono-size)', fontFamily: 'var(--font-sans)', color: ink,
                          background: parchment, outline: 'none',
                        }}
                      />
                    </td>
                  </tr>
                ) : block.notes ? (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} style={{ padding: '0 10px 10px' }}>
                      <div style={{
                        fontSize: 'var(--type-mono-size)', color: muted, lineHeight: 1.5,
                        borderLeft: `2px solid ${alpha(electricBlue, 0.4)}`, paddingLeft: 10,
                      }}>
                        <span style={{ fontWeight: 600, color: ink }}>Notes: </span>{block.notes}
                      </div>
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              );
            })}

            {/* New (unsaved) rows — always editable */}
            {newRows.map((row) => (
              <tr key={row._tmpId} style={{ background: UI.dirtyRowBg, borderBottom: `1px solid ${UI.borderFaded(border)}` }}>
                {COLUMNS.map((col) => (
                  <td key={col.key} style={{ padding: '0', verticalAlign: 'middle' }}>
                    {col.readonly ? (
                      <span style={{ display: 'block', padding: '9px 10px', color: muted, fontStyle: 'italic' }}>auto</span>
                    ) : (
                      <input
                        type={col.type}
                        value={row[col.key]}
                        onChange={(e) => setNewCell(row._tmpId, col.key, e.target.value)}
                        placeholder={col.label}
                        style={{
                          width: '100%', padding: '8px 10px',
                          border: 'none', borderBottom: `2px solid ${UI.borderVeryFaded(crimson)}`,
                          background: 'transparent', fontSize: 'var(--type-mono-size)',
                          fontFamily: 'var(--font-sans)', color: ink,
                          outline: 'none', boxSizing: 'border-box',
                        }}
                      />
                    )}
                  </td>
                ))}
                <td style={{ padding: '0 8px', verticalAlign: 'middle', textAlign: 'center' }}>
                  <button
                    onClick={() => removeNewRow(row._tmpId)}
                    title="Remove this row"
                    style={iconBtnStyle}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer bar — only shown in edit mode */}
      {editMode && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 10, flexWrap: 'wrap', gap: 8,
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={addNewRow} style={addRowBtnStyle}>+ Add Block</button>
            <p style={{ fontSize: 'var(--type-body-size)', color: muted, margin: 0 }}>
              {hasChanges
                ? `${changedBlocks.length + pendingNewRows.length} change${changedBlocks.length + pendingNewRows.length !== 1 ? 's' : ''}${deletedIds.length > 0 ? `, ${deletedIds.length} deletion${deletedIds.length !== 1 ? 's' : ''}` : ''} pending${onDirectApply ? '' : ' — submit for admin review'}`
                : 'Edit cells above · Acres are calculated automatically'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {status === 'success' && (
              <span style={{ fontSize: 'var(--type-body-size)', color: UI.successText, fontWeight: 600 }}>✓ Submitted</span>
            )}
            {status === 'error' && (
              <span style={{ fontSize: 'var(--type-body-size)', color: crimson }}>Error — try again</span>
            )}
            <button
              onClick={() => { setEditMap({}); setNewRows([]); setStatus(null); onEditCancel?.(); }}
              style={secondaryBtnStyle}
            >
              Cancel
            </button>
            {hasChanges && (
              <button
                onClick={handleSubmit}
                disabled={status === 'submitting'}
                style={primaryBtnStyle}
              >
                {status === 'submitting' ? 'Saving…' : 'Save Changes'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Styles ─────────────────────────────────────── */

const iconBtnStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: muted,
  fontSize: 'var(--type-ui-label-size)',
  padding: '2px 4px',
  lineHeight: 1,
  borderRadius: 3,
};

const splitBtnStyle = {
  background: alpha(TOKENS.amber, 0.12),
  border: `1px solid ${alpha(TOKENS.amber, 0.45)}`,
  color: TOKENS.amber,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--font-sans)',
  padding: '3px 9px',
  marginRight: 4,
  borderRadius: 4,
  whiteSpace: 'nowrap',
};

const addRowBtnStyle = {
  padding: '5px 12px',
  borderRadius: 6,
  border: `1px solid ${border}`,
  background: 'transparent',
  color: ink,
  cursor: 'pointer',
  fontSize: 'var(--type-body-size)',
  fontWeight: 600,
  fontFamily: 'var(--font-sans)',
  whiteSpace: 'nowrap',
};

const primaryBtnStyle = {
  padding: '7px 18px',
  borderRadius: 6,
  border: 'none',
  background: ink,
  color: parchment,
  cursor: 'pointer',
  fontSize: 'var(--type-mono-size)',
  fontWeight: 600,
  fontFamily: 'var(--font-sans)',
};

const secondaryBtnStyle = {
  padding: '7px 14px',
  borderRadius: 6,
  border: `1px solid ${border}`,
  background: 'transparent',
  color: muted,
  cursor: 'pointer',
  fontSize: 'var(--type-mono-size)',
  fontFamily: 'var(--font-sans)',
};
