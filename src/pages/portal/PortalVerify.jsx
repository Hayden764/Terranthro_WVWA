import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { alpha, border, crimson, ink, muted, parchment, TOKENS } from '../../styles/tokens';
import { apiFetch } from '../../lib/api';

export default function PortalVerify() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying'); // 'verifying' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setStatus('error');
      setErrorMsg('No token provided');
      return;
    }

    (async () => {
      try {
        const res = await apiFetch(`/api/auth/verify?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (res.ok) {
          setStatus('success');
          setTimeout(() => navigate('/portal/dashboard', { replace: true }), 1500);
        } else {
          setStatus('error');
          setErrorMsg(data.error || 'Verification failed');
        }
      } catch {
        setStatus('error');
        setErrorMsg('Network error');
      }
    })();
  }, [params, navigate]);

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
        textAlign: 'center',
      }}>
        {status === 'verifying' && (
          <>
            <div style={{ fontSize: 32, marginBottom: 16 }}>⏳</div>
            <p style={{ color: muted }}>Verifying your sign-in link…</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div style={{ fontSize: 32, marginBottom: 16 }}>✓</div>
            <p style={{ color: TOKENS.success, fontWeight: 600 }}>Signed in! Redirecting…</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div style={{ fontSize: 32, marginBottom: 16 }}>✗</div>
            <p style={{ color: crimson, marginBottom: 16 }}>{errorMsg}</p>
            <a href="/portal" style={{ color: ink, fontWeight: 500 }}>
              Back to sign in
            </a>
          </>
        )}
      </div>
    </div>
  );
}
