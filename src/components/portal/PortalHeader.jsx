/**
 * PortalHeader — shared portal top bar.
 *
 * Left:  organization name + a small "Winery Portal" caption.
 * Right: a profile button (initials avatar) that opens a dropdown with
 *        "Account Settings" (→ /portal/settings) and "Sign Out".
 *
 * Props:
 *   title    {string}  organization / winery name shown on the left.
 *   subtitle {string}  optional caption (default "Winery Portal").
 */
import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { alpha, border, ink, muted, parchment, TOKENS } from '../../styles/tokens';
import { apiPost } from '../../lib/api';

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function PortalHeader({ title, subtitle = 'Winery Portal' }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  // Close the dropdown on outside-click or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function handleLogout() {
    await apiPost('/api/auth/logout', {});
    navigate('/portal', { replace: true });
  }

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: 32,
    }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--type-display-medium-size)', color: ink, margin: 0 }}>
          {title}
        </h1>
        <p style={{ color: muted, fontSize: 'var(--type-mono-size)', marginTop: 4 }}>{subtitle}</p>
      </div>

      <div ref={menuRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Account"
          style={{
            width: 40, height: 40, borderRadius: '50%',
            border: `1px solid ${border}`,
            background: parchment,
            color: ink, fontWeight: 700, fontSize: 'var(--type-mono-size)',
            fontFamily: 'var(--font-sans)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {initialsOf(title)}
        </button>

        {open && (
          <div
            role="menu"
            style={{
              position: 'absolute', right: 0, top: 48, zIndex: 50,
              minWidth: 180, background: parchment,
              border: `1px solid ${border}`, borderRadius: 10,
              boxShadow: `0 8px 24px ${alpha(TOKENS.ink, 0.14)}`,
              overflow: 'hidden',
            }}
          >
            <Link to="/portal/settings" role="menuitem" onClick={() => setOpen(false)} style={menuItemStyle}>
              Account Settings
            </Link>
            <div style={{ height: 1, background: border }} />
            <button role="menuitem" onClick={handleLogout} style={{ ...menuItemStyle, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: TOKENS.crimson }}>
              Sign Out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const menuItemStyle = {
  display: 'block',
  padding: '11px 16px',
  fontSize: 'var(--type-body-size)',
  fontFamily: 'var(--font-sans)',
  color: ink,
  textDecoration: 'none',
};
