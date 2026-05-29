/**
 * SplitParcelModal — Step-by-step UI for splitting a vineyard parcel polygon.
 *
 * Step 1 — Draw: user draws a line across the parcel on the map. A client-side
 *   Turf.js split gives an instant coloured preview (blue / amber pieces).
 *
 * Step 2 — Assign: user assigns each block row to Piece A (blue) or Piece B
 *   (amber), and optionally sets a label for each resulting parcel.
 *
 * Step 3 — Confirm: POST to /api/admin/vineyards/:parcelId/split-geometry.
 *   On success the modal closes and onApplied is called with the two new ids.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import lineSplit from '@turf/line-split';
import area from '@turf/area';
import lineIntersect from '@turf/line-intersect';
import { feature as turfFeature, lineString, polygon as turfPolygon } from '@turf/helpers';
import { alpha, border, crimson, ink, muted, parchment, TOKENS } from '../../styles/tokens';
import { apiFetch } from '../../lib/api';
import PortalVineyardMap from '../PortalVineyardMap';

// ── Color constants for pieces ──────────────────────────────────────────────
const COLORS = {
  a:       '#3b82f6', // blue-500
  aBg:     'rgba(59,130,246,0.12)',
  aText:   '#1d4ed8', // blue-700
  b:       '#f59e0b', // amber-500
  bBg:     'rgba(245,158,11,0.12)',
  bText:   '#b45309', // amber-700
  unassigned: muted,
};

// ── Split a Polygon by a LineString into 2 Polygons (preview only) ──────────
// @turf/line-split splits LineStrings, not Polygons. To get two polygon halves
// for the on-map preview, we walk the polygon's outer ring (a closed
// LineString) and slice it into two arcs at the blade's two intersection
// points, then close each arc with a chord back to the start.
//
// This is a visual approximation only — the canonical split is performed
// server-side in PostGIS via ST_Split when the user confirms.
function splitPolygonPreview(polygonGeom, lineGeom) {
  if (!polygonGeom || polygonGeom.type !== 'Polygon') {
    return { error: 'Only single-Polygon parcels can be split here.' };
  }
  const outerRing = polygonGeom.coordinates[0];
  if (!outerRing || outerRing.length < 4) {
    return { error: 'Parcel polygon is malformed.' };
  }

  const lineFeature = turfFeature(lineGeom);
  const boundaryFeature = lineString(outerRing);

  const intersections = lineIntersect(boundaryFeature, lineFeature);
  const nIx = intersections?.features?.length ?? 0;
  if (nIx < 2) {
    return { error: 'The line did not cross the parcel boundary at two points. Draw a line that enters and exits the parcel.' };
  }
  if (nIx > 2) {
    return { error: `The line crosses the parcel boundary ${nIx} times. Draw a simpler line that crosses exactly twice.` };
  }

  const arcs = lineSplit(boundaryFeature, lineFeature);
  if (!arcs || arcs.features.length < 2) {
    return { error: 'Could not split the parcel boundary cleanly. Try a slightly different line.' };
  }

  const arcCoords = arcs.features.map((f) => f.geometry.coordinates);

  let half1, half2;
  if (arcCoords.length === 2) {
    [half1, half2] = arcCoords;
  } else {
    // Closed-ring case: the boundary's first vertex landed mid-half, so the
    // first and last arcs are actually one half. Concatenate them.
    const first = arcCoords[0];
    const last  = arcCoords[arcCoords.length - 1];
    const sameEndpoint = (a, b) =>
      Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
    if (sameEndpoint(first[0], last[last.length - 1])) {
      half1 = [...last, ...first.slice(1)];
      half2 = arcCoords.slice(1, -1).flat();
    } else {
      const sorted = [...arcCoords].sort((a, b) => b.length - a.length);
      [half1, half2] = sorted;
    }
  }

  if (!half1 || !half2 || half1.length < 2 || half2.length < 2) {
    return { error: 'Could not build two polygon halves from the split line.' };
  }

  const ring1 = [...half1, half1[0]];
  const ring2 = [...half2, half2[0]];

  try {
    return { pieces: [turfPolygon([ring1]), turfPolygon([ring2])] };
  } catch (e) {
    return { error: `Polygon split failed: ${e.message}` };
  }
}

// ── Step indicator ─────────────────────────────────────────────────────────
function StepDot({ n, label, active, done }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700,
        background: done ? TOKENS.success : active ? ink : alpha(ink, 0.12),
        color: done || active ? parchment : muted,
        flexShrink: 0,
      }}>
        {done ? '✓' : n}
      </div>
      <span style={{ fontSize: 'var(--type-mono-size)', color: active ? ink : muted, fontWeight: active ? 600 : 400 }}>
        {label}
      </span>
    </div>
  );
}

export default function SplitParcelModal({ parcel, blocks = [], onClose, onApplied }) {
  // step: 'draw' | 'assign' | 'submitting' | 'error'
  const [step, setStep] = useState('draw');
  const [splitLine, setSplitLine] = useState(null);         // GeoJSON LineString
  const [previewPieces, setPreviewPieces] = useState(null); // [featureA, featureB]
  const [splitError, setSplitError] = useState(null);       // Turf / server error message

  // block assignment: { [blockId]: 'a' | 'b' | null }
  const [assignment, setAssignment] = useState(() =>
    Object.fromEntries(blocks.map((b) => [b.id, null]))
  );
  const [labelA, setLabelA] = useState(parcel.parcel_label ? `${parcel.parcel_label} A` : '');
  const [labelB, setLabelB] = useState(parcel.parcel_label ? `${parcel.parcel_label} B` : '');

  // Stable array reference so PortalVineyardMap doesn't tear down and rebuild
  // its map on every re-render (which would drop the freshly-added preview).
  const mapParcels = useMemo(() => [parcel], [parcel]);

  // ── Step 1 handlers ──────────────────────────────────────────────────────
  function handleLineSave(_parcelId, lineGeometry) {
    setSplitError(null);
    const out = splitPolygonPreview(parcel.geometry, lineGeometry);
    if (out.error) {
      setSplitError(out.error);
      return;
    }
    const pieces = out.pieces;

    // Auto-assign blocks to the LARGER piece when one side is much smaller
    // (≤25% of total area). Common case: splitting off a sliver / buffer area.
    // When the split is roughly even, leave blocks unassigned for the user.
    try {
      const areaA = area(pieces[0]);
      const areaB = area(pieces[1]);
      const total = areaA + areaB;
      if (total > 0 && blocks.length > 0) {
        const fracA = areaA / total;
        let autoSide = null;
        if (fracA <= 0.25) autoSide = 'b';
        else if (fracA >= 0.75) autoSide = 'a';
        if (autoSide) {
          const next = {};
          blocks.forEach((b) => { next[b.id] = autoSide; });
          setAssignment(next);
        }
      }
    } catch { /* ignore area calc errors */ }

    setSplitLine(lineGeometry);
    setPreviewPieces(pieces);
    setStep('assign');
  }

  function redraw() {
    setSplitLine(null);
    setPreviewPieces(null);
    setSplitError(null);
    setStep('draw');
  }

  // ── Step 2 helpers ───────────────────────────────────────────────────────
  const aBlocks = useMemo(() => blocks.filter((b) => assignment[b.id] === 'a'), [blocks, assignment]);
  const bBlocks = useMemo(() => blocks.filter((b) => assignment[b.id] === 'b'), [blocks, assignment]);
  const unassigned = useMemo(() => blocks.filter((b) => assignment[b.id] == null), [blocks, assignment]);

  // Compute estimated acres for each piece from Turf area (m² → acres)
  const acresA = useMemo(
    () => previewPieces?.[0] ? area(previewPieces[0]) / 4046.86 : null,
    [previewPieces]
  );
  const acresB = useMemo(
    () => previewPieces?.[1] ? area(previewPieces[1]) / 4046.86 : null,
    [previewPieces]
  );

  // ── Flash + scroll the assign panel when entering step 2 ────────────────
  const assignPanelRef = useRef(null);
  const [flashAssign, setFlashAssign] = useState(false);
  useEffect(() => {
    if (step !== 'assign') return;
    if (assignPanelRef.current) {
      assignPanelRef.current.scrollTop = 0;
    }
    setFlashAssign(true);
    const t = setTimeout(() => setFlashAssign(false), 900);
    return () => clearTimeout(t);
  }, [step]);

  function assign(blockId, side) {
    setAssignment((prev) => ({ ...prev, [blockId]: side }));
  }
  function assignAll(side) {
    const next = {};
    blocks.forEach((b) => { next[b.id] = side; });
    setAssignment(next);
  }

  // ── Submit ───────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setSplitError(null);
    setStep('submitting');
    try {
      const res = await apiFetch(`/api/admin/vineyards/${parcel.id}/split-geometry`, {
        method: 'POST',
        body: JSON.stringify({
          blade:          splitLine,
          parcel_a_label: labelA.trim() || null,
          parcel_b_label: labelB.trim() || null,
          a_block_ids:    aBlocks.map((b) => b.id),
          b_block_ids:    bBlocks.map((b) => b.id),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Server error');
      onApplied?.(body);
    } catch (e) {
      setSplitError(e.message || 'Failed to split parcel');
      setStep('assign');
    }
  }

  // ── Piece A / B acreage from Turf preview ───────────────────────────────
  // (acresA / acresB are computed above with useMemo)

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: alpha(ink, 0.6),
        zIndex: 1000,
        display: 'flex', alignItems: 'stretch', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: parchment, borderRadius: 12,
          width: 'min(1100px, 100%)',
          display: 'flex', flexDirection: 'column',
          boxShadow: `0 20px 60px ${alpha(ink, 0.35)}`,
          fontFamily: 'var(--font-sans)',
          overflow: 'hidden',
          maxHeight: '95vh',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          padding: '18px 24px', borderBottom: `1px solid ${border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--type-subhead-size)', color: ink, margin: '0 0 4px' }}>
              Split Parcel
            </h2>
            <p style={{ color: muted, fontSize: 'var(--type-mono-size)', margin: 0 }}>
              {parcel.vineyard_name}{parcel.parcel_label ? ` · ${parcel.parcel_label}` : ''} · {parcel.acres ? `${Number(parcel.acres).toFixed(1)} ac` : 'unknown acres'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <StepDot n={1} label="Draw split line" active={step === 'draw'} done={step !== 'draw'} />
            <div style={{ width: 24, height: 1, background: border }} />
            <StepDot n={2} label="Assign blocks" active={step === 'assign' || step === 'submitting'} done={false} />
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* ── Left: map ── */}
          <div style={{
            width: '50%', flexShrink: 0, position: 'relative',
            borderRight: `1px solid ${border}`,
          }}>
            {parcel.geometry ? (
              <PortalVineyardMap
                parcels={mapParcels}
                highlightId={parcel.id}
                height="100%"
                style={{ height: '100%' }}
                splitParcelId={step === 'draw' ? parcel.id : null}
                onSplitLineSave={handleLineSave}
                onSplitCancel={onClose}
                splitPreview={previewPieces}
              />
            ) : (
              <div style={{
                height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: muted, fontSize: 'var(--type-mono-size)',
              }}>
                No geometry available
              </div>
            )}

            {/* Preview legend */}
            {previewPieces && (
              <div style={{
                position: 'absolute', top: 12, left: 12,
                background: alpha(parchment, 0.92),
                backdropFilter: 'blur(6px)',
                borderRadius: 8, padding: '8px 12px',
                border: `1px solid ${border}`,
                display: 'flex', gap: 14,
                fontSize: 'var(--type-ui-label-size)',
                fontWeight: 600,
                pointerEvents: 'none',
              }}>
                <span style={{ color: COLORS.aText }}>■ Parcel A {acresA != null ? `· ${acresA.toFixed(2)} ac` : ''}</span>
                <span style={{ color: COLORS.bText }}>■ Parcel B {acresB != null ? `· ${acresB.toFixed(2)} ac` : ''}</span>
              </div>
            )}

            {/* Error */}
            {splitError && (
              <div style={{
                position: 'absolute', bottom: 12, left: 12, right: 12,
                background: alpha(crimson, 0.1), border: `1px solid ${crimson}`,
                borderRadius: 8, padding: '10px 14px',
                color: crimson, fontSize: 'var(--type-mono-size)',
              }}>
                {splitError}
              </div>
            )}
          </div>

          {/* ── Right: assignment panel ── */}
          <div
            ref={assignPanelRef}
            style={{
              flex: 1, overflowY: 'auto', padding: '20px 24px',
              display: 'flex', flexDirection: 'column', gap: 20,
              transition: 'background-color 0.6s ease',
              background: flashAssign ? alpha(TOKENS.electricBlue, 0.10) : 'transparent',
            }}
          >
            {step === 'draw' ? (
              <div style={{ color: muted, fontSize: 'var(--type-mono-size)', paddingTop: 40, textAlign: 'center' }}>
                <p style={{ fontSize: 28, marginBottom: 12 }}>✂</p>
                <p>
                  <strong style={{ color: ink }}>Step 1 of 2:</strong> Draw a line across the parcel on the map.<br />
                  Click to place points · double-click or click the start to finish.
                </p>
                <p style={{ marginTop: 12, fontSize: 11, color: alpha(ink, 0.45) }}>
                  When the line is drawn, click <strong>“Use This Line →”</strong> on the bar at the bottom of the map.<br />
                  You'll then assign blocks and confirm — nothing is saved until the final step.
                </p>
              </div>
            ) : (
              <>
                {/* Step 2 banner */}
                <div style={{
                  background: alpha(TOKENS.electricBlue, 0.08),
                  border: `1px solid ${alpha(TOKENS.electricBlue, 0.25)}`,
                  borderRadius: 6, padding: '8px 12px',
                  fontSize: 'var(--type-mono-size)', color: ink,
                }}>
                  <strong>Step 2 of 2:</strong> Review labels &amp; block assignments, then click <strong>Confirm Split</strong> below to save.
                </div>
                {/* Parcel name inputs */}
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>
                      <span style={{ color: COLORS.aText }}>■</span> Parcel A label
                    </label>
                    <input
                      type="text"
                      value={labelA}
                      onChange={(e) => setLabelA(e.target.value)}
                      placeholder="e.g. West Block"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>
                      <span style={{ color: COLORS.bText }}>■</span> Parcel B label
                    </label>
                    <input
                      type="text"
                      value={labelB}
                      onChange={(e) => setLabelB(e.target.value)}
                      placeholder="e.g. East Block"
                      style={inputStyle}
                    />
                  </div>
                </div>

                {/* Block assignment */}
                {blocks.length > 0 ? (
                  <div>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: 10,
                    }}>
                      <p style={{ ...labelStyle, margin: 0 }}>Assign blocks</p>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => assignAll('a')} style={quickAssignBtn(COLORS.a, COLORS.aBg)}>All → A</button>
                        <button onClick={() => assignAll('b')} style={quickAssignBtn(COLORS.b, COLORS.bBg)}>All → B</button>
                      </div>
                    </div>

                    <div style={{
                      border: `1px solid ${border}`, borderRadius: 8, overflow: 'hidden',
                    }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--type-mono-size)' }}>
                        <thead>
                          <tr style={{ background: alpha(ink, 0.04) }}>
                            <th style={thStyle}>Block</th>
                            <th style={thStyle}>Variety</th>
                            <th style={thStyle}>Acres</th>
                            <th style={{ ...thStyle, textAlign: 'center' }}>Assign to</th>
                          </tr>
                        </thead>
                        <tbody>
                          {blocks.map((b, idx) => {
                            const side = assignment[b.id];
                            return (
                              <tr key={b.id} style={{
                                borderTop: idx === 0 ? 'none' : `1px solid ${alpha(border, 0.5)}`,
                                background: side === 'a' ? COLORS.aBg : side === 'b' ? COLORS.bBg : 'transparent',
                              }}>
                                <td style={tdStyle}>{b.block_name || <em style={{ color: muted }}>—</em>}</td>
                                <td style={{ ...tdStyle, color: muted }}>{b.variety || '—'}</td>
                                <td style={{ ...tdStyle, color: muted }}>{b.acres ? Number(b.acres).toFixed(2) : '—'}</td>
                                <td style={{ ...tdStyle, textAlign: 'center' }}>
                                  <div style={{ display: 'inline-flex', gap: 4 }}>
                                    <button
                                      onClick={() => assign(b.id, side === 'a' ? null : 'a')}
                                      style={assignToggle(side === 'a', COLORS.a, COLORS.aText, COLORS.aBg)}
                                    >A</button>
                                    <button
                                      onClick={() => assign(b.id, side === 'b' ? null : 'b')}
                                      style={assignToggle(side === 'b', COLORS.b, COLORS.bText, COLORS.bBg)}
                                    >B</button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {unassigned.length > 0 && (
                      <p style={{ margin: '8px 0 0', fontSize: 11, color: muted }}>
                        {unassigned.length} block{unassigned.length !== 1 ? 's' : ''} unassigned — they will be left without a parcel until manually re-linked.
                      </p>
                    )}
                  </div>
                ) : (
                  <p style={{ color: muted, fontSize: 'var(--type-mono-size)', fontStyle: 'italic' }}>
                    No blocks on this parcel — nothing to assign.
                  </p>
                )}

                <button onClick={redraw} style={redrawBtnStyle}>← Redraw split line</button>
              </>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{
          borderTop: `1px solid ${border}`, padding: '14px 24px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: 10,
        }}>
          <p style={{ margin: 0, color: muted, fontSize: 'var(--type-mono-size)' }}>
            {step === 'draw' && 'Draw a line on the map to continue.'}
            {(step === 'assign' || step === 'submitting') && (
              <>
                <span style={{ color: COLORS.aText }}>A: {aBlocks.length}</span>
                {' · '}
                <span style={{ color: COLORS.bText }}>B: {bBlocks.length}</span>
                {unassigned.length > 0 && <span style={{ color: muted }}>{` · ${unassigned.length} unassigned`}</span>}
              </>
            )}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            {(step === 'assign' || step === 'submitting') && (
              <button
                onClick={handleSubmit}
                disabled={step === 'submitting'}
                style={{
                  ...submitBtnStyle,
                  opacity: step === 'submitting' ? 0.6 : 1,
                  cursor: step === 'submitting' ? 'wait' : 'pointer',
                }}
              >
                {step === 'submitting' ? 'Splitting…' : 'Confirm Split'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Styles ── */
const labelStyle = {
  display: 'block',
  marginBottom: 4,
  fontSize: 'var(--type-ui-label-size)',
  fontWeight: 600,
  color: muted,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
};

const inputStyle = {
  width: '100%', padding: '7px 10px',
  border: `1px solid ${border}`, borderRadius: 6,
  background: parchment, color: ink,
  fontSize: 'var(--type-mono-size)',
  fontFamily: 'var(--font-sans)',
  boxSizing: 'border-box',
};

const thStyle = {
  padding: '8px 10px', textAlign: 'left',
  fontSize: 'var(--type-ui-label-size)', fontWeight: 600,
  color: muted, textTransform: 'uppercase', letterSpacing: '0.06em',
  borderBottom: `1px solid ${border}`, whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '8px 10px', color: ink, verticalAlign: 'middle',
};

const cancelBtnStyle = {
  padding: '7px 14px', borderRadius: 6,
  border: `1px solid ${border}`, background: 'transparent',
  color: muted, fontSize: 'var(--type-mono-size)',
  fontFamily: 'var(--font-sans)', cursor: 'pointer',
};

const submitBtnStyle = {
  padding: '7px 18px', borderRadius: 6, border: 'none',
  background: ink, color: parchment,
  fontSize: 'var(--type-mono-size)', fontWeight: 600,
  fontFamily: 'var(--font-sans)', cursor: 'pointer',
};

const redrawBtnStyle = {
  padding: '6px 12px', borderRadius: 6,
  border: `1px solid ${alpha(ink, 0.25)}`, background: 'transparent',
  color: muted, fontSize: 'var(--type-mono-size)',
  fontFamily: 'var(--font-sans)', cursor: 'pointer',
  alignSelf: 'flex-start',
};

const quickAssignBtn = (color, bg) => ({
  padding: '4px 10px', borderRadius: 4,
  border: `1px solid ${alpha(color, 0.4)}`,
  background: bg, color: color,
  fontSize: 11, fontWeight: 700,
  fontFamily: 'var(--font-sans)', cursor: 'pointer',
});

const assignToggle = (active, color, textColor, bg) => ({
  width: 28, height: 24,
  borderRadius: 4,
  border: `1px solid ${active ? color : alpha(ink, 0.2)}`,
  background: active ? bg : 'transparent',
  color: active ? textColor : muted,
  fontSize: 11, fontWeight: active ? 700 : 400,
  cursor: 'pointer', fontFamily: 'var(--font-sans)',
});
