import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { alpha, ink, muted, TOKENS } from '../../styles/tokens';
import { apiPost } from '../../lib/api';

export default function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiPost('/api/admin/login', { email, password });
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: TOKENS.ink,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{
        background: TOKENS.surface, borderRadius: 12, padding: '48px 40px',
        width: '100%', maxWidth: 400,
        boxShadow: `0 8px 32px ${alpha(TOKENS.ink, 0.45)}`,
        border: `1px solid ${TOKENS.border}`,
      }}>
        <h1 style={{ fontSize: 'var(--type-display-italic-size)', color: TOKENS.parchment, marginBottom: 8 }}>
          Admin Console
        </h1>
        <p style={{ color: TOKENS.muted, fontSize: 'var(--type-mono-size)', marginBottom: 28 }}>Terranthro</p>

        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Email</label>
          <input
            type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={adminInputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 14 }}>Password</label>
          <input
            type="password" required value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={adminInputStyle}
          />

          {error && <p style={{ color: TOKENS.danger, fontSize: 'var(--type-mono-size)', marginTop: 12 }}>{error}</p>}

          <button type="submit" disabled={loading} style={{
            width: '100%', padding: '11px 0', borderRadius: 8, border: 'none',
            background: TOKENS.electricBlue, color: TOKENS.ink, fontSize: 'var(--type-body-size)', fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer', marginTop: 20,
            opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 'var(--type-body-size)', color: TOKENS.ghost, marginBottom: 4 };
const adminInputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: 8,
  border: `1px solid ${TOKENS.border}`, fontSize: 'var(--type-body-size)',
  color: TOKENS.parchment, background: TOKENS.surfaceRaised,
  outline: 'none',
};
