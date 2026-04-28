import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { border, crimson, ink, parchment, TOKENS } from '../../styles/tokens';
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
    return <Shell><p style={{ color: inkMuted }}>Loading…</p></Shell>;
  }

  return (
    <Shell>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Link to="/portal/dashboard" style={{ color: inkLight, fontSize: 13 }}>← Dashboard</Link>
      </div>

      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: ink, marginBottom: 8 }}>
        Edit Profile
      </h1>
      <p style={{ color: inkMuted, fontSize: 13, marginBottom: 24 }}>
        Changes are submitted for review and applied once approved.
      </p>

      {submitted ? (
        <div style={{
          background: TOKENS.successDim, border: `1px solid ${TOKENS.success}`, borderRadius: 8,
          padding: '20px 16px', color: TOKENS.success, fontSize: 14, lineHeight: 1.6,
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
              style={inputStyle}
            />
          </Field>

          <Field label="Phone">
            <input type="tel" value={form.phone} onChange={handleChange('phone')} style={inputStyle} />
          </Field>

          <Field label="Website URL">
            <input type="url" value={form.url} onChange={handleChange('url')} style={inputStyle} />
          </Field>

          <Field label="Image URL">
            <input type="url" value={form.image_url} onChange={handleChange('image_url')} style={inputStyle} />
          </Field>

          {error && <p style={{ color: crimson, fontSize: 13, marginBottom: 12 }}>{error}</p>}

          <button type="submit" disabled={submitting} style={btnStyle(submitting)}>
            {submitting ? 'Submitting…' : 'Submit for Review'}
          </button>
        </form>
      )}

      {/* ── Password ── */}
      <hr style={{ margin: '36px 0', border: 'none', borderTop: `1px solid ${border}` }} />
      <PasswordSection hasPassword={profile.has_password} />
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
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: inkLight, marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 8,
  border: `1px solid ${border}`,
  fontSize: 14,
  color: ink,
  background: parchment,
  outline: 'none',
  fontFamily: 'var(--font-sans)',
  resize: 'vertical',
};

function btnStyle(disabled) {
  return {
    padding: '10px 28px',
    borderRadius: 8,
    border: 'none',
    background: ink,
    color: parchment,
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? 'wait' : 'pointer',
    opacity: disabled ? 0.7 : 1,
  };
}

function PasswordSection({ hasPassword }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setPwError('');
    setPwSuccess(false);

    if (newPassword.length < 8) {
      setPwError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirm) {
      setPwError('Passwords do not match');
      return;
    }

    setSaving(true);
    try {
      const body = { password: newPassword };
      if (hasPassword) body.currentPassword = currentPassword;
      await apiPost('/api/auth/set-password', body);
      setPwSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      setPwError(err.message || 'Failed to update password');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: ink, marginBottom: 6 }}>
        {hasPassword ? 'Change Password' : 'Set a Password'}
      </h2>
      <p style={{ color: inkMuted, fontSize: 13, marginBottom: 20 }}>
        {hasPassword
          ? 'Update your portal login password.'
          : 'Set a password so you can log in without an email link.'}
      </p>

      {pwSuccess ? (
        <div style={{
          background: TOKENS.successDim, border: `1px solid ${TOKENS.success}`, borderRadius: 8,
          padding: '14px 16px', color: TOKENS.success, fontSize: 14,
        }}>
          Password {hasPassword ? 'updated' : 'set'} successfully.
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ maxWidth: 340 }}>
          {hasPassword && (
            <Field label="Current password">
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
              />
            </Field>
          )}
          <Field label="New password">
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min. 8 characters"
              style={inputStyle}
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              style={inputStyle}
            />
          </Field>

          {pwError && <p style={{ color: crimson, fontSize: 13, marginBottom: 12 }}>{pwError}</p>}

          <button type="submit" disabled={saving} style={btnStyle(saving)}>
            {saving ? 'Saving…' : hasPassword ? 'Update Password' : 'Set Password'}
          </button>
        </form>
      )}
    </div>
  );
}
