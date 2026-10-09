import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api.js';
import { border, ink, muted, TYPE } from '../styles/tokens.js';

/**
 * Terrain of an AVA (GET /api/avas/:slug/terrain): a one-line summary, then a
 * 100 % stacked bar per layer — elevation, slope, aspect — with the largest
 * bands listed. The API returns fine bins (100 ft / 1° / compass sectors);
 * they are rolled up into the app's own topography legend bands (`classes`,
 * the TOPO_CLASSES of that app's topoClasses.js), so colours and labels match
 * the Elevation / Slope / Aspect map layers.
 *
 * Renders nothing while loading or when the AVA has no data.
 */
export default function AvaTerrain({ slug, classes, labelStyle }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!slug) return undefined;
    let cancelled = false;
    setData(null);
    apiJson(`/api/avas/${encodeURIComponent(slug)}/terrain`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [slug]);

  if (!data || !classes) return null;
  const label = labelStyle ?? { ...TYPE.uiLabel, color: muted };
  const s = data.summary;
  const facing = s?.aspect_dominant_deg != null ? SECTOR_NAMES[Math.round(s.aspect_dominant_deg / 45) % 8] : null;
  const summary = s && [
    `${fmtFt(s.elevation_min_ft)}–${fmtFt(s.elevation_max_ft)} ft`,
    `average ${fmtFt(s.elevation_mean_ft)} ft`,
    `mean slope ${Math.round(s.slope_mean_deg)}°`,
    facing && `mostly ${facing}-facing`,
  ].filter(Boolean).join(' · ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {summary && (
        <div>
          <div style={{ ...label, marginBottom: 6 }}>Terrain</div>
          <div style={{ fontSize: 'var(--type-body-size)', color: ink, lineHeight: 1.5 }}>{summary}</div>
        </div>
      )}
      <Layer title="Elevation" bands={rollUp(data.elevation, classes.elevation)} labelStyle={label} />
      <Layer title="Slope" bands={rollUp(data.slope, classes.slope)} labelStyle={label} />
      <Layer title="Aspect" bands={rollUp(data.aspect, classes.aspect, true)} labelStyle={label} order="legend" />
      {s?.data_source && (
        <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted }}>{s.data_source}, Oregon land only.</div>
      )}
    </div>
  );
}

const SECTOR_NAMES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const SHOWN_BANDS = 4;
const fmtFt = (v) => Math.round(v).toLocaleString();
const fmtPct = (p) => (p >= 1 ? `${Math.round(p)}%` : '<1%');

/** Sum fine bins into legend bands by bin midpoint; aspect's flat row (lo = -1) lands in the flat band. */
function rollUp(bins, cls, circular = false) {
  if (!bins?.length || !cls) return [];
  const bands = cls.groups.flatMap((g) => g.bands).map((b) => ({ ...b, pct: 0 }));
  for (const bin of bins) {
    const mid = (bin.lo + bin.hi) / 2;
    let band;
    if (circular && mid < 0) {
      band = bands.find((b) => b.hi <= 0);                       // flat land
    } else if (circular) {
      const deg = ((mid % 360) + 360) % 360;
      band = bands.find((b) => (b.lo < 0
        ? deg >= b.lo + 360 || deg < b.hi                         // the sector wrapping north
        : deg >= b.lo && deg < b.hi));
    } else {
      band = bands.find((b) => mid >= b.lo && mid < b.hi);
    }
    if (band) band.pct += bin.pct;
  }
  return bands.filter((b) => b.pct > 0);
}

function Layer({ title, bands, labelStyle, order }) {
  if (!bands.length) return null;
  const listed = order === 'legend' ? bands : [...bands].sort((a, b) => b.pct - a.pct);
  return (
    <div>
      <div style={{ ...labelStyle, marginBottom: 6 }}>{title}</div>
      <div
        role="img"
        aria-label={`${title}: ${bands.map((b) => `${b.label} ${fmtPct(b.pct)}`).join(', ')}`}
        style={{ display: 'flex', height: 10, borderRadius: 3, overflow: 'hidden', border: `1px solid ${border}` }}
      >
        {bands.map((b) => (
          <div key={b.key ?? b.label} title={`${b.label} · ${fmtPct(b.pct)}`} style={{ width: `${b.pct}%`, background: b.color }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 7 }}>
        {listed.slice(0, order === 'legend' ? listed.length : SHOWN_BANDS).filter((b) => order !== 'legend' || b.pct >= 1).map((b) => (
          <div key={b.key ?? b.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 'var(--type-body-size)', color: ink }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, flexShrink: 0, background: b.color }} />
            <span style={{ flex: 1, minWidth: 0 }}>{b.label}</span>
            <span style={{ color: muted, fontVariantNumeric: 'tabular-nums' }}>{fmtPct(b.pct)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
