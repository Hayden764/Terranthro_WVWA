import { useState, useCallback } from 'react';
import MapToolkit from './MapToolkit';
import DataLayerPanel from './DataLayerPanel';
import ScalePanel from './ScalePanel';
import InfoPanel from './InfoPanel';
import { BRAND } from '../../config/brandColors';
import { GLASS } from './glassTokens';

/**
 * DesktopDock — Left‑edge vertical icon strip with floating panels.
 * Adapted from the main Terranthro site for the WVWA wine palette.
 *
 * Buttons: View · Layers · Scale · Info
 * Only one left‑side panel open at a time; Info opens on the right independently.
 */

const DOCK_WIDTH = 52;

/* ─── Icon SVGs ────────────────────────────────────────────────────────── */
const ViewIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

const LayersIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

const ScaleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="9" y1="21" x2="9" y2="9" />
  </svg>
);

const InfoIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const BUTTONS = [
  { id: 'view',   label: 'View',   Icon: ViewIcon,   side: 'left' },
  { id: 'layers', label: 'Layers', Icon: LayersIcon,  side: 'left' },
  { id: 'scale',  label: 'Scale',  Icon: ScaleIcon,   side: 'left' },
  { id: 'info',   label: 'Info',   Icon: InfoIcon,    side: 'right' },
];

export default function DesktopDock({
  map,
  mapLoaded,
  selectedAva,
  onSelectAva,
  activeLayer,
  onLayerChange,
  currentMonth,
  onMonthChange,
  onHoverAva,
}) {
  // Left panels (View/Layers/Scale) are mutually exclusive
  const [leftPanel, setLeftPanel] = useState(null);   // 'view' | 'layers' | 'scale' | null
  // Info panel is independent — starts open
  const [infoOpen, setInfoOpen]   = useState(true);

  const toggleLeft = useCallback((id) => {
    setLeftPanel(prev => prev === id ? null : id);
  }, []);

  const toggleInfo = useCallback(() => {
    setInfoOpen(prev => !prev);
  }, []);

  /* ─── Floating panel shell (shared wrapper for left panels) ──────── */
  const PanelShell = ({ title, children }) => (
    <div style={{
      position: 'absolute',
      left: DOCK_WIDTH + 10,
      top: '50%',
      transform: 'translateY(-50%)',
      width: 272,
      maxHeight: 'calc(100vh - 120px)',
      background: GLASS.bg,
      backdropFilter: GLASS.blur,
      WebkitBackdropFilter: GLASS.blur,
      border: `1px solid ${GLASS.border}`,
      borderRadius: 14,
      boxShadow: GLASS.shadow,
      fontFamily: 'Inter, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 40,
      animation: 'dockFadeIn 0.18s ease-out',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${GLASS.borderLight}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 12,
          fontWeight: 700,
          color: GLASS.text,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          {title}
        </span>
        <button
          onClick={() => setLeftPanel(null)}
          style={{
            background: 'none',
            border: 'none',
            color: GLASS.textDim,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '2px 4px',
          }}
        >
          ✕
        </button>
      </div>
      {/* Body */}
      <div style={{ overflowY: 'auto', flex: 1, scrollbarWidth: 'thin', scrollbarColor: `${GLASS.textMuted} transparent` }}>
        {children}
      </div>
    </div>
  );

  return (
    <>
      {/* ── Dock strip ─────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute',
        left: 10,
        top: '50%',
        transform: 'translateY(-50%)',
        width: DOCK_WIDTH,
        background: GLASS.bg,
        backdropFilter: GLASS.blur,
        WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`,
        borderRadius: 14,
        boxShadow: GLASS.shadow,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '8px 0',
        zIndex: 50,
        fontFamily: 'Inter, sans-serif',
      }}>
        {BUTTONS.map(({ id, label, Icon }) => {
          const isActive = id === 'info' ? infoOpen : leftPanel === id;
          const handleClick = id === 'info' ? toggleInfo : () => toggleLeft(id);
          return (
            <button
              key={id}
              title={label}
              onClick={handleClick}
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                border: 'none',
                background: isActive ? GLASS.accentDim : 'transparent',
                color: isActive ? BRAND.eggshell : GLASS.textDim,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
                position: 'relative',
              }}
              onMouseEnter={e => {
                if (!isActive) e.currentTarget.style.background = 'rgba(250,247,242,0.08)';
              }}
              onMouseLeave={e => {
                if (!isActive) e.currentTarget.style.background = 'transparent';
              }}
            >
              <Icon />
              {/* Active indicator dot */}
              {isActive && (
                <div style={{
                  position: 'absolute',
                  left: 2,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 3,
                  height: 14,
                  borderRadius: 2,
                  background: BRAND.burgundy,
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Left panels (View / Layers / Scale) ────────────────────────── */}
      {leftPanel === 'view' && (
        <PanelShell title="View">
          <MapToolkit map={map} mapLoaded={mapLoaded} selectedAva={selectedAva} onSelectAva={onSelectAva} />
        </PanelShell>
      )}

      {leftPanel === 'layers' && (
        <PanelShell title="Layers">
          <DataLayerPanel
            activeLayer={activeLayer}
            onLayerChange={onLayerChange}
            currentMonth={currentMonth}
            onMonthChange={onMonthChange}
          />
        </PanelShell>
      )}

      {leftPanel === 'scale' && (
        <PanelShell title="Scale">
          <ScalePanel activeLayer={activeLayer} />
        </PanelShell>
      )}

      {/* ── Info panel (right side) — independent, always toggleable ──── */}
      {infoOpen && (
        <div style={{
          position: 'absolute',
          right: 16,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 288,
          maxHeight: 'calc(100vh - 120px)',
          background: GLASS.bg,
          backdropFilter: GLASS.blur,
          WebkitBackdropFilter: GLASS.blur,
          border: `1px solid ${GLASS.border}`,
          borderRadius: 14,
          boxShadow: GLASS.shadow,
          fontFamily: 'Inter, sans-serif',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          zIndex: 40,
          animation: 'dockFadeIn 0.18s ease-out',
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${GLASS.borderLight}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span style={{
              fontSize: 12,
              fontWeight: 700,
              color: GLASS.text,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}>
              Info
            </span>
            <button
              onClick={() => setInfoOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                color: GLASS.textDim,
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                padding: '2px 4px',
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ overflowY: 'auto', flex: 1, scrollbarWidth: 'thin', scrollbarColor: `${GLASS.textMuted} transparent` }}>
            <InfoPanel selectedAva={selectedAva} activeLayer={activeLayer} onSelectAva={onSelectAva} onHoverAva={onHoverAva} />
          </div>
        </div>
      )}

      {/* ── Keyframe animation ─────────────────────────────────────────── */}
      <style>{`
        @keyframes dockFadeIn {
          from { opacity: 0; transform: translateY(-50%) translateX(-6px); }
          to   { opacity: 1; transform: translateY(-50%) translateX(0); }
        }
      `}</style>
    </>
  );
}
