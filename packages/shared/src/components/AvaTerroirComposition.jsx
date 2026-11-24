import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api.js';
import { border, ink, muted, TYPE } from '../styles/tokens.js';

/**
 * Soil and bedrock make-up of an AVA (GET /api/avas/:slug/terroir): a 100 %
 * stacked bar per layer, the largest classes, and the main named units
 * (soil series / rock formations). Class colours come from the app's map
 * legend (`colors`) so "Volcanic" here matches "Volcanic" on the map.
 *
 * Renders nothing while loading or when the AVA has no data.
 */
// renderAction(key) — optional node beside a section title ('soils' | 'bedrock'),
// e.g. a button that shows that layer on the map.
export default function AvaTerroirComposition({ slug, colors, fallbackColor, labelStyle, renderAction }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!slug) return undefined;
    let cancelled = false;
    setData(null);
    apiJson(`/api/avas/${encodeURIComponent(slug)}/terroir`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [slug]);

  if (!data) return null;
  const colorOf = (cls) => colors?.[cls] ?? fallbackColor;
  const label = labelStyle ?? { ...TYPE.uiLabel, color: muted };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Layer title="Soils" classes={data.soil} units={data.soil_series} unitLabel="Main soil series"
        colorOf={colorOf} labelStyle={label} action={renderAction?.('soils')} />
      <Layer title="Bedrock" classes={data.bedrock} units={data.formation} unitLabel="Main formations"
        colorOf={colorOf} labelStyle={label} action={renderAction?.('bedrock')} />
    </div>
  );
}

const SHOWN_CLASSES = 4;   // listed under the bar; the bar itself shows every class
const SHOWN_UNITS = 4;
const fmtPct = (p) => (p >= 1 ? `${Math.round(p)}%` : '<1%');

function Layer({ title, classes, units, unitLabel, colorOf, labelStyle, action = null }) {
  if (!classes?.length) return null;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div style={labelStyle}>{title}</div>
        {action}
      </div>
      <div
        role="img"
        aria-label={`${title}: ${classes.map((c) => `${c.class} ${fmtPct(c.pct)}`).join(', ')}`}
        style={{ display: 'flex', height: 10, borderRadius: 3, overflow: 'hidden', border: `1px solid ${border}` }}
      >
        {classes.map((c) => (
          <div key={c.class} title={`${c.class} · ${fmtPct(c.pct)}`}
            style={{ width: `${c.pct}%`, background: colorOf(c.class) }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 7 }}>
        {classes.slice(0, SHOWN_CLASSES).map((c) => (
          <div key={c.class} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 'var(--type-body-size)', color: ink }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, flexShrink: 0, background: colorOf(c.class) }} />
            <span style={{ flex: 1, minWidth: 0 }}>{c.class}</span>
            <span style={{ color: muted, fontVariantNumeric: 'tabular-nums' }}>{fmtPct(c.pct)}</span>
          </div>
        ))}
      </div>
      {units?.length > 0 && (
        <div style={{ fontSize: 'var(--type-ui-label-size)', color: muted, marginTop: 7, lineHeight: 1.5 }}>
          {unitLabel}: {units.slice(0, SHOWN_UNITS).map((u) => `${u.class} ${fmtPct(u.pct)}`).join(' · ')}
        </div>
      )}
    </div>
  );
}
