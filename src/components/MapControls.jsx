import { useState, useCallback, useEffect, useRef } from 'react';
import { alpha, ink, mix, TOKENS } from '../styles/tokens';

const MAX_PITCH_FLAT = 85;
const MAX_PITCH_WITH_TERRAIN = 71;

// UI constants for map control styling
const UI = {
  btnBorder: alpha(TOKENS.parchment, 0.18),
  btnBg: mix(TOKENS.ink, 82, TOKENS.parchment),
  btnText: alpha(TOKENS.parchment, 0.88),
  btnActiveBg: alpha(TOKENS.crimson, 0.78),
  btnActiveBorder: alpha(TOKENS.crimson, 0.55),
  btnActiveText: alpha(TOKENS.parchment, 0.98),
  separator: alpha(TOKENS.parchment, 0.1),
  pitchLabel: alpha(TOKENS.parchment, 0.6),
  compassBg: mix(TOKENS.ink, 82, TOKENS.parchment),
  compassNeedle: alpha(TOKENS.danger, 0.92),
  compassBack: alpha(TOKENS.parchment, 0.55),
  compassCircle: alpha(TOKENS.parchment, 0.1),
  compassNorth: alpha(TOKENS.parchment, 0.4),
  compassMarkFaint: alpha(TOKENS.parchment, 0.18),
  shadowDark: alpha('black', 0.25),
};

const BTN_BASE = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 36, height: 36, borderRadius: 8, cursor: 'pointer',
  border: `1px solid ${UI.btnBorder}`,
  background: UI.btnBg,
  color: UI.btnText,
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  boxShadow: `0 2px 8px ${UI.shadowDark}`,
  transition: 'background 0.15s, color 0.15s, border-color 0.15s',
};

const BTN_ACTIVE = {
  ...BTN_BASE,
  background: UI.btnActiveBg,
  border: `1px solid ${UI.btnActiveBorder}`,
  color: UI.btnActiveText,
};

export default function MapControls({ map, mapLoaded, selectedAva, onSelectAva, onResetView }) {
  const [terrainActive, setTerrainActive] = useState(false);
  const [bearing, setBearing] = useState(0);
  const [pitch, setPitch] = useState(0);

  const handleZoomIn = useCallback(() => { map?.zoomIn({ duration: 300 }); }, [map]);
  const handleZoomOut = useCallback(() => { map?.zoomOut({ duration: 300 }); }, [map]);

  const handleResetView = useCallback(() => { onResetView?.(); }, [onResetView]);

  const handleToggleTerrain = useCallback(() => {
    if (!map) return;
    const terrain = map.getTerrain?.();
    if (terrain) {
      map.setTerrain(null);
      map.setMaxPitch(MAX_PITCH_FLAT);
      setTerrainActive(false);
    } else {
      if (!map.getSource('terrainSource')) {
        map.addSource('terrainSource', {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: 15,
        });
      }
      map.setTerrain({ source: 'terrainSource', exaggeration: 1.5 });
      map.setMaxPitch(MAX_PITCH_WITH_TERRAIN);
      if ((map.getPitch?.() || 0) > MAX_PITCH_WITH_TERRAIN) map.setPitch(MAX_PITCH_WITH_TERRAIN);
      setTerrainActive(true);
    }
  }, [map]);

  // Track bearing for compass needle
  useEffect(() => {
    if (!map) return;
    const onRotate = () => setBearing(map.getBearing());
    map.on('rotate', onRotate);
    return () => map.off('rotate', onRotate);
  }, [map]);

  // Track pitch for step buttons
  useEffect(() => {
    if (!map) return;
    setPitch(Math.round(map.getPitch?.() || 0));
    const onPitch = () => setPitch(Math.round(map.getPitch()));
    map.on('pitch', onPitch);
    return () => map.off('pitch', onPitch);
  }, [map]);

  const handlePitchUp = useCallback(() => {
    if (!map) return;
    const next = Math.min((map.getPitch?.() || 0) + 10, 70);
    map.easeTo({ pitch: next, duration: 300 });
  }, [map]);

  const handlePitchDown = useCallback(() => {
    if (!map) return;
    const next = Math.max((map.getPitch?.() || 0) - 10, 0);
    map.easeTo({ pitch: next, duration: 300 });
  }, [map]);

  const handleResetNorth = useCallback(() => {
    map?.resetNorth({ duration: 400 });
  }, [map]);

  const maxPitch = terrainActive ? MAX_PITCH_WITH_TERRAIN : MAX_PITCH_FLAT;

  if (!map || !mapLoaded) return null;

  return (
    <div style={{
      position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', zIndex: 30,
      display: 'flex', flexDirection: 'column', gap: 5,
    }}>

      {/* Zoom cluster */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <ControlBtn style={BTN_BASE} onClick={handleZoomIn} title="Zoom in">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </ControlBtn>
        <ControlBtn style={BTN_BASE} onClick={handleZoomOut} title="Zoom out">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </ControlBtn>
      </div>

      {/* Separator */}
      <div style={{ height: 1, background: UI.separator, margin: '2px 4px' }} />

      {/* Pitch step buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <ControlBtn style={pitch >= 70 ? { ...BTN_BASE, opacity: 0.35, cursor: 'default' } : BTN_BASE} onClick={handlePitchUp} title="Increase pitch (+10°)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </ControlBtn>
        <div style={{ fontSize: 'var(--type-ui-label-size)', color: UI.pitchLabel, fontFamily: 'var(--font-mono)', fontWeight: 600, textAlign: 'center', userSelect: 'none', lineHeight: 1 }}>{pitch}°</div>
        <ControlBtn style={pitch <= 0 ? { ...BTN_BASE, opacity: 0.35, cursor: 'default' } : BTN_BASE} onClick={handlePitchDown} title="Decrease pitch (-10°)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </ControlBtn>
      </div>

      {/* Separator */}
      <div style={{ height: 1, background: UI.separator, margin: '2px 4px' }} />

      {/* Compass dial — drag to rotate, click to reset north */}
      <CompassDial map={map} bearing={bearing} onResetNorth={handleResetNorth} />

      {/* Separator */}
      <div style={{ height: 1, background: UI.separator, margin: '2px 4px' }} />

      {/* Reset view */}
      <ControlBtn style={BTN_BASE} onClick={handleResetView} title="Reset to Willamette Valley">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      </ControlBtn>

      {/* 3D terrain */}
      <ControlBtn style={terrainActive ? BTN_ACTIVE : BTN_BASE} onClick={handleToggleTerrain} title={terrainActive ? 'Disable 3D terrain' : 'Enable 3D terrain'}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3l4 8 5-5 5 15H2L8 3z" />
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
      style={{
        width: 36, height: 36, borderRadius: '50%',
        cursor: isDragging ? 'grabbing' : 'grab',
        background: UI.compassBg,
        border: `1px solid ${UI.btnBorder}`,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        boxShadow: `0 2px 8px ${UI.shadowDark}`,
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

function ControlBtn({ style, onClick, title, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...style,
        opacity: hovered ? 1 : 0.92,
        transform: hovered ? 'scale(1.06)' : 'scale(1)',
      }}
    >
      {children}
    </button>
  );
}
