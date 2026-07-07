/**
 * SplitParcelModal — Step-by-step UI for splitting a vineyard BLOCK polygon.
 *
 * Post-018 model: all polygons live in vineyard_blocks; the vineyard footprint
 * is derived, so splitting happens at the block level and the footprint is
 * unchanged (both pieces stay in the same vineyard).
 *
 * Step 1 — Pick: choose which block to split (auto-selected when the vineyard
 *   has exactly one geometry block).
 *
 * Step 2 — Draw: user draws a line across the block on the map. A client-side
 *   Turf.js split gives an instant coloured preview (blue / amber pieces).
 *
 * Step 3 — Confirm: POST to /api/admin/blocks/:blockId/split-geometry.
 *   Piece A keeps the original block id (and its viticulture data + buyer
 *   links); piece B becomes a new block.
 */

import { useState, useMemo } from 'react';
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
    return { error: 'Only single-Polygon blocks can be split here.' };
  }
  const outerRing = polygonGeom.coordinates[0];
  if (!outerRing || outerRing.length < 4) {
    return { error: 'Block polygon is malformed.' };
  }

  const lineFeature = turfFeature(lineGeom);
  const boundaryFeature = lineString(outerRing);

  const intersections = lineIntersect(boundaryFeature, lineFeature);
  const nIx = intersections?.features?.length ?? 0;
  if (nIx < 2) {
    return { error: 'The line did not cross the block boundary at two points. Draw a line that enters and exits the block.' };
  }
  if (nIx > 2) {
    return { error: `The line crosses the block boundary ${nIx} times. Draw a simpler line that crosses exactly twice.` };
  }

  const arcs = lineSplit(boundaryFeature, lineFeature);
  if (!arcs || arcs.features.length < 2) {
    return { error: 'Could not split the block boundary cleanly. Try a slightly different line.' };
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

export default function SplitParcelModal({ vineyard, geometryBlocks = [], onClose, onApplied }) {
  // The block being split. Auto-select when there is exactly one.
  const [targetBlockId, setTargetBlockId] = useState(
    geometryBlocks.length === 1 ? geometryBlocks[0].id : null
  );
  const targetBlock = useMemo(
    () => geometryBlocks.find((b) => b.id === targetBlockId) || null,
    [geometryBlocks, targetBlockId]
  );

  // step: 'draw' | 'confirm' | 'submitting'
  const [step, setStep] = useState('draw');
  const [splitLine, setSplitLine] = useState(null);         // GeoJSON LineString
  const [previewPieces, setPreviewPieces] = useState(null); // [featureA, featureB]
  const [splitError, setSplitError] = useState(null);       // Turf / server error message

  const [labelA, setLabelA] = useState(targetBlock?.block_name ? `${targetBlock.block_name} A` : '');
  const [labelB, setLabelB] = useState(targetBlock?.block_name ? `${targetBlock.block_name} B` : '');

  // Stable array reference so PortalVineyardMap doesn't tear down and rebuild
  // its map on every re-render (which would drop the freshly-added preview).
  const mapParcels = useMemo(
    () => geometryBlocks.map((b) => ({ ...b, parcel_label: b.block_name })),
    [geometryBlocks]
  );

  function selectBlock(id) {
    setTargetBlockId(id);
    const b = geometryBlocks.find((x) => x.id === id);
    setLabelA(b?.block_name ? `${b.block_name} A` : '');
    setLabelB(b?.block_name ? `${b.block_name} B` : '');
    setSplitLine(null);
    setPreviewPieces(null);
    setSplitError(null);
    setStep('draw');
  }

  // ── Draw handlers ─────────────────────────────────────────────────────────
  function handleLineSave(_blockId, lineGeometry) {
    if (!targetBlock) return;
    setSplitError(null);
    const out = splitPolygonPreview(targetBlock.geometry, lineGeometry);
    if (out.error) {
      setSplitError(out.error);
      return;
    }
    setSplitLine(lineGeometry);
    setPreviewPieces(out.pieces);
    setStep('confirm');
  }

  function redraw() {
    setSplitLine(null);
    setPreviewPieces(null);
    setSplitError(null);
    setStep('draw');
  }

  // Compute estimated acres for each piece from Turf area (m² → acres)
  const acresA = useMemo(
    () => previewPieces?.[0] ? area(previewPieces[0]) / 4046.86 : null,
    [previewPieces]
  );
  const acresB = useMemo(
    () => previewPieces?.[1] ? area(previewPieces[1]) / 4046.86 : null,
    [previewPieces]
  );

  // ── Submit ───────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!targetBlock) return;
    setSplitError(null);
    setStep('submitting');
    try {
      const res = await apiFetch(`/api/admin/blocks/${targetBlock.id}/split-geometry`, {
        method: 'POST',
        body: JSON.stringify({
          blade:         splitLine,
          block_a_label: labelA.trim() || null,
          block_b_label: labelB.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Server error');
      onApplied?.(body);
    } catch (e) {
      setSplitError(e.message || 'Failed to split block');
      setStep('confirm');
    }
  }

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
              Split Block
            </h2>
            <p style={{ color: muted, fontSize: 'var(--type-mono-size)', margin: 0 }}>
              {vineyard.vineyard_name || 'Unnamed vineyard'}
              {targetBlock?.block_name ? ` · ${targetBlock.block_name}` : ''}
              {targetBlock?.acres ? ` · ${Number(targetBlock.acres).toFixed(1)} ac` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <StepDot n={1} label="Pick block" active={!targetBlock} done={!!targetBlock} />
            <div style={{ width: 24, height: 1, background: border }} />
            <StepDot n={2} label="Draw split line" active={!!targetBlock && step === 'draw'} done={step !== 'draw'} />
            <div style={{ width: 24, height: 1, background: border }} />
            <StepDot n={3} label="Confirm" active={step === 'confirm' || step === 'submitting'} done={false} />
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* ── Left: map ── */}
          <div style={{
            width: '50%', flexShrink: 0, position: 'relative',
            borderRight: `1px solid ${border}`,
          }}>
            {mapParcels.length > 0 ? (
              <PortalVineyardMap
                parcels={mapParcels}
                highlightId={targetBlockId}
                height="100%"
                style={{ height: '100%' }}
                splitParcelId={targetBlock && step === 'draw' ? targetBlock.id : null}
                onSplitLineSave={handleLineSave}
                onSplitCancel={onClose}
                splitPreview={previewPieces}
                onParcelClick={(p) => { if (!splitLine) selectBlock(p.id); }}
              />
            ) : (
              <div style={{
                height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: muted, fontSize: 'var(--type-mono-size)',
              }}>
                No block geometry available
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
                <span style={{ color: COLORS.aText }}>■ Block A {acresA != null ? `· ${acresA.toFixed(2)} ac` : ''}</span>
                <span style={{ color: COLORS.bText }}>■ Block B {acresB != null ? `· ${acresB.toFixed(2)} ac` : ''}</span>
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

          {/* ── Right: control panel ── */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '20px 24px',
            display: 'flex', flexDirection: 'column', gap: 20,
          }}>
            {/* Block picker (when the vineyard has multiple geometry blocks) */}
            {geometryBlocks.length > 1 && (
              <div>
                <p style={labelStyle}>Block to split</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 130, overflowY: 'auto' }}>
                  {geometryBlocks.map((b, idx) => {
                    const isActive = b.id === targetBlockId;
                    return (
                      <button
                        key={b.id}
                        onClick={() => selectBlock(b.id)}
                        style={{
                          padding: '6px 12px', borderRadius: 6,
                          border: `1px solid ${isActive ? TOKENS.crimson : border}`,
                          background: isActive ? TOKENS.crimson : 'transparent',
                          color: isActive ? parchment : ink,
                          fontSize: 'var(--type-mono-size)',
                          fontFamily: 'var(--font-sans)',
                          fontWeight: isActive ? 600 : 400,
                          cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        {b.block_name || `#${idx + 1}`}
                        {b.acres ? <span style={{ marginLeft: 6, fontSize: 11, color: isActive ? alpha(parchment, 0.75) : muted }}>{Number(b.acres).toFixed(1)}ac</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {!targetBlock ? (
              <div style={{ color: muted, fontSize: 'var(--type-mono-size)', paddingTop: 40, textAlign: 'center' }}>
                <p style={{ fontSize: 28, marginBottom: 12 }}>⬚</p>
                <p><strong style={{ color: ink }}>Step 1 of 3:</strong> Pick the block to split — click it on the map or in the list above.</p>
              </div>
            ) : step === 'draw' ? (
              <div style={{ color: muted, fontSize: 'var(--type-mono-size)', paddingTop: 40, textAlign: 'center' }}>
                <p style={{ fontSize: 28, marginBottom: 12 }}>✂</p>
                <p>
                  <strong style={{ color: ink }}>Step 2 of 3:</strong> Draw a line across the block on the map.<br />
                  Click to place points · double-click or click the start to finish.
                </p>
                <p style={{ marginTop: 12, fontSize: 11, color: alpha(ink, 0.45) }}>
                  When the line is drawn, click <strong>“Use This Line →”</strong> on the bar at the bottom of the map.<br />
                  Nothing is saved until the final step.
                </p>
              </div>
            ) : (
              <>
                <div style={{
                  background: alpha(TOKENS.electricBlue, 0.08),
                  border: `1px solid ${alpha(TOKENS.electricBlue, 0.25)}`,
                  borderRadius: 6, padding: '8px 12px',
                  fontSize: 'var(--type-mono-size)', color: ink,
                }}>
                  <strong>Step 3 of 3:</strong> Review the labels, then click <strong>Confirm Split</strong> below.
                  Block A keeps the original block’s data and buyer links; Block B becomes a new block.
                  Both stay in this vineyard, so the footprint is unchanged.
                </div>
                {/* Block name inputs */}
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>
                      <span style={{ color: COLORS.aText }}>■</span> Block A name
                    </label>
                    <input
                      type="text"
                      value={labelA}
                      onChange={(e) => setLabelA(e.target.value)}
                      placeholder="e.g. West 7"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>
                      <span style={{ color: COLORS.bText }}>■</span> Block B name
                    </label>
                    <input
                      type="text"
                      value={labelB}
                      onChange={(e) => setLabelB(e.target.value)}
                      placeholder="e.g. East 7"
                      style={inputStyle}
                    />
                  </div>
                </div>

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
            {!targetBlock && 'Pick a block to continue.'}
            {targetBlock && step === 'draw' && 'Draw a line on the map to continue.'}
            {(step === 'confirm' || step === 'submitting') && (
              <>
                <span style={{ color: COLORS.aText }}>A{acresA != null ? ` · ${acresA.toFixed(2)} ac` : ''}</span>
                {' / '}
                <span style={{ color: COLORS.bText }}>B{acresB != null ? ` · ${acresB.toFixed(2)} ac` : ''}</span>
              </>
            )}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            {(step === 'confirm' || step === 'submitting') && (
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
