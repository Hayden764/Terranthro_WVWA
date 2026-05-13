import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { alpha, ink, muted, border, parchment, TOKENS } from '../../styles/tokens';
import { apiJson } from '../../lib/api';

export default function AdminVineyardBlocks() {
  const navigate = useNavigate();
  const [vineyards, setVineyards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = debouncedSearch
        ? `/api/admin/vineyards?search=${encodeURIComponent(debouncedSearch)}`
        : '/api/admin/vineyards';
      const data = await apiJson(url);
      setVineyards(data);
    } catch {
      navigate('/admin', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, navigate]);

  useEffect(() => { load(); }, [load]);

  return (
    <Shell>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Link
          to="/admin/dashboard"
          style={{ color: muted, fontSize: 'var(--type-mono-size)', textDecoration: 'none' }}
        >
          ← Dashboard
        </Link>
        <span style={{ color: alpha(ink, 0.2) }}>|</span>
        <h1 style={{ fontSize: 'var(--type-display-italic-size)', color: ink, margin: 0 }}>
          Block Manager
        </h1>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 20 }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by vineyard or winery name…"
          style={{
            width: '100%',
            maxWidth: 480,
            padding: '9px 14px',
            borderRadius: 8,
            border: `1px solid ${border}`,
            background: parchment,
            color: ink,
            fontSize: 'var(--type-body-size)',
            fontFamily: 'var(--font-sans)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {loading ? (
        <p style={{ color: muted }}>Loading…</p>
      ) : (
        <>
          <p style={{ color: muted, fontSize: 'var(--type-body-size)', margin: '0 0 12px' }}>
            {vineyards.length} vineyard{vineyards.length !== 1 ? 's' : ''}
            {debouncedSearch ? ` matching "${debouncedSearch}"` : ''}
          </p>

          <div style={{
            borderRadius: 10,
            border: `1px solid ${border}`,
            overflow: 'hidden',
            background: parchment,
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 'var(--type-body-size)',
            }}>
              <thead>
                <tr style={{ background: alpha(ink, 0.04) }}>
                  {['Vineyard', 'Winery', 'AVA', 'Parcels', 'Acres', 'Blocks'].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                  <th style={{ ...thStyle, width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {vineyards.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '24px 16px', color: muted, textAlign: 'center' }}>
                      No vineyards found
                    </td>
                  </tr>
                ) : (
                  vineyards.map((v, idx) => (
                    <tr
                      key={`${v.vineyard_name}|${v.winery_id ?? ''}`}
                      style={{
                        borderTop: idx === 0 ? 'none' : `1px solid ${alpha(border, 0.5)}`,
                        cursor: 'pointer',
                        transition: 'background 0.12s',
                      }}
                      onClick={() => navigate(`/admin/blocks/${v.parcel_id}`)}
                      onMouseEnter={(e) => { e.currentTarget.style.background = alpha(ink, 0.03); }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <td style={tdStyle}>{v.vineyard_name || <em style={{ color: muted }}>Unnamed</em>}</td>
                      <td style={{ ...tdStyle, color: muted }}>{v.winery_name}</td>
                      <td style={{ ...tdStyle, color: muted }}>{v.ava_name || '—'}</td>
                      <td style={{ ...tdStyle, color: v.parcel_count > 1 ? TOKENS.electricBlue : ink }}>
                        {v.parcel_count}
                      </td>
                      <td style={{ ...tdStyle, color: muted }}>{v.total_acres ? Number(v.total_acres).toFixed(1) : '—'}</td>
                      <td style={{ ...tdStyle }}>
                        {v.block_count > 0 ? (
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 10,
                            background: alpha(TOKENS.amber, 0.15),
                            color: TOKENS.amber,
                            fontSize: 'var(--type-ui-label-size)',
                            fontWeight: 600,
                          }}>
                            {v.block_count}
                          </span>
                        ) : (
                          <span style={{ color: muted }}>—</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <span style={{ color: TOKENS.electricBlue, fontSize: 'var(--type-ui-label-size)' }}>Open →</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}

/* ── Shell ── */
function Shell({ children }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: parchment,
      padding: '40px 32px',
      boxSizing: 'border-box',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}

/* ── Table styles ── */
const thStyle = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: 'var(--type-ui-label-size)',
  fontWeight: 600,
  color: muted,
  borderBottom: `1px solid ${border}`,
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '11px 14px',
  color: ink,
  verticalAlign: 'middle',
};
