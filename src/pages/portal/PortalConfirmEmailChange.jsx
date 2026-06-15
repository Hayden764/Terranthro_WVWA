import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { alpha, border, crimson, ink, muted, parchment, TOKENS } from '../../styles/tokens';
import { apiFetch } from '../../lib/api';

export default function PortalConfirmEmailChange() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('confirming'); // 'confirming' | 'success' | 'error'
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
        const res = await apiFetch(`/api/auth/confirm-email-change?token=${encodeURIComponent(token)}`, {
          method: 'POST',
        });
        const data = await res.json();
        if (res.ok) {
          setStatus('success');
          setTimeout(() => navigate('/portal/dashboard', { replace: true }), 2000);
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
        {status === 'confirming' && (
          <>
            <div style={{ fontSize: 'var(--type-display-medium-size)', marginBottom: 16 }}>⏳</div>
            <p style={{ color: muted }}>Confirming your email change…</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div style={{ fontSize: 'var(--type-display-medium-size)', marginBottom: 16 }}>✓</div>
            <p style={{ color: TOKENS.success, fontWeight: 600 }}>Email changed successfully! Redirecting…</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div style={{ fontSize: 'var(--type-display-medium-size)', marginBottom: 16 }}>✗</div>
            <p style={{ color: crimson, marginBottom: 16 }}>{errorMsg}</p>
            <a href="/portal/dashboard" style={{ color: ink, fontWeight: 500 }}>
              Back to dashboard
            </a>
          </>
        )}
      </div>
    </div>
  );
}
