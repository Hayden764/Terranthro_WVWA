import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { alpha, border, crimson, ink, muted, parchment, TOKENS } from '../../styles/tokens';
import { apiPost } from '../../lib/api';

const TAB = { MAGIC: 'magic', PASSWORD: 'password' };

export default function PortalLogin() {
  const navigate = useNavigate();
  const [tab, setTab] = useState(TAB.PASSWORD);

  // Magic-link state
  const [mlEmail, setMlEmail] = useState('');
  const [sent, setSent] = useState(false);

  // Password state
  const [pwEmail, setPwEmail] = useState('');
  const [password, setPassword] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleMagicLink(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiPost('/api/auth/magic-link', { email: mlEmail });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiPost('/api/auth/login', { email: pwEmail, password });
      navigate('/portal/dashboard');
    } catch (err) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 8,
    border: `1px solid ${border}`,
    fontSize: 15,
    color: ink,
    background: parchment,
    outline: 'none',
    marginBottom: 16,
    boxSizing: 'border-box',
  };

  const labelStyle = {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: muted,
    marginBottom: 6,
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: parchment,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{
        background: parchment,
        borderRadius: 12,
        padding: '48px 40px',
        width: '100%',
        maxWidth: 420,
        boxShadow: `0 4px 24px ${alpha(TOKENS.ink, 0.1)}`,
        border: `1px solid ${border}`,
      }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          color: ink,
          marginBottom: 8,
        }}>
          Winery Portal
        </h1>
        <p style={{ color: muted, fontSize: 14, marginBottom: 24 }}>
          Sign in to your winery account
        </p>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          borderBottom: `1px solid ${border}`,
          marginBottom: 28,
        }}>
          {[
            { key: TAB.PASSWORD, label: 'Password' },
            { key: TAB.MAGIC, label: 'Email link' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setTab(key); setError(''); }}
              style={{
                flex: 1,
                padding: '8px 0',
                background: 'none',
                border: 'none',
                borderBottom: tab === key ? `2px solid ${ink}` : '2px solid transparent',
                marginBottom: -1,
                fontSize: 14,
                fontWeight: tab === key ? 600 : 400,
                color: tab === key ? ink : muted,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === TAB.PASSWORD && (
          <form onSubmit={handlePasswordLogin}>
            <label style={labelStyle}>Email address</label>
            <input
              type="email"
              required
              value={pwEmail}
              onChange={(e) => setPwEmail(e.target.value)}
              placeholder="winery@example.com"
              style={inputStyle}
            />
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={inputStyle}
            />

            {error && (
              <p style={{ color: crimson, fontSize: 13, marginBottom: 12 }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px 0',
                borderRadius: 8,
                border: 'none',
                background: ink,
                color: parchment,
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>

            <p style={{ marginTop: 14, fontSize: 12, color: muted, textAlign: 'center' }}>
              No password yet? Use the <button onClick={() => setTab(TAB.MAGIC)} style={{ background: 'none', border: 'none', color: crimson, fontSize: 12, cursor: 'pointer', padding: 0 }}>email link</button> tab to log in, then set one in your profile.
            </p>
          </form>
        )}

        {tab === TAB.MAGIC && (
          sent ? (
            <div style={{
              background: TOKENS.successDim,
              border: `1px solid ${alpha(TOKENS.success, 0.35)}`,
              borderRadius: 8,
              padding: '20px 16px',
              color: TOKENS.success,
              fontSize: 14,
              lineHeight: 1.6,
            }}>
              <strong>Check your inbox.</strong> We've sent a sign-in link to{' '}
              <strong>{mlEmail}</strong>. It expires in 15 minutes.
            </div>
          ) : (
            <form onSubmit={handleMagicLink}>
              <label style={labelStyle}>Email address</label>
              <input
                type="email"
                required
                value={mlEmail}
                onChange={(e) => setMlEmail(e.target.value)}
                placeholder="winery@example.com"
                style={inputStyle}
              />

              {error && (
                <p style={{ color: crimson, fontSize: 13, marginBottom: 12 }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '12px 0',
                  borderRadius: 8,
                  border: 'none',
                  background: ink,
                  color: parchment,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: loading ? 'wait' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Sending…' : 'Send Sign-In Link'}
              </button>
            </form>
          )
        )}

        <p style={{
          marginTop: 32,
          fontSize: 12,
          color: muted,
          textAlign: 'center',
        }}>
          Don't have access?{' '}
          <a href="mailto:info@terranthro.com" style={{ color: crimson }}>
            Contact us
          </a>
        </p>
      </div>
    </div>
  );
}
