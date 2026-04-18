/**
 * ParcelHistorySection
 *
 * Lazy-loaded collapsible section showing the full audit trail for a parcel.
 * Fetches from GET /api/portal/vineyards/:id/history on first expand.
 *
 * Props:
 *   parcelId  {number}  vineyard_parcels.id
 */
import { useState, useCallback } from 'react';
import { apiJson } from '../lib/api';
import { BRAND } from '../config/brandColors';

const REQUEST_TYPE_LABELS = {
  profile:             'Winery Profile',
  vineyard_varietals:  'Varietals Update',
  vineyard_blocks:     'Block Info Update',
  vineyard_claim:      'Vineyard Claim',
  vineyard_new:        'New Vineyard',
  geometry_update:     'Boundary Edit',
};

const STATUS_COLORS = {
  pending:  { bg: '#FFF8E1', color: '#B8860B' },
  approved: { bg: '#f0f9e8', color: '#3a5a1f' },
  rejected: { bg: '#FEF0F0', color: '#A8323A' },
};

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.pending;
  return (
    <span style={{
      padding: '2px 9px', borderRadius: 10, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.color, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

function FieldChange({ entry }) {
  const field = entry.field_name?.replace(/^block\./, '') || '—';
  const isGeometry = field === 'geometry';
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      padding: '6px 0', borderBottom: `1px solid ${BRAND.border}18`, fontSize: 12,
    }}>
      <span style={{ minWidth: 100, color: BRAND.textMuted, flexShrink: 0, fontWeight: 500 }}>
        {field}
      </span>
      {isGeometry ? (
        <span style={{ color: BRAND.textMuted, fontStyle: 'italic' }}>Boundary geometry updated</span>
      ) : (
        <span style={{ color: BRAND.text }}>
          {entry.old_value ? (
            <>
              <span style={{ textDecoration: 'line-through', color: BRAND.textMuted, marginRight: 6 }}>
                {entry.old_value}
              </span>
              → {entry.new_value || <em style={{ color: BRAND.textMuted }}>cleared</em>}
            </>
          ) : (
            entry.new_value || <em style={{ color: BRAND.textMuted }}>—</em>
          )}
        </span>
      )}
    </div>
  );
}

export default function ParcelHistorySection({ parcelId }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState([]);
  const [requests, setRequests] = useState([]);

  const load = useCallback(async () => {
    if (loaded) return;
    setLoading(true);
    try {
      const data = await apiJson(`/api/portal/vineyards/${parcelId}/history`);
      setLog(data.log || []);
      setRequests(data.requests || []);
      setLoaded(true);
    } catch {
      // silently fail — history is supplementary
    } finally {
      setLoading(false);
    }
  }, [parcelId, loaded]);

  function handleToggle() {
    if (!open) load();
    setOpen((o) => !o);
  }

  // Group log entries by request_id so they display as a single event
  const groupedLog = [];
  const seen = new Set();
  for (const entry of log) {
    const key = entry.request_id ?? `lone_${entry.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      groupedLog.push({
        key,
        request_id: entry.request_id,
        request_type: entry.request_type,
        edited_at: entry.edited_at,
        reviewed_by: entry.reviewed_by,
        admin_notes: entry.admin_notes,
        entries: log.filter((e) => (e.request_id ?? `lone_${e.id}`) === key),
      });
    }
  }

  // Pending + rejected requests not yet in the log
  const unresolvedRequests = requests.filter((r) => r.status !== 'approved');

  const isEmpty = !loading && loaded && groupedLog.length === 0 && unresolvedRequests.length === 0;

  return (
    <div style={{ marginTop: 16 }}>
      {/* Toggle header */}
      <button
        onClick={handleToggle}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 0', borderTop: `1px solid ${BRAND.border}`,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: BRAND.brown }}>Edit History</span>
        <span style={{ fontSize: 12, color: BRAND.textMuted }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ paddingBottom: 8 }}>
          {loading && (
            <p style={{ fontSize: 13, color: BRAND.textMuted, padding: '8px 0' }}>Loading…</p>
          )}

          {isEmpty && (
            <p style={{ fontSize: 13, color: BRAND.textMuted, padding: '8px 0' }}>
              No edit history yet.
            </p>
          )}

          {/* Pending / rejected requests */}
          {unresolvedRequests.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {unresolvedRequests.map((r) => (
                <div key={r.request_id} style={{
                  border: `1px solid ${BRAND.border}`,
                  borderRadius: 8, padding: '12px 14px', marginBottom: 8,
                  background: BRAND.eggshell,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: BRAND.brown }}>
                      {REQUEST_TYPE_LABELS[r.request_type] || r.request_type}
                    </span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: BRAND.textMuted }}>{formatDate(r.created_at)}</span>
                      <StatusBadge status={r.status} />
                    </div>
                  </div>
                  {r.admin_notes && (
                    <p style={{ fontSize: 12, color: BRAND.textMuted, margin: '4px 0 0', fontStyle: 'italic' }}>
                      Admin note: {r.admin_notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Applied changes timeline */}
          {groupedLog.map((group) => (
            <div key={group.key} style={{
              border: `1px solid ${BRAND.border}`,
              borderRadius: 8, padding: '12px 14px', marginBottom: 8,
              background: BRAND.white,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: BRAND.brown }}>
                  {REQUEST_TYPE_LABELS[group.request_type] || (group.request_type || 'Data update')}
                </span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {group.reviewed_by && (
                    <span style={{ fontSize: 11, color: BRAND.textMuted }}>by {group.reviewed_by}</span>
                  )}
                  <span style={{ fontSize: 11, color: BRAND.textMuted }}>{formatDate(group.edited_at)}</span>
                  <StatusBadge status="approved" />
                </div>
              </div>

              {group.entries.map((e, i) => (
                <FieldChange key={i} entry={e} />
              ))}

              {group.admin_notes && (
                <p style={{ fontSize: 12, color: BRAND.textMuted, marginTop: 8, fontStyle: 'italic' }}>
                  Note: {group.admin_notes}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
