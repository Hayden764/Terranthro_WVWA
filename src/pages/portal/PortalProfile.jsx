import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { crimson, ink, muted, parchment, border, TOKENS } from '../../styles/tokens';
import { INPUT_STYLE, btn } from '../../styles/patterns';
import { apiJson, apiPost } from '../../lib/api';

export default function PortalProfile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ description: '', phone: '', url: '', image_url: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const p = await apiJson('/api/portal/profile');
      setProfile(p);
      setForm({
        description: p.description || '',
        phone: p.phone || '',
        url: p.url || '',
        image_url: p.image_url || '',
      });
    } catch {
      navigate('/portal', { replace: true });
    }
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  function handleChange(field) {
    return (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    // Only send changed fields
    const payload = {};
    if (form.description !== (profile?.description || '')) payload.description = form.description;
    if (form.phone !== (profile?.phone || '')) payload.phone = form.phone;
    if (form.url !== (profile?.url || '')) payload.url = form.url;
    if (form.image_url !== (profile?.image_url || '')) payload.image_url = form.image_url;

    if (Object.keys(payload).length === 0) {
      setError('No changes detected');
      setSubmitting(false);
      return;
    }

    try {
      await apiPost('/api/portal/requests', {
        request_type: 'profile',
        payload,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!profile) {
    return <Shell><p style={{ color: muted }}>Loading…</p></Shell>;
  }

  return (
    <Shell>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Link to="/portal/dashboard" style={{ color: muted, fontSize: 'var(--type-mono-size)' }}>← Dashboard</Link>
      </div>

      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--type-display-italic-size)', color: ink, marginBottom: 8 }}>
        Edit Profile
      </h1>
      <p style={{ color: muted, fontSize: 'var(--type-mono-size)', marginBottom: 24 }}>
        Changes are submitted for review and applied once approved. To update your
        login (username, password, email), go to{' '}
        <Link to="/portal/settings" style={{ color: crimson, fontWeight: 600 }}>Account Settings</Link>.
      </p>

      {submitted ? (
        <div style={{
          background: TOKENS.successDim, border: `1px solid ${TOKENS.success}`, borderRadius: 8,
          padding: '20px 16px', color: TOKENS.success, fontSize: 'var(--type-body-size)', lineHeight: 1.6,
        }}>
          <strong>Request submitted!</strong> Your changes will be reviewed shortly.{' '}
          <Link to="/portal/dashboard" style={{ color: TOKENS.success, fontWeight: 600 }}>
            Back to dashboard
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <Field label="Description" multiline>
            <textarea
              value={form.description}
              onChange={handleChange('description')}
              rows={5}
              className="ds-input"
              style={inputStyle}
            />
          </Field>

          <Field label="Phone">
            <input type="tel" value={form.phone} onChange={handleChange('phone')} className="ds-input" style={inputStyle} />
          </Field>

          <Field label="Website URL">
            <input type="url" value={form.url} onChange={handleChange('url')} className="ds-input" style={inputStyle} />
          </Field>

          <Field label="Image URL">
            <input type="url" value={form.image_url} onChange={handleChange('image_url')} className="ds-input" style={inputStyle} />
          </Field>

          {error && <p style={{ color: crimson, fontSize: 'var(--type-mono-size)', marginBottom: 12 }}>{error}</p>}

          <button type="submit" disabled={submitting} style={btnStyle(submitting)}>
            {submitting ? 'Submitting…' : 'Submit for Review'}
          </button>
        </form>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: parchment, fontFamily: 'var(--font-sans)' }}>
      <div style={{
        maxWidth: 600, margin: '0 auto', padding: '40px 20px',
        background: parchment, minHeight: '100vh',
        borderLeft: `1px solid ${border}`,
        borderRight: `1px solid ${border}`,
      }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', fontSize: 'var(--type-mono-size)', fontWeight: 500, color: muted, marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  ...INPUT_STYLE,
  resize: 'vertical',
};

function btnStyle(disabled) {
  return {
    ...btn('primary', { padding: '10px 28px' }),
    cursor: disabled ? 'wait' : 'pointer',
    opacity: disabled ? 0.7 : 1,
  };
}
