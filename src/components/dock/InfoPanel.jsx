import { BRAND } from '../../config/brandColors';
import { GLASS } from './glassTokens';
import { WV_SUB_AVAS, TOPO_LAYER_TYPES } from '../../config/topographyConfig';

/**
 * InfoPanel — "Info" panel content (right side).
 * Shows selected AVA metadata, or general WV info if nothing selected.
 * When a data layer is active, shows layer description too.
 */

const CARD = {
  background: 'rgba(250,247,242,0.06)',
  border: '1px solid rgba(250,247,242,0.08)',
  borderRadius: 10,
  padding: '12px 14px',
  marginBottom: 8,
};

const LBL = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: GLASS.textDim,
  marginBottom: 4,
};

const VAL = {
  fontSize: 13,
  color: GLASS.text,
  lineHeight: 1.55,
};

/* ─── Layer info map ──────────────────────────────────────────────────── */
const LAYER_INFO = {
  tdmean: {
    icon: '🌡️',
    label: 'Mean Temperature',
    why: 'Average daily mean temperature from PRISM 30-year normals (1991–2020). This helps understand the thermal character of each growing region across different months.',
    source: 'PRISM Climate Group, Oregon State University',
    period: '30-year normals (1991–2020)',
  },
  elevation: {
    icon: '⛰️',
    label: 'Elevation',
    why: 'Height above sea level. Higher-elevation vineyards experience cooler temperatures, more wind exposure, and often better drainage — all factors that influence grape quality.',
    source: 'USGS Digital Elevation Model',
    period: 'Static terrain data',
  },
  slope: {
    icon: '📐',
    label: 'Slope',
    why: 'Steepness of terrain in degrees. Slopes between 5–15° are generally ideal for viticulture, providing good drainage and sun exposure.',
    source: 'Derived from USGS DEM',
    period: 'Static terrain data',
  },
  aspect: {
    icon: '🧭',
    label: 'Aspect',
    why: 'The compass direction a slope faces. South- and southwest-facing slopes receive more sunlight in the Northern Hemisphere, producing warmer and more sun-exposed microclimates.',
    source: 'Derived from USGS DEM',
    period: 'Static terrain data',
  },
};

/* ── Clickable AVA list item ─────────────────────────────────────────── */
function AVAButton({ item, onSelectAva, onHoverAva }) {
  return (
    <button
      onClick={() => onSelectAva?.(item.slug)}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'rgba(56,189,248,0.12)';
        e.currentTarget.style.borderColor = 'rgba(56,189,248,0.55)';
        e.currentTarget.style.color = '#7DD3FC';
        e.currentTarget.style.boxShadow = '0 0 0 2px rgba(56,189,248,0.18), inset 0 0 8px rgba(56,189,248,0.06)';
        onHoverAva?.(item.slug);
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'rgba(250,247,242,0.05)';
        e.currentTarget.style.borderColor = 'rgba(250,247,242,0.10)';
        e.currentTarget.style.color = GLASS.textDim;
        e.currentTarget.style.boxShadow = 'none';
        onHoverAva?.(null);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid rgba(250,247,242,0.10)',
        background: 'rgba(250,247,242,0.05)',
        color: GLASS.textDim,
        fontSize: 12,
        fontWeight: 500,
        fontFamily: 'Inter, sans-serif',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s',
        textAlign: 'left',
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.name}
      </span>
      <span style={{ fontSize: 13, marginLeft: 8, opacity: 0.55, flexShrink: 0 }}>↗</span>
    </button>
  );
}

export default function InfoPanel({ selectedAva, activeLayer, onSelectAva, onHoverAva }) {
  const ava = WV_SUB_AVAS.find(a => a.slug === selectedAva);
  const layerInfo = activeLayer ? LAYER_INFO[activeLayer] : null;

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>

      {/* ── AVA Information ──────────────────────────────────────────── */}
      {ava ? (
        <>
          <div style={CARD}>
            <div style={{
              display: 'inline-block',
              padding: '3px 10px',
              borderRadius: 20,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              background: GLASS.accentDim,
              border: '1px solid rgba(142,21,55,0.35)',
              color: GLASS.text,
              marginBottom: 10,
            }}>
              Nested AVA
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: GLASS.text, fontFamily: 'Georgia, serif', marginBottom: 4 }}>
              {ava.name}
            </div>
            <div style={{ fontSize: 12, color: GLASS.textDim }}>
              Willamette Valley, Oregon
            </div>
          </div>

          {/* Parent AVA */}
          <div style={CARD}>
            <div style={LBL}>Part of</div>
            <button
              onClick={() => onSelectAva?.(null)}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(56,189,248,0.12)';
                e.currentTarget.style.borderColor = 'rgba(56,189,248,0.55)';
                e.currentTarget.style.color = '#7DD3FC';
                e.currentTarget.style.boxShadow = '0 0 0 2px rgba(56,189,248,0.18), inset 0 0 8px rgba(56,189,248,0.06)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(250,247,242,0.05)';
                e.currentTarget.style.borderColor = 'rgba(250,247,242,0.10)';
                e.currentTarget.style.color = GLASS.textDim;
                e.currentTarget.style.boxShadow = 'none';
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid rgba(250,247,242,0.10)',
                background: 'rgba(250,247,242,0.05)',
                color: GLASS.textDim,
                fontSize: 12,
                fontWeight: 500,
                fontFamily: 'Inter, sans-serif',
                cursor: 'pointer',
                transition: 'background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s',
                textAlign: 'left',
              }}
            >
              <span>Willamette Valley AVA</span>
              <span style={{ fontSize: 13, marginLeft: 8, opacity: 0.55, flexShrink: 0 }}>↗</span>
            </button>
          </div>

          {/* Nested AVAs (siblings) */}
          <div style={CARD}>
            <div style={{ ...LBL, marginBottom: 6 }}>
              Nested AVAs
              <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 6 }}>({WV_SUB_AVAS.length - 1})</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: `${GLASS.textMuted} transparent` }}>
              {WV_SUB_AVAS.filter(a => a.slug !== selectedAva).map(sibling => (
                <AVAButton key={sibling.slug} item={sibling} onSelectAva={onSelectAva} onHoverAva={onHoverAva} />
              ))}
            </div>
          </div>
        </>
      ) : (
        /* ── No AVA selected — general info ──────────────────────── */
        <>
          <div style={CARD}>
            <div style={{ fontSize: 18, fontWeight: 700, color: GLASS.text, fontFamily: 'Georgia, serif', marginBottom: 6 }}>
              Willamette Valley
            </div>
            <div style={{ fontSize: 12, color: GLASS.textDim, lineHeight: 1.6 }}>
              Oregon's premier wine region, home to {WV_SUB_AVAS.length} distinct nested AVAs.
              Known world-wide for Pinot Noir, the valley's diverse terroir creates unique growing conditions across its appellations.
            </div>
          </div>

          <div style={CARD}>
            <div style={{ ...LBL, marginBottom: 6 }}>
              Nested AVAs
              <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 6 }}>({WV_SUB_AVAS.length})</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: `${GLASS.textMuted} transparent` }}>
              {WV_SUB_AVAS.map(a => (
                <AVAButton key={a.slug} item={a} onSelectAva={onSelectAva} onHoverAva={onHoverAva} />
              ))}
            </div>
          </div>

          <div style={CARD}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={LBL}>Region</div>
                <div style={VAL}>Oregon, USA</div>
              </div>
              <div>
                <div style={LBL}>Known For</div>
                <div style={VAL}>Pinot Noir</div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Divider ──────────────────────────────────────────────────── */}
      {layerInfo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <div style={{ flex: 1, height: 1, background: GLASS.borderLight }} />
          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: GLASS.textMuted }}>
            Active Layer
          </span>
          <div style={{ flex: 1, height: 1, background: GLASS.borderLight }} />
        </div>
      )}

      {/* ── Layer info ───────────────────────────────────────────────── */}
      {layerInfo && (
        <>
          <div style={CARD}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>{layerInfo.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: GLASS.text, marginBottom: 4 }}>{layerInfo.label}</div>
            <p style={{ fontSize: 12, color: GLASS.textDim, lineHeight: 1.65, margin: 0 }}>
              {layerInfo.why}
            </p>
          </div>

          <div style={CARD}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={LBL}>Period</div>
                <div style={VAL}>{layerInfo.period}</div>
              </div>
              <div>
                <div style={LBL}>Source</div>
                <div style={{ ...VAL, fontSize: 11, color: GLASS.textDim }}>{layerInfo.source}</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
