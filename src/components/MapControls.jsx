import { useState, useCallback } from 'react';
import { BRAND } from '../config/brandColors';

const WV_BOUNDS = [[-123.8, 44.0], [-122.0, 45.9]];
const MAX_PITCH_FLAT = 85;
const MAX_PITCH_WITH_TERRAIN = 71;

const BTN_BASE = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 36, height: 36, borderRadius: 8, cursor: 'pointer',
  border: '1px solid rgba(250,247,242,0.18)',
  background: 'rgba(46,34,26,0.82)',
  color: 'rgba(250,247,242,0.88)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
  transition: 'background 0.15s, color 0.15s, border-color 0.15s',
};

const BTN_ACTIVE = {
  ...BTN_BASE,
  background: 'rgba(142,21,55,0.78)',
  border: '1px solid rgba(142,21,55,0.55)',
  color: 'rgba(250,247,242,0.98)',
};

export default function MapControls({ map, mapLoaded, selectedAva, onSelectAva }) {
  const [terrainActive, setTerrainActive] = useState(false);

  const handleZoomIn = useCallback(() => { map?.zoomIn({ duration: 300 }); }, [map]);
  const handleZoomOut = useCallback(() => { map?.zoomOut({ duration: 300 }); }, [map]);

  const handleResetView = useCallback(() => {
    if (!map) return;
    if (selectedAva) onSelectAva?.(null);
    map.fitBounds(WV_BOUNDS, { padding: 40, duration: 1200, pitch: 30, bearing: 0 });
  }, [map, selectedAva, onSelectAva]);

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

  if (!map || !mapLoaded) return null;

  return (
    <div style={{
      position: 'absolute', bottom: 160, right: 16, zIndex: 30,
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
      <div style={{ height: 1, background: 'rgba(250,247,242,0.1)', margin: '2px 4px' }} />

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
