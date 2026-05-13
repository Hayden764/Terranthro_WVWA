/**
 * AdminBulkBlockImport — admin-scoped bulk block import + alias management.
 * Route: /admin/wineries/:wineryId/bulk-blocks
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { alpha, border, crimson, ink, muted, parchment, success, TOKENS } from '../../styles/tokens';
import { apiFetch, apiJson } from '../../lib/api';
import BulkBlockImport from '../../components/BulkBlockImport';

export default function AdminBulkBlockImport() {
  const { wineryId } = useParams();
  const navigate = useNavigate();
  const [parcels, setParcels] = useState([]);
  const [aliases, setAliases] = useState(null);
  const [aliasInput, setAliasInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [doneSummary, setDoneSummary] = useState(null);

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        apiJson(`/api/admin/wineries/${wineryId}/parcels`),
        apiJson(`/api/admin/wineries/${wineryId}/aliases`),
      ]);
      setParcels(p);
      setAliases(a);
    } catch {
      navigate('/admin/dashboard', { replace: true });
    }
  }, [wineryId, navigate]);
  useEffect(() => { load(); }, [load]);

  async function addAlias(e) {
    e.preventDefault();
    if (!aliasInput.trim()) return;
    setBusy(true);
    try {
      const res = await apiJson(`/api/admin/wineries/${wineryId}/aliases`, {
        method: 'POST',
        body: JSON.stringify({ alias: aliasInput.trim() }),
      });
      setAliases({ ...aliases, aliases: res.aliases });
      setAliasInput('');
    } finally {
      setBusy(false);
    }
  }
  async function removeAlias(a) {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/admin/wineries/${wineryId}/aliases`, {
        method: 'DELETE',
        body: JSON.stringify({ alias: a }),
      });
      const data = await res.json();
      setAliases({ ...aliases, aliases: data.aliases });
    } finally {
      setBusy(false);
    }
  }

  const wineryTitle = aliases?.title || `Winery #${wineryId}`;

  return (
    <div style={{ minHeight: '100vh', background: parchment, fontFamily: 'var(--font-sans)', padding: '20px 32px 60px' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <Link to="/admin/blocks" style={{ color: muted, textDecoration: 'none' }}>← Block Manager</Link>
          <span style={{ color: alpha(ink, 0.2) }}>|</span>
          <Link to="/admin/dashboard" style={{ color: muted, textDecoration: 'none' }}>Dashboard</Link>
        </div>

        {doneSummary ? (
          <div style={{ background: alpha(success, 0.08), border: `1px solid ${success}`, padding: 20, borderRadius: 8, marginBottom: 16 }}>
            <h2 style={{ margin: '0 0 8px', color: success }}>Import complete</h2>
            <p style={{ margin: 0, fontSize: 'var(--type-mono-size)' }}>
              {doneSummary.summary.updated} updated · {doneSummary.summary.inserted} inserted ·
              {' '}{doneSummary.summary.buyer_links_added} buyer links added ·
              {' '}{doneSummary.summary.parcels_touched} parcel(s) touched
            </p>
            <div style={{ marginTop: 12 }}>
              <button onClick={() => setDoneSummary(null)} style={{
                padding: '6px 12px', border: `1px solid ${border}`, background: parchment,
                borderRadius: 4, cursor: 'pointer',
              }}>Import another file</button>
            </div>
          </div>
        ) : (
          <BulkBlockImport
            wineryId={Number(wineryId)}
            wineryTitle={wineryTitle}
            parcelLabels={parcels}
            mode="admin"
            onComplete={(res) => setDoneSummary(res)}
          />
        )}

        {/* ── Alias management ── */}
        <div style={{ marginTop: 32, padding: 20, border: `1px solid ${border}`, borderRadius: 12, background: parchment }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 'var(--type-display-italic-size)', color: ink }}>
            Buyer Aliases for {wineryTitle}
          </h2>
          <p style={{ color: muted, fontSize: 'var(--type-mono-size)', margin: '0 0 12px' }}>
            Alternate spellings of this winery's name. Buyer names in CSV imports
            that exactly match (case-insensitive) the title or any alias here will
            be auto-linked.
          </p>

          <form onSubmit={addAlias} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              value={aliasInput}
              onChange={(e) => setAliasInput(e.target.value)}
              placeholder="e.g. Kosta Browne"
              style={{
                flex: 1, padding: '8px 12px', border: `1px solid ${border}`, borderRadius: 4,
                fontSize: 'var(--type-mono-size)',
              }}
            />
            <button type="submit" disabled={busy} style={{
              padding: '8px 16px', background: crimson, color: parchment, border: 'none',
              borderRadius: 4, cursor: 'pointer', fontWeight: 600,
            }}>Add alias</button>
          </form>

          {aliases?.aliases?.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {aliases.aliases.map((a) => (
                <li key={a} style={{
                  background: alpha(ink, 0.05), padding: '4px 10px', borderRadius: 4,
                  fontSize: 'var(--type-mono-size)', display: 'inline-flex', alignItems: 'center', gap: 8,
                }}>
                  {a}
                  <button onClick={() => removeAlias(a)} disabled={busy} style={{
                    background: 'none', border: 'none', color: crimson, cursor: 'pointer',
                    fontSize: 14,
                  }} aria-label={`Remove ${a}`}>×</button>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: muted, fontSize: 'var(--type-mono-size)' }}>No aliases yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
