import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { border, ink, muted, parchment, TOKENS } from '../../styles/tokens';
import { INPUT_STYLE, btn } from '../../styles/patterns';
import { apiJson, apiPost } from '../../lib/api';
import TerroirDataChips from '../../components/TerroirDataChips';

export default function PortalClaim() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(null); // parcel id being claimed
  const [claimNotes, setClaimNotes] = useState('');
  const [submitted, setSubmitted] = useState(null);

  // New vineyard form
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ vineyard_name: '', ava_name: '', notes: '' });
  const [newSubmitted, setNewSubmitted] = useState(false);

  async function handleSearch(e) {
    e.preventDefault();
    if (!search.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const data = await apiJson(`/api/portal/vineyards/available?search=${encodeURIComponent(search.trim())}&limit=30`);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleClaim(parcelId) {
    try {
      await apiPost('/api/portal/requests', {
        request_type: 'vineyard_claim',
        target_id: parcelId,
        payload: { vineyard_name: results.find((r) => r.id === parcelId)?.vineyard_name || '', notes: claimNotes },
      });
      setSubmitted(parcelId);
      setClaiming(null);
    } catch {
      // ignore
    }
  }

  async function handleNewVineyard(e) {
    e.preventDefault();
    try {
      await apiPost('/api/portal/requests', {
        request_type: 'vineyard_new',
        payload: newForm,
      });
      setNewSubmitted(true);
    } catch {
      // ignore
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: parchment, fontFamily: 'var(--font-sans)' }}>
      <div style={{
        maxWidth: 700, margin: '0 auto', padding: '40px 20px',
        background: parchment, minHeight: '100vh',
        borderLeft: `1px solid ${border}`, borderRight: `1px solid ${border}`,
      }}>
        <Link to="/portal/dashboard" style={{ color: muted, fontSize: 'var(--type-mono-size)' }}>← Dashboard</Link>

        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--type-display-italic-size)', color: ink, margin: '16px 0 8px' }}>
          Claim a Vineyard
        </h1>
        <p style={{ color: muted, fontSize: 'var(--type-mono-size)', marginBottom: 24 }}>
          Search for an existing unlinked vineyard parcel, or request to add a new one.
        </p>

        {/* Search */}
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by vineyard or owner name…"
            className="ds-input"
            style={{
              ...INPUT_STYLE,
              flex: 1,
            }}
          />
          <button type="submit" disabled={loading} style={{
            ...btn('primary'),
            cursor: 'pointer',
          }}>
            Search
          </button>
        </form>

        {/* Results */}
        {searched && (
          <div style={{ marginBottom: 32 }}>
            {loading ? (
              <p style={{ color: muted, fontSize: 'var(--type-mono-size)' }}>Searching…</p>
            ) : results.length === 0 ? (
              <p style={{ color: muted, fontSize: 'var(--type-mono-size)' }}>No unlinked parcels found matching "{search}".</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {results.map((r) => (
                  <div key={r.id} style={{
                    padding: '14px 16px', borderRadius: 8,
                    border: `1px solid ${border}`, background: parchment,
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--type-body-size)', color: ink }}>
                      {r.vineyard_name || 'Unnamed Parcel'}
                    </div>
                    <div style={{ fontSize: 'var(--type-body-size)', color: muted, marginTop: 2 }}>
                      {r.nested_ava || r.ava_name || '—'} · {Number(r.acres || 0).toFixed(1)} acres
                      {r.situs_city && ` · ${r.situs_city}`}
                    </div>
                    <div style={{ marginTop: 10, marginBottom: 4 }}>
                      <TerroirDataChips chips={[
                        { label: 'Acres', value: `${Number(r.acres || 0).toFixed(1)} ac`, tone: 'amber', glow: false },
                        { label: 'AVA',   value: r.nested_ava || r.ava_name || '—',          tone: 'blue',  glow: true  },
                        { label: 'Elev',  value: r.topo_stats?.elevation_mean_ft
                            ? `${Math.round(r.topo_stats.elevation_mean_ft)} ft` : '—',       tone: 'parchment', glow: false },
                        { label: 'Slope', value: r.topo_stats?.slope_mean_deg
                            ? `${Number(r.topo_stats.slope_mean_deg).toFixed(1)}°` : '—',   tone: 'green', glow: true  },
                      ]} />
                    </div>

                    {submitted === r.id ? (
                      <p style={{ fontSize: 'var(--type-body-size)', color: TOKENS.success, marginTop: 8, fontWeight: 500 }}>
                        ✓ Claim request submitted
                      </p>
                    ) : claiming === r.id ? (
                      <div style={{ marginTop: 8 }}>
                        <textarea
                          placeholder="Optional notes (e.g., why this vineyard is yours)…"
                          value={claimNotes}
                          onChange={(e) => setClaimNotes(e.target.value)}
                          rows={2}
                          className="ds-input"
                          style={{
                            ...INPUT_STYLE,
                            padding: '6px 10px',
                            resize: 'vertical',
                            marginBottom: 6,
                          }}
                        />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => handleClaim(r.id)} style={smallBtn}>Submit Claim</button>
                          <button onClick={() => { setClaiming(null); setClaimNotes(''); }} style={{ ...smallBtn, background: 'transparent', color: muted, border: `1px solid ${border}` }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setClaiming(r.id)} style={{ ...smallBtn, marginTop: 8 }}>
                        Claim
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* New vineyard */}
        <div style={{
          background: parchment, borderRadius: 10, padding: '20px 16px',
          border: `1px solid ${border}`,
        }}>
          <h2 style={{ fontSize: 'var(--type-display-italic-size)', fontWeight: 600, color: ink, marginBottom: 8 }}>
            Don't see your vineyard?
          </h2>

          {newSubmitted ? (
            <p style={{ color: TOKENS.success, fontSize: 'var(--type-mono-size)', fontWeight: 500 }}>
              ✓ New vineyard request submitted. We'll review it shortly.
            </p>
          ) : !showNew ? (
            <button onClick={() => setShowNew(true)} style={smallBtn}>
              Request New Vineyard
            </button>
          ) : (
            <form onSubmit={handleNewVineyard}>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Vineyard Name</label>
                <input
                  type="text"
                  required
                  value={newForm.vineyard_name}
                  onChange={(e) => setNewForm((p) => ({ ...p, vineyard_name: e.target.value }))}
                  className="ds-input"
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>AVA (if known)</label>
                <input
                  type="text"
                  value={newForm.ava_name}
                  onChange={(e) => setNewForm((p) => ({ ...p, ava_name: e.target.value }))}
                  className="ds-input"
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Notes / Description</label>
                <textarea
                  value={newForm.notes}
                  onChange={(e) => setNewForm((p) => ({ ...p, notes: e.target.value }))}
                  rows={3}
                  className="ds-input"
                  style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" style={smallBtn}>Submit</button>
                <button type="button" onClick={() => setShowNew(false)} style={{ ...smallBtn, background: 'transparent', color: muted, border: `1px solid ${border}` }}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

const smallBtn = {
  ...btn('primary', { padding: '6px 16px' }),
  cursor: 'pointer',
};

const labelStyle = { display: 'block', fontSize: 'var(--type-body-size)', color: muted, marginBottom: 4 };

const inputStyle = {
  ...INPUT_STYLE,
  resize: 'vertical',
};
