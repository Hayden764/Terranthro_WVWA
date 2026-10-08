import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { alpha, border, crimson, ink, muted, parchment, TOKENS } from '@terranthro/shared/styles/tokens.js';
import { LIGHT_INPUT_STYLE, btn } from '@terranthro/shared/styles/patterns.js';
import { apiJson, apiPost } from '@terranthro/shared/lib/api.js';

/** Sign-in for the OWB Portal — one shared login for the Oregon Wine Board. */
export default function OwbLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Already signed in → straight to the portal.
  useEffect(() => {
    apiJson('/api/client/me').then(() => navigate('/owb/timeline', { replace: true })).catch(() => {});
  }, [navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiPost('/api/client/login', { username, password });
      navigate('/owb/timeline');
    } catch (err) {
      setError(err.message || 'Invalid username or password');
    } finally {
      setLoading(false);
    }
  }

  const labelStyle = {
    display: 'block',
    fontSize: 'var(--type-mono-size)',
    fontWeight: 500,
    color: muted,
    marginBottom: 6,
  };

  return (
    <div style={{
      minHeight: '100vh', background: parchment, display: 'flex',
      alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-sans)', padding: 16,
    }}>
      <div style={{
        background: parchment, borderRadius: 12, padding: '48px 40px', width: '100%', maxWidth: 420,
        boxShadow: `0 4px 24px ${alpha(TOKENS.ink, 0.1)}`, border: `1px solid ${border}`,
        boxSizing: 'border-box',
      }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--type-display-medium-size)', color: ink, marginBottom: 8 }}>
          OWB Portal
        </h1>
        <p style={{ color: muted, fontSize: 'var(--type-body-size)', marginBottom: 28 }}>
          Oregon Statewide Vineyard Mapping — project progress, invoices and data.
        </p>

        <form onSubmit={handleSubmit}>
          <label style={labelStyle} htmlFor="owb-username">Username</label>
          <input
            id="owb-username"
            type="text"
            required
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="ds-input ds-input-light"
            style={{ ...LIGHT_INPUT_STYLE, marginBottom: 16 }}
          />
          <label style={labelStyle} htmlFor="owb-password">Password</label>
          <input
            id="owb-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="ds-input ds-input-light"
            style={{ ...LIGHT_INPUT_STYLE, marginBottom: 16 }}
          />

          {error && (
            <p style={{ color: crimson, fontSize: 'var(--type-mono-size)', marginBottom: 12 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{ ...btn('primary', { width: '100%' }), cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p style={{ marginTop: 32, fontSize: 'var(--type-body-size)', color: muted, textAlign: 'center' }}>
          Trouble signing in?{' '}
          <a href="mailto:hayden@terranthro.com" className="tx-link" style={{ color: TOKENS.interactive }}>
            Email Hayden
          </a>
        </p>
      </div>
    </div>
  );
}
