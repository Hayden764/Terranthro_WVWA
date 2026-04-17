import { useState } from 'react';
import { BRAND } from '../../config/brandColors';
import { apiPost } from '../../lib/api';

export default function PortalLogin() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiPost('/api/auth/magic-link', { email });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: BRAND.eggshell,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{
        background: BRAND.white,
        borderRadius: 12,
        padding: '48px 40px',
        width: '100%',
        maxWidth: 420,
        boxShadow: '0 4px 24px rgba(46,34,26,0.10)',
        border: `1px solid ${BRAND.border}`,
      }}>
        <h1 style={{
          fontFamily: "'Georgia', serif",
          fontSize: 24,
          color: BRAND.brown,
          marginBottom: 8,
        }}>
          Winery Portal
        </h1>
        <p style={{ color: BRAND.textMuted, fontSize: 14, marginBottom: 32 }}>
          Sign in with your registered winery email
        </p>

        {sent ? (
          <div style={{
            background: '#f0f9e8',
            border: '1px solid #b5d89a',
            borderRadius: 8,
            padding: '20px 16px',
            color: '#3a5a1f',
            fontSize: 14,
            lineHeight: 1.6,
          }}>
            <strong>Check your inbox.</strong> We've sent a sign-in link to{' '}
            <strong>{email}</strong>. It expires in 15 minutes.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 500,
              color: BRAND.brownLight,
              marginBottom: 6,
            }}>
              Email address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="winery@example.com"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${BRAND.border}`,
                fontSize: 15,
                color: BRAND.text,
                background: BRAND.eggshell,
                outline: 'none',
                marginBottom: 16,
              }}
            />

            {error && (
              <p style={{ color: BRAND.burgundy, fontSize: 13, marginBottom: 12 }}>
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
                background: BRAND.brown,
                color: BRAND.white,
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Sending…' : 'Send Sign-In Link'}
            </button>
          </form>
        )}

        <p style={{
          marginTop: 32,
          fontSize: 12,
          color: BRAND.textMuted,
          textAlign: 'center',
        }}>
          Don't have access?{' '}
          <a href="mailto:info@terranthro.com" style={{ color: BRAND.burgundy }}>
            Contact us
          </a>
        </p>
      </div>
    </div>
  );
}
