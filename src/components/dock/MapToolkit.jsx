import { BRAND } from '../../config/brandColors';
import { GLASS } from './glassTokens';
import { WV_SUB_AVAS } from '../../config/topographyConfig';

/**
 * MapToolkit — "View" panel content.
 * Zoom in/out, reset view, 3D terrain toggle, bearing/pitch.
 */

const WV_BOUNDS = [[-123.8, 44.0], [-122.0, 45.9]];
const MAX_PITCH_FLAT = 85;
const MAX_PITCH_WITH_TERRAIN = 71;

/* ─── Shared card style ─────────────────────────────────────────────── */
const CARD = {
  background: 'rgba(250,247,242,0.06)',
  border: `1px solid rgba(250,247,242,0.08)`,
  borderRadius: 10,
  padding: '10px 12px',
  marginBottom: 8,
};

const LABEL = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: GLASS.textDim,
  marginBottom: 6,
};

export default function MapToolkit({
  map,
  mapLoaded,
  selectedAva,
  onSelectAva,
  listingSymbologyPreset,
  onListingSymbologyPresetChange,
  listingSymbologyOptions = [],
}) {
  if (!map || !mapLoaded) return null;

  const handleZoomIn = () => map.zoomIn({ duration: 300 });
  const handleZoomOut = () => map.zoomOut({ duration: 300 });

  const handleResetView = () => {
    if (selectedAva) {
      onSelectAva(null);
    }
    map.fitBounds(WV_BOUNDS, { padding: 40, duration: 1200, pitch: 30, bearing: 0 });
  };

  const handleToggleTerrain = () => {
    const terrain = map.getTerrain();
    if (terrain) {
      map.setTerrain(null);
      map.setMaxPitch(MAX_PITCH_FLAT);
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
      if ((map.getPitch?.() || 0) > MAX_PITCH_WITH_TERRAIN) {
        map.setPitch(MAX_PITCH_WITH_TERRAIN);
      }
    }
  };

  const handleBearingChange = (e) => {
    map.setBearing(Number(e.target.value));
  };

  const handlePitchChange = (e) => {
    const nextPitch = Number(e.target.value);
    const terrainOn = !!map.getTerrain?.();
    const maxPitch = terrainOn ? MAX_PITCH_WITH_TERRAIN : MAX_PITCH_FLAT;
    map.setPitch(Math.min(nextPitch, maxPitch));
  };

  const terrain = map.getTerrain?.();
  const terrainActive = !!terrain;
  const pitchMax = terrainActive ? MAX_PITCH_WITH_TERRAIN : MAX_PITCH_FLAT;
  const currentBearing = Math.round(map.getBearing?.() || 0);
  const currentPitch = Math.round(map.getPitch?.() || 0);

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* ── Zoom Controls ────────────────────────────────────────────── */}
      <div style={CARD}>
        <div style={LABEL}>Zoom</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleZoomIn} style={btnStyle(false)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Zoom In</span>
          </button>
          <button onClick={handleZoomOut} style={btnStyle(false)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Zoom Out</span>
          </button>
        </div>
      </div>

      {/* ── Reset View ───────────────────────────────────────────────── */}
      <div style={CARD}>
        <button onClick={handleResetView} style={{
          ...btnStyle(false),
          width: '100%',
          justifyContent: 'center',
          background: GLASS.accentDim,
          borderColor: 'rgba(142,21,55,0.35)',
          color: BRAND.eggshell,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
          <span>Reset to Valley View</span>
        </button>
      </div>

      {/* ── 3D Terrain ───────────────────────────────────────────────── */}
      <div style={CARD}>
        <div style={LABEL}>3D Terrain</div>
        <button onClick={handleToggleTerrain} style={btnStyle(terrainActive)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3l4 8 5-5 5 15H2L8 3z" />
          </svg>
          <span>{terrainActive ? 'Terrain On' : 'Terrain Off'}</span>
        </button>
      </div>

      {/* ── Camera Controls ──────────────────────────────────────────── */}
      <div style={CARD}>
        <div style={LABEL}>Camera</div>

        {/* Bearing */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: GLASS.textDim }}>Bearing</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: GLASS.text }}>{currentBearing}°</span>
          </div>
          <input
            type="range"
            min={-180}
            max={180}
            value={currentBearing}
            onChange={handleBearingChange}
            style={sliderStyle}
          />
        </div>

        {/* Pitch */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: GLASS.textDim }}>Pitch</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: GLASS.text }}>{currentPitch}°</span>
          </div>
          <input
            type="range"
            min={0}
            max={pitchMax}
            value={currentPitch}
            onChange={handlePitchChange}
            style={sliderStyle}
          />
        </div>
      </div>

      {/* ── Winery Marker Symbology ─────────────────────────────────── */}
      {listingSymbologyOptions.length > 0 && (
        <div style={CARD}>
          <div style={LABEL}>Winery Marker Symbology</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {listingSymbologyOptions.map((option) => {
              const active = listingSymbologyPreset === option.id;
              return (
                <button
                  key={option.id}
                  onClick={() => onListingSymbologyPresetChange?.(option.id)}
                  style={{
                    ...btnStyle(active),
                    width: '100%',
                    justifyContent: 'space-between',
                    color: active ? BRAND.eggshell : GLASS.text,
                  }}
                >
                  <span>{option.label}</span>
                  <span style={{
                    fontSize: 10,
                    opacity: active ? 0.95 : 0.45,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}>
                    {active ? 'Active' : 'Apply'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Quick-jump to AVA ────────────────────────────────────────── */}
      {selectedAva && (() => {
        const ava = WV_SUB_AVAS.find(a => a.slug === selectedAva);
        return ava ? (
          <div style={CARD}>
            <div style={LABEL}>Current AVA</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: GLASS.text }}>{ava.name}</div>
          </div>
        ) : null;
      })()}
    </div>
  );
}

/* ─── Shared button style ─────────────────────────────────────────────── */
function btnStyle(active) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    padding: '7px 10px',
    borderRadius: 8,
    border: `1px solid ${active ? 'rgba(142,21,55,0.4)' : GLASS.borderLight}`,
    background: active ? GLASS.accentDim : 'transparent',
    color: active ? BRAND.eggshell : GLASS.textDim,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'Inter, sans-serif',
    cursor: 'pointer',
    transition: 'all 0.15s',
    letterSpacing: '0.02em',
  };
}

const sliderStyle = {
  width: '100%',
  height: 4,
  accentColor: BRAND.burgundy,
  cursor: 'pointer',
  WebkitAppearance: 'auto',
};
