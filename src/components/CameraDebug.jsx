/**
 * CameraDebug.jsx
 *
 * Dev-only overlay that displays live MapLibre camera state:
 * latitude, longitude, zoom, bearing, pitch, and camera altitude.
 *
 * Only rendered when import.meta.env.DEV is true.
 * Toggle visibility with the "CAM" button in the bottom-right corner.
 */

import { useEffect, useState, useCallback } from 'react';

const PANEL = {
  position: 'absolute',
  bottom: 16,
  right: 16,
  zIndex: 9999,
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontSize: 11,
  lineHeight: 1.6,
  pointerEvents: 'none',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 4,
};

const CARD = {
  background: 'rgba(10, 10, 16, 0.82)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 8,
  padding: '8px 12px',
  color: '#e8dfc8',
  minWidth: 220,
};

const TOGGLE_BTN = {
  pointerEvents: 'auto',
  background: 'rgba(10, 10, 16, 0.82)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 6,
  color: '#a89878',
  fontSize: 10,
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontWeight: 700,
  letterSpacing: '0.08em',
  padding: '3px 8px',
  cursor: 'pointer',
};

const COPY_BTN = {
  ...TOGGLE_BTN,
  fontSize: 9,
  padding: '2px 7px',
  color: '#7ec8a0',
  pointerEvents: 'auto',
};

const ROW = { display: 'flex', justifyContent: 'space-between', gap: 16 };
const KEY = { color: 'rgba(168,152,120,0.75)', userSelect: 'none' };
const VAL = { color: '#f0e8d2', fontWeight: 600 };

function fmt(n, dec = 6) {
  return n == null ? '—' : Number(n).toFixed(dec);
}

export default function CameraDebug({ map, mapLoaded }) {
  const [visible, setVisible] = useState(false);
  const [cam, setCam] = useState(null);
  const [copied, setCopied] = useState(false);

  const readCamera = useCallback(() => {
    if (!map) return;
    const center  = map.getCenter();
    const zoom    = map.getZoom();
    const bearing = map.getBearing();
    const pitch   = map.getPitch();

    // Approximate altitude in metres from zoom + latitude
    // MapLibre uses a 512-tile-pixel reference at zoom 0 with ~earth circumference
    const EARTH_CIRC_M = 40_075_016.686;
    const tileSize = 512;
    const metersPerPx = (EARTH_CIRC_M * Math.cos((center.lat * Math.PI) / 180)) /
      (tileSize * Math.pow(2, zoom));
    // MapLibre default canvas height ~512; altitude = dist such that fov covers it
    const fovRad = (36.87 * Math.PI) / 180; // ~default vertical fov
    const altitudeM = (512 * metersPerPx) / (2 * Math.tan(fovRad / 2));

    setCam({
      lat:      center.lat,
      lng:      center.lng,
      zoom,
      bearing,
      pitch,
      altM:     altitudeM,
    });
  }, [map]);

  useEffect(() => {
    if (!map || !mapLoaded) return;
    readCamera();
    map.on('move', readCamera);
    return () => map.off('move', readCamera);
  }, [map, mapLoaded, readCamera]);

  const handleCopy = () => {
    if (!cam) return;
    const text = `{ lng: ${fmt(cam.lng, 5)}, lat: ${fmt(cam.lat, 5)}, zoom: ${fmt(cam.zoom, 2)}, pitch: ${fmt(cam.pitch, 1)}, bearing: ${fmt(cam.bearing, 1)} }`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (!import.meta.env.DEV) return null;

  return (
    <div style={PANEL}>
      {visible && cam && (
        <div style={CARD}>
          <div style={{ color: 'rgba(126,200,160,0.7)', fontSize: 9, letterSpacing: '0.1em', marginBottom: 6 }}>
            CAMERA DEBUG
          </div>
          <div style={ROW}><span style={KEY}>lat</span>    <span style={VAL}>{fmt(cam.lat)}</span></div>
          <div style={ROW}><span style={KEY}>lng</span>    <span style={VAL}>{fmt(cam.lng)}</span></div>
          <div style={ROW}><span style={KEY}>zoom</span>   <span style={VAL}>{fmt(cam.zoom, 4)}</span></div>
          <div style={ROW}><span style={KEY}>bearing</span><span style={VAL}>{fmt(cam.bearing, 2)}°</span></div>
          <div style={ROW}><span style={KEY}>pitch</span>  <span style={VAL}>{fmt(cam.pitch, 2)}°</span></div>
          <div style={{ ...ROW, marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 4 }}>
            <span style={KEY}>alt</span>
            <span style={VAL}>{cam.altM >= 1000 ? `${fmt(cam.altM / 1000, 2)} km` : `${fmt(cam.altM, 0)} m`}</span>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        {visible && (
          <button style={COPY_BTN} onClick={handleCopy}>
            {copied ? '✓ copied' : 'copy'}
          </button>
        )}
        <button style={TOGGLE_BTN} onClick={() => setVisible(v => !v)}>
          CAM
        </button>
      </div>
    </div>
  );
}
