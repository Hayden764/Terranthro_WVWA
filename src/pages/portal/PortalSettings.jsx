import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { border, crimson, ink, muted, parchment, TOKENS } from '../../styles/tokens';
import { INPUT_STYLE, btn } from '../../styles/patterns';
import { apiJson, apiPost } from '../../lib/api';

/**
 * PortalSettings — account-level settings, reached from the profile menu.
 * Holds the systematic account changes (Username, Password, Email), kept
 * separate from the public-facing winery profile (description/phone/website),
 * which stays on /portal/profile.
 */
export default function PortalSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  const mustChangePassword = Boolean(location.state?.mustChangePassword);
  const [profile, setProfile] = useState(null);

  const load = useCallback(async () => {
    try {
      const p = await apiJson('/api/portal/profile');
      setProfile(p);
    } catch {
      navigate('/portal', { replace: true });
    }
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  if (!profile) {
    return <Shell><p style={{ color: muted }}>Loading…</p></Shell>;
  }

  return (
    <Shell>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Link to="/portal/dashboard" style={{ color: muted, fontSize: 'var(--type-mono-size)' }}>← Dashboard</Link>
      </div>

      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--type-display-italic-size)', color: ink, marginBottom: 8 }}>
        Account Settings
      </h1>
      <p style={{ color: muted, fontSize: 'var(--type-mono-size)', marginBottom: 24 }}>
        Manage how you sign in. To edit your public winery profile,{' '}
        <Link to="/portal/profile" style={{ color: crimson, fontWeight: 600 }}>go to Edit Profile</Link>.
      </p>

      {mustChangePassword && (
        <div style={{
          background: TOKENS.warningDim,
          border: `1px solid ${TOKENS.warning}`,
          borderRadius: 8,
          padding: '14px 16px',
          color: TOKENS.warning,
          fontSize: 'var(--type-body-size)',
          lineHeight: 1.6,
          marginBottom: 24,
        }}>
          <strong>Password update required.</strong> Replace the temporary password below before continuing.
        </div>
      )}

      <UsernameSection currentUsername={profile.username} onSaved={load} />

      <hr style={{ margin: '36px 0', border: 'none', borderTop: `1px solid ${border}` }} />
      <PasswordSection hasPassword={profile.has_password} onSaved={load} />

      <hr style={{ margin: '36px 0', border: 'none', borderTop: `1px solid ${border}` }} />
      <EmailSection currentEmail={profile.contact_email} />
    </Shell>
  );
}

/* ── Username ── */
function UsernameSection({ currentUsername, onSaved }) {
  const [username, setUsername] = useState(currentUsername || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => { setUsername(currentUsername || ''); }, [currentUsername]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(false);
    const normalized = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,64}$/.test(normalized)) {
      setError('Username must be 3–64 characters: lowercase letters, digits, and . _ - only');
      return;
    }
    setSaving(true);
    try {
      await apiPost('/api/auth/set-username', { username: normalized });
      setSuccess(true);
      onSaved?.();
    } catch (err) {
      setError(err.message || 'Failed to update username');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--type-display-italic-size)', color: ink, marginBottom: 6 }}>
        Username
      </h2>
      <p style={{ color: muted, fontSize: 'var(--type-mono-size)', marginBottom: 20 }}>
        Your username is one of the ways you sign in (you can also use your email).
      </p>

      {success ? (
        <div style={{
          background: TOKENS.successDim, border: `1px solid ${TOKENS.success}`, borderRadius: 8,
          padding: '14px 16px', color: TOKENS.success, fontSize: 'var(--type-body-size)',
        }}>
          Username updated to <strong>{username.trim().toLowerCase()}</strong>.
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ maxWidth: 340 }}>
          <Field label="Username">
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. bethel-heights"
              autoCapitalize="none"
              autoCorrect="off"
              className="ds-input"
              style={inputStyle}
            />
          </Field>
          {error && <p style={{ color: crimson, fontSize: 'var(--type-mono-size)', marginBottom: 12 }}>{error}</p>}
          <button type="submit" disabled={saving} style={btnStyle(saving)}>
            {saving ? 'Saving…' : 'Save Username'}
          </button>
        </form>
      )}
    </div>
  );
}

/* ── Password ── */
function PasswordSection({ hasPassword, onSaved }) {
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
      onSaved?.();
    } catch (err) {
      setPwError(err.message || 'Failed to update password');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--type-display-italic-size)', color: ink, marginBottom: 6 }}>
        {hasPassword ? 'Change Password' : 'Set a Password'}
      </h2>
      <p style={{ color: muted, fontSize: 'var(--type-mono-size)', marginBottom: 20 }}>
        {hasPassword
          ? 'Update your portal login password. If support gave you a temporary password, change it here right after signing in.'
          : 'Set a password so you can log in without an email link.'}
      </p>

      {pwSuccess ? (
        <div style={{
          background: TOKENS.successDim, border: `1px solid ${TOKENS.success}`, borderRadius: 8,
          padding: '14px 16px', color: TOKENS.success, fontSize: 'var(--type-body-size)',
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
                className="ds-input"
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
              className="ds-input"
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
              className="ds-input"
              style={inputStyle}
            />
          </Field>

          {pwError && <p style={{ color: crimson, fontSize: 'var(--type-mono-size)', marginBottom: 12 }}>{pwError}</p>}

          <button type="submit" disabled={saving} style={btnStyle(saving)}>
            {saving ? 'Saving…' : hasPassword ? 'Update Password' : 'Set Password'}
          </button>
        </form>
      )}
    </div>
  );
}

/* ── Email ── */
function EmailSection({ currentEmail }) {
  const [newEmail, setNewEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setEmailError('');
    setEmailSuccess(false);

    if (!newEmail.trim()) {
      setEmailError('New email is required');
      return;
    }

    if (currentEmail && newEmail.trim().toLowerCase() === currentEmail.toLowerCase()) {
      setEmailError('New email is the same as your current email');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      setEmailError('Please enter a valid email address');
      return;
    }

    setSaving(true);
    try {
      await apiPost('/api/auth/change-email', { newEmail: newEmail.trim() });
      setEmailSuccess(true);
      setNewEmail('');
    } catch (err) {
      setEmailError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--type-display-italic-size)', color: ink, marginBottom: 6 }}>
        {currentEmail ? 'Change Email' : 'Add an Email'}
      </h2>
      <p style={{ color: muted, fontSize: 'var(--type-mono-size)', marginBottom: 20 }}>
        {currentEmail
          ? <>Current email: <strong>{currentEmail}</strong><br /></>
          : <>No email on file yet.<br /></>}
        We'll send a verification link to your new email address.
      </p>

      {emailSuccess ? (
        <div style={{
          background: TOKENS.successDim, border: `1px solid ${TOKENS.success}`, borderRadius: 8,
          padding: '14px 16px', color: TOKENS.success, fontSize: 'var(--type-body-size)',
        }}>
          Verification email sent! Please check your inbox and click the link to confirm your new email address.
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ maxWidth: 340 }}>
          <Field label="New email">
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="your.new@email.com"
              className="ds-input"
              style={inputStyle}
            />
          </Field>

          {emailError && <p style={{ color: crimson, fontSize: 'var(--type-mono-size)', marginBottom: 12 }}>{emailError}</p>}

          <button type="submit" disabled={saving} style={btnStyle(saving)}>
            {saving ? 'Sending…' : 'Send Verification Link'}
          </button>
        </form>
      )}
    </div>
  );
}

/* ── Shared bits ── */
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
