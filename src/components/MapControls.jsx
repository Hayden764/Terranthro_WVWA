import { useState, useCallback, useEffect, useRef } from 'react';
import { alpha, MAP_GLASS, TOKENS } from '../styles/tokens';

// UI constants for map control styling — all surfaces consume the shared
// MAP_GLASS token family so every floating map element stays consistent.
const UI = {
  compassNeedle:    alpha(TOKENS.crimson, 0.92),
  compassBack:      alpha(TOKENS.ink, 0.35),
  compassCircle:    alpha(TOKENS.ink, 0.12),
  compassNorth:     alpha(TOKENS.ink, 0.5),
  compassMarkFaint: alpha(TOKENS.ink, 0.2),
};

const BTN_BASE = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 40, height: 40, borderRadius: MAP_GLASS.radius, cursor: 'pointer',
  border: `1px solid ${MAP_GLASS.border}`,
  background: MAP_GLASS.bg,
  color: MAP_GLASS.text,
  boxShadow: MAP_GLASS.shadow,
  transition: 'background 0.15s, color 0.15s, border-color 0.15s, transform 0.15s',
};

/**
 * Floating map controls: a compass dial and a reset-view button, bottom-left.
 *
 * Zoom and pitch buttons used to live here too, in a tall rail down the middle
 * of the left edge. Both are gestures every map user already has — scroll or
 * pinch to zoom, two-finger drag to pitch — so on a phone the rail was chrome
 * over the map for no gain. The 3D terrain toggle went with them.
 */
export default function MapControls({ map, mapLoaded, selectedAva, onSelectAva, onResetView }) {
  const [bearing, setBearing] = useState(0);

  const handleResetView = useCallback(() => { onResetView?.(); }, [onResetView]);

  // Track bearing for compass needle
  useEffect(() => {
    if (!map) return;
    const onRotate = () => setBearing(map.getBearing());
    map.on('rotate', onRotate);
    return () => map.off('rotate', onRotate);
  }, [map]);

  const handleResetNorth = useCallback(() => {
    map?.resetNorth({ duration: 400 });
  }, [map]);

  if (!map || !mapLoaded) return null;

  return (
    <div style={{
      // bottom clears the basemap attribution line.
      position: 'absolute', left: 16, bottom: 26, zIndex: 30,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {/* Compass dial — drag to rotate, click to reset north */}
      <CompassDial map={map} bearing={bearing} onResetNorth={handleResetNorth} />

      {/* Reset view */}
      <ControlBtn style={BTN_BASE} onClick={handleResetView} title="Reset to Willamette Valley">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      </ControlBtn>
    </div>
  );
}

function CompassDial({ map, bearing, onResetNorth }) {
  const dialRef = useRef(null);
  const dragging = useRef(false);
  const startAngle = useRef(0);
  const startBearing = useRef(0);
  const startPos = useRef({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const getAngle = (e) => {
    const rect = dialRef.current.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    return Math.atan2(dx, -dy) * (180 / Math.PI);
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    dialRef.current?.setPointerCapture(e.pointerId);
    dragging.current = true;
    startAngle.current = getAngle(e);
    startBearing.current = map?.getBearing() ?? 0;
    startPos.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
  };

  const onPointerMove = (e) => {
    if (!dragging.current || !map) return;
    const delta = getAngle(e) - startAngle.current;
    map.rotateTo(startBearing.current + delta, { duration: 0 });
  };

  const onPointerUp = (e) => {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    if (Math.sqrt(dx * dx + dy * dy) < 4) onResetNorth?.();
  };

  return (
    <div
      ref={dialRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title="Drag to rotate · click to reset north"
      className="tx-box"
      style={{
        width: 40, height: 40, borderRadius: '50%',
        cursor: isDragging ? 'grabbing' : 'grab',
        background: MAP_GLASS.bg,
        border: `1px solid ${MAP_GLASS.border}`,
        boxShadow: MAP_GLASS.shadow,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        userSelect: 'none', touchAction: 'none',
      }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
        style={{ transform: `rotate(${-bearing}deg)`, transition: isDragging ? 'none' : 'transform 0.1s linear', pointerEvents: 'none' }}>
        <circle cx="12" cy="12" r="10" stroke={UI.compassCircle} strokeWidth="1" fill="none" />
        <line x1="12" y1="2" x2="12" y2="5" stroke={UI.compassNorth} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="22" y1="12" x2="19" y2="12" stroke={UI.compassMarkFaint} strokeWidth="1" strokeLinecap="round" />
        <line x1="12" y1="22" x2="12" y2="19" stroke={UI.compassMarkFaint} strokeWidth="1" strokeLinecap="round" />
        <line x1="2" y1="12" x2="5" y2="12" stroke={UI.compassMarkFaint} strokeWidth="1" strokeLinecap="round" />
        <polygon points="12,3 14,11 12,9 10,11" fill={UI.compassNeedle} />
        <polygon points="12,21 14,13 12,15 10,13" fill={UI.compassBack} />
      </svg>
    </div>
  );
}

// Hover/focus highlight (blue border + icon) comes from the shared .tx-box/.tx-link classes
function ControlBtn({ style, onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="tx-box tx-link"
      style={style}
    >
      {children}
    </button>
  );
}
