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

import { useState, useEffect, useCallback } from 'react';
import { apiPost } from '../lib/api';
import { BRAND } from '../config/brandColors';

const COLUMNS = [
  { key: 'block_name',   label: 'Block',      type: 'text',   width: '14%' },
  { key: 'variety',      label: 'Variety',    type: 'text',   width: '18%' },
  { key: 'clone',        label: 'Clone',      type: 'text',   width: '12%' },
  { key: 'rootstock',    label: 'Rootstock',  type: 'text',   width: '12%' },
  { key: 'acres',        label: 'Acres',      type: 'number', width: '10%', readonly: true },
  { key: 'year_planted', label: 'Planted',    type: 'number', width: '10%' },
  { key: 'rows',         label: 'Rows',       type: 'number', width: '8%'  },
  { key: 'spacing',      label: 'Spacing',    type: 'text',   width: '8%'  },
];

function rowKey(b) { return b.id; }

function blockToStr(b) {
  return COLUMNS.reduce((acc, col) => {
    acc[col.key] = b[col.key] != null ? String(b[col.key]) : '';
    return acc;
  }, {});
}

function hasChanged(original, edited) {
  return COLUMNS.some((col) => {
    if (col.readonly) return false;
    return (original[col.key] != null ? String(original[col.key]) : '') !== edited[col.key];
  });
}

let _tmpSeq = 0;
function newBlankRow() {
  return COLUMNS.reduce((acc, col) => { acc[col.key] = ''; return acc; }, { _tmpId: `new_${++_tmpSeq}` });
}

export default function EditableBlocksTable({ parcelId, blocks, editMode = false, onEditCancel, onEditComplete, onSubmit }) {
  // editMap: {blockId: {col: value, ...}} — only tracks dirty existing rows
  const [editMap, setEditMap] = useState({});
  // newRows: unsaved rows being added
  const [newRows, setNewRows] = useState([]);
  // submission state
  const [status, setStatus] = useState(null); // null | 'submitting' | 'success' | 'error'

  // Reset dirty state whenever editMode is turned off externally
  useEffect(() => {
    if (!editMode) {
      setEditMap({});
      setNewRows([]);
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

  const changedBlocks = (blocks || []).filter((b) => {
    const edited = editMap[b.id];
    return edited && hasChanged(b, edited);
  });

  const pendingNewRows = newRows.filter((r) =>
    COLUMNS.some((col) => !col.readonly && r[col.key] !== '')
  );

  const hasChanges = changedBlocks.length > 0 || pendingNewRows.length > 0;

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
        return { id: b.id, block_name: b.block_name || null, field_changes: fieldChanges };
      });

      const newBlocks = pendingNewRows.map((r) => {
        const obj = {};
        COLUMNS.forEach((col) => {
          if (!col.readonly && r[col.key] !== '') obj[col.key] = r[col.key];
        });
        return obj;
      });

      await apiPost('/api/portal/requests', {
        request_type: 'vineyard_blocks',
        target_id: parcelId,
        payload: { block_changes: changes, new_blocks: newBlocks },
      });

      setStatus('success');
      setEditMap({});
      setNewRows([]);
      onSubmit?.();
      onEditComplete?.();
    } catch {
      setStatus('error');
    }
  }

  return (
    <div>
      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: 8, border: `1px solid ${BRAND.border}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
          <thead>
            <tr style={{ background: BRAND.eggshell }}>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  style={{
                    textAlign: 'left',
                    padding: '9px 10px',
                    color: BRAND.textMuted,
                    fontWeight: 600,
                    fontSize: 11,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    borderBottom: `1px solid ${BRAND.border}`,
                    width: col.width,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.label}
                </th>
              ))}
              <th style={{ width: 32, borderBottom: `1px solid ${BRAND.border}` }} />
            </tr>
          </thead>
          <tbody>
            {(blocks || []).map((block, idx) => {
              const isEditing = editMode;
              const isDirty = editMap[block.id] && hasChanged(block, editMap[block.id]);
              const rowData = editMap[block.id] || blockToStr(block);
              const isLast = idx === (blocks || []).length - 1 && newRows.length === 0;

              return (
                <tr
                  key={rowKey(block)}
                  style={{
                    borderBottom: isLast ? 'none' : `1px solid ${BRAND.border}18`,
                    background: isDirty
                      ? 'rgba(142, 21, 55, 0.04)'
                      : 'transparent',
                    cursor: 'default',
                    transition: 'background 0.15s',
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
                              ? `2px solid ${BRAND.burgundy}`
                              : `2px solid transparent`,
                            background: 'transparent',
                            fontSize: 13,
                            fontFamily: "'Inter', sans-serif",
                            color: BRAND.text,
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                          autoFocus={col.key === 'block_name'}
                        />
                      ) : (
                        <span style={{
                          display: 'block',
                          padding: '9px 10px',
                          color: rowData[col.key] ? BRAND.text : BRAND.textMuted,
                          fontStyle: rowData[col.key] ? 'normal' : 'italic',
                        }}>
                          {rowData[col.key] || '—'}
                        </span>
                      )}
                    </td>
                  ))}
                  {/* Row action */}
                  <td style={{ padding: '0 8px', verticalAlign: 'middle', textAlign: 'center' }}>
                    {isEditing && isDirty ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); revertRow(block.id); }}
                        title="Discard changes to this row"
                        style={iconBtnStyle}
                      >
                        ✕
                      </button>
                    ) : isDirty ? (
                      <span style={{
                        display: 'inline-block', width: 6, height: 6,
                        borderRadius: '50%', background: BRAND.burgundy,
                      }} title="Unsaved change" />
                    ) : null}
                  </td>
                </tr>
              );
            })}

            {/* New (unsaved) rows — always editable */}
            {newRows.map((row) => (
              <tr key={row._tmpId} style={{ background: 'rgba(142, 21, 55, 0.04)', borderBottom: `1px solid ${BRAND.border}18` }}>
                {COLUMNS.map((col) => (
                  <td key={col.key} style={{ padding: '0', verticalAlign: 'middle' }}>
                    {col.readonly ? (
                      <span style={{ display: 'block', padding: '9px 10px', color: BRAND.textMuted, fontStyle: 'italic' }}>auto</span>
                    ) : (
                      <input
                        type={col.type}
                        value={row[col.key]}
                        onChange={(e) => setNewCell(row._tmpId, col.key, e.target.value)}
                        placeholder={col.label}
                        style={{
                          width: '100%', padding: '8px 10px',
                          border: 'none', borderBottom: `2px solid ${BRAND.burgundy}40`,
                          background: 'transparent', fontSize: 13,
                          fontFamily: "'Inter', sans-serif", color: BRAND.text,
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
            <p style={{ fontSize: 12, color: BRAND.textMuted, margin: 0 }}>
              {hasChanges
                ? `${changedBlocks.length + pendingNewRows.length} pending — submit for admin review`
                : 'Edit cells above · Acres are calculated automatically'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {status === 'success' && (
              <span style={{ fontSize: 12, color: '#3a5a1f', fontWeight: 600 }}>✓ Submitted</span>
            )}
            {status === 'error' && (
              <span style={{ fontSize: 12, color: BRAND.burgundy }}>Error — try again</span>
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
  color: BRAND.textMuted,
  fontSize: 11,
  padding: '2px 4px',
  lineHeight: 1,
  borderRadius: 3,
};

const addRowBtnStyle = {
  padding: '5px 12px',
  borderRadius: 6,
  border: `1px solid ${BRAND.border}`,
  background: 'transparent',
  color: BRAND.brown,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "'Inter', sans-serif",
  whiteSpace: 'nowrap',
};

const primaryBtnStyle = {
  padding: '7px 18px',
  borderRadius: 6,
  border: 'none',
  background: BRAND.brown,
  color: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  fontFamily: "'Inter', sans-serif",
};

const secondaryBtnStyle = {
  padding: '7px 14px',
  borderRadius: 6,
  border: `1px solid ${BRAND.border}`,
  background: 'transparent',
  color: BRAND.textMuted,
  cursor: 'pointer',
  fontSize: 13,
  fontFamily: "'Inter', sans-serif",
};
