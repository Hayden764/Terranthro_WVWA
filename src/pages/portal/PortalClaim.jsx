import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BRAND } from '../../config/brandColors';
import { apiJson, apiPost } from '../../lib/api';

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
    <div style={{ minHeight: '100vh', background: BRAND.eggshell, fontFamily: "'Inter', sans-serif" }}>
      <div style={{
        maxWidth: 700, margin: '0 auto', padding: '40px 20px',
        background: BRAND.white, minHeight: '100vh',
        borderLeft: `1px solid ${BRAND.border}`, borderRight: `1px solid ${BRAND.border}`,
      }}>
        <Link to="/portal/dashboard" style={{ color: BRAND.brownLight, fontSize: 13 }}>← Dashboard</Link>

        <h1 style={{ fontFamily: "'Georgia', serif", fontSize: 22, color: BRAND.brown, margin: '16px 0 8px' }}>
          Claim a Vineyard
        </h1>
        <p style={{ color: BRAND.textMuted, fontSize: 13, marginBottom: 24 }}>
          Search for an existing unlinked vineyard parcel, or request to add a new one.
        </p>

        {/* Search */}
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by vineyard or owner name…"
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 8,
              border: `1px solid ${BRAND.border}`, fontSize: 14,
              color: BRAND.text, background: BRAND.eggshell, outline: 'none',
            }}
          />
          <button type="submit" disabled={loading} style={{
            padding: '10px 20px', borderRadius: 8, border: 'none',
            background: BRAND.brown, color: BRAND.white, fontSize: 14,
            fontWeight: 600, cursor: 'pointer',
          }}>
            Search
          </button>
        </form>

        {/* Results */}
        {searched && (
          <div style={{ marginBottom: 32 }}>
            {loading ? (
              <p style={{ color: BRAND.textMuted, fontSize: 13 }}>Searching…</p>
            ) : results.length === 0 ? (
              <p style={{ color: BRAND.textMuted, fontSize: 13 }}>No unlinked parcels found matching "{search}".</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {results.map((r) => (
                  <div key={r.id} style={{
                    padding: '14px 16px', borderRadius: 8,
                    border: `1px solid ${BRAND.border}`, background: BRAND.eggshell,
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: BRAND.text }}>
                      {r.vineyard_name || 'Unnamed Parcel'}
                    </div>
                    <div style={{ fontSize: 12, color: BRAND.textMuted, marginTop: 2 }}>
                      {r.nested_ava || r.ava_name || '—'} · {Number(r.acres || 0).toFixed(1)} acres
                      {r.situs_city && ` · ${r.situs_city}`}
                    </div>

                    {submitted === r.id ? (
                      <p style={{ fontSize: 12, color: '#3a5a1f', marginTop: 8, fontWeight: 500 }}>
                        ✓ Claim request submitted
                      </p>
                    ) : claiming === r.id ? (
                      <div style={{ marginTop: 8 }}>
                        <textarea
                          placeholder="Optional notes (e.g., why this vineyard is yours)…"
                          value={claimNotes}
                          onChange={(e) => setClaimNotes(e.target.value)}
                          rows={2}
                          style={{
                            width: '100%', padding: '6px 10px', borderRadius: 6,
                            border: `1px solid ${BRAND.border}`, fontSize: 12,
                            fontFamily: "'Inter', sans-serif", resize: 'vertical',
                            marginBottom: 6,
                          }}
                        />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => handleClaim(r.id)} style={smallBtn}>Submit Claim</button>
                          <button onClick={() => { setClaiming(null); setClaimNotes(''); }} style={{ ...smallBtn, background: 'transparent', color: BRAND.textMuted, border: `1px solid ${BRAND.border}` }}>
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
          background: BRAND.eggshell, borderRadius: 10, padding: '20px 16px',
          border: `1px solid ${BRAND.border}`,
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: BRAND.brown, marginBottom: 8 }}>
            Don't see your vineyard?
          </h2>

          {newSubmitted ? (
            <p style={{ color: '#3a5a1f', fontSize: 13, fontWeight: 500 }}>
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
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>AVA (if known)</label>
                <input
                  type="text"
                  value={newForm.ava_name}
                  onChange={(e) => setNewForm((p) => ({ ...p, ava_name: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Notes / Description</label>
                <textarea
                  value={newForm.notes}
                  onChange={(e) => setNewForm((p) => ({ ...p, notes: e.target.value }))}
                  rows={3}
                  style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" style={smallBtn}>Submit</button>
                <button type="button" onClick={() => setShowNew(false)} style={{ ...smallBtn, background: 'transparent', color: BRAND.textMuted, border: `1px solid ${BRAND.border}` }}>
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
  padding: '6px 16px', borderRadius: 6, border: 'none',
  background: BRAND.brown, color: BRAND.white, fontSize: 12,
  fontWeight: 600, cursor: 'pointer',
};

const labelStyle = { display: 'block', fontSize: 12, color: BRAND.textMuted, marginBottom: 4 };

const inputStyle = {
  width: '100%', padding: '8px 12px', borderRadius: 6,
  border: `1px solid ${BRAND.border}`, fontSize: 13,
  fontFamily: "'Inter', sans-serif", color: BRAND.text,
  background: BRAND.white, resize: 'vertical',
};
