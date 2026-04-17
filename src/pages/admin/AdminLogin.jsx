import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BRAND } from '../../config/brandColors';
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
      minHeight: '100vh', background: '#1a1a2e',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{
        background: '#16213e', borderRadius: 12, padding: '48px 40px',
        width: '100%', maxWidth: 400,
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
        <h1 style={{ fontSize: 22, color: '#e0e0e0', marginBottom: 8 }}>
          Admin Console
        </h1>
        <p style={{ color: '#888', fontSize: 13, marginBottom: 28 }}>Terranthro</p>

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

          {error && <p style={{ color: '#ff6b6b', fontSize: 13, marginTop: 12 }}>{error}</p>}

          <button type="submit" disabled={loading} style={{
            width: '100%', padding: '11px 0', borderRadius: 8, border: 'none',
            background: '#4a90d9', color: '#fff', fontSize: 14, fontWeight: 600,
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

const labelStyle = { display: 'block', fontSize: 12, color: '#aaa', marginBottom: 4 };
const adminInputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.10)', fontSize: 14,
  color: '#e0e0e0', background: 'rgba(255,255,255,0.05)',
  outline: 'none',
};
