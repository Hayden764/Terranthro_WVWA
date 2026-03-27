import { BRAND } from '../../config/brandColors';
import { GLASS } from './glassTokens';
import { WV_SUB_AVAS } from '../../config/topographyConfig';

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

/* ─── Color ramp gradients matching TiTiler colormaps ────────────────── */
const COLORMAP_CSS = {
  terrain:  'linear-gradient(to right, #0B6623, #90EE90, #F5F5DC, #D2B48C, #8B4513, #FFFFFF)',
  rdylgn_r: 'linear-gradient(to right, #1A9850, #91CF60, #D9EF8B, #FEE08B, #FC8D59, #D73027)',
  hsv:      'linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)',
  plasma:   'linear-gradient(to right, #0D0887, #7E03A8, #CC4778, #F89441, #F0F921)',
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
function AVAButton({ item, onSelectAva, onHoverAva, badge }) {
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
      {badge && (
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          padding: '2px 6px',
          borderRadius: 10,
          background: 'rgba(201,168,76,0.18)',
          border: '1px solid rgba(201,168,76,0.4)',
          color: '#C9A84C',
          marginLeft: 6,
          flexShrink: 0,
        }}>
          {badge}
        </span>
      )}
      <span style={{ fontSize: 13, marginLeft: 8, opacity: 0.55, flexShrink: 0 }}>↗</span>
    </button>
  );
}

export default function InfoPanel({ selectedAva, onSelectAva, onHoverAva }) {
  const ava = WV_SUB_AVAS.find(a => a.slug === selectedAva);

  // Nesting helpers
  const parentAvaSlug = ava?.parentAva ?? null;
  const parentAva = parentAvaSlug ? WV_SUB_AVAS.find(a => a.slug === parentAvaSlug) : null;
  const subAvas = ava?.subAvas
    ? WV_SUB_AVAS.filter(a => ava.subAvas.includes(a.slug))
    : [];
  const isDoubleNested = !!parentAva;
  const isChehalemParent = (ava?.subAvas?.length ?? 0) > 0;

  // AVAs shown in the "siblings" list — exclude self, and for double-nested exclude
  // the parent (shown separately in breadcrumb)
  const siblingAvas = WV_SUB_AVAS.filter(a => a.slug !== selectedAva);

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>

      {/* ── AVA Information ──────────────────────────────────────────── */}
      {ava ? (
        <>
          <div style={CARD}>
            {/* Nesting badge */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
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
              }}>
                {isDoubleNested ? 'Double-Nested AVA' : 'Nested AVA'}
              </div>
              {isChehalemParent && (
                <div style={{
                  display: 'inline-block',
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  background: 'rgba(201,168,76,0.15)',
                  border: '1px solid rgba(201,168,76,0.4)',
                  color: '#C9A84C',
                }}>
                  Parent AVA
                </div>
              )}
            </div>

            {/* Breadcrumb for double-nested */}
            {isDoubleNested && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
                <button
                  onClick={() => onSelectAva?.(null)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: GLASS.textDim, fontFamily: 'Inter, sans-serif' }}
                >
                  Willamette Valley
                </button>
                <span style={{ color: GLASS.textMuted, fontSize: 11 }}>›</span>
                <button
                  onClick={() => onSelectAva?.(parentAvaSlug)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: '#C9A84C', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}
                >
                  {parentAva.name}
                </button>
                <span style={{ color: GLASS.textMuted, fontSize: 11 }}>›</span>
                <span style={{ fontSize: 11, color: GLASS.text, fontWeight: 600 }}>{ava.name}</span>
              </div>
            )}

            <div style={{ fontSize: 18, fontWeight: 700, color: GLASS.text, fontFamily: 'Georgia, serif', marginBottom: 4 }}>
              {ava.name}
            </div>
            <div style={{ fontSize: 12, color: GLASS.textDim }}>
              {isDoubleNested
                ? `${parentAva.name} · Willamette Valley, Oregon`
                : 'Willamette Valley, Oregon'}
            </div>
          </div>

          {/* ── Sub-AVAs (shown only for Chehalem Mountains) ─────────── */}
          {isChehalemParent && (
            <div style={CARD}>
              <div style={{ ...LBL, marginBottom: 2 }}>
                Contains Sub-AVAs
                <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 6 }}>({subAvas.length})</span>
              </div>
              <div style={{ fontSize: 11, color: GLASS.textDim, lineHeight: 1.5, marginBottom: 8 }}>
                These appellations are nested within Chehalem Mountains and also within the broader Willamette Valley AVA — making them double-nested.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {subAvas.map(sub => (
                  <AVAButton key={sub.slug} item={sub} onSelectAva={onSelectAva} onHoverAva={onHoverAva} badge="2× Nested" />
                ))}
              </div>
            </div>
          )}

          {/* Parent AVA breadcrumb card */}
          <div style={CARD}>
            <div style={LBL}>{isDoubleNested ? 'Parent AVAs' : 'Part of'}</div>

            {isDoubleNested ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Chehalem Mountains parent */}
                <button
                  onClick={() => onSelectAva?.(parentAvaSlug)}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(56,189,248,0.12)';
                    e.currentTarget.style.borderColor = 'rgba(56,189,248,0.55)';
                    e.currentTarget.style.color = '#7DD3FC';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(201,168,76,0.08)';
                    e.currentTarget.style.borderColor = 'rgba(201,168,76,0.3)';
                    e.currentTarget.style.color = '#C9A84C';
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '8px 12px', borderRadius: 8,
                    border: '1px solid rgba(201,168,76,0.3)',
                    background: 'rgba(201,168,76,0.08)',
                    color: '#C9A84C', fontSize: 12, fontWeight: 600,
                    fontFamily: 'Inter, sans-serif', cursor: 'pointer',
                    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                    textAlign: 'left',
                  }}
                >
                  <span>{parentAva.name}</span>
                  <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 8 }}>Direct parent ↗</span>
                </button>
                {/* Willamette Valley grandparent */}
                <button
                  onClick={() => onSelectAva?.(null)}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(56,189,248,0.12)';
                    e.currentTarget.style.borderColor = 'rgba(56,189,248,0.55)';
                    e.currentTarget.style.color = '#7DD3FC';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(250,247,242,0.05)';
                    e.currentTarget.style.borderColor = 'rgba(250,247,242,0.10)';
                    e.currentTarget.style.color = GLASS.textDim;
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '8px 12px', borderRadius: 8,
                    border: '1px solid rgba(250,247,242,0.10)',
                    background: 'rgba(250,247,242,0.05)',
                    color: GLASS.textDim, fontSize: 12, fontWeight: 500,
                    fontFamily: 'Inter, sans-serif', cursor: 'pointer',
                    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                    textAlign: 'left',
                  }}
                >
                  <span>Willamette Valley AVA</span>
                  <span style={{ fontSize: 13, marginLeft: 8, opacity: 0.55 }}>↗</span>
                </button>
              </div>
            ) : (
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
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '8px 12px', borderRadius: 8,
                  border: '1px solid rgba(250,247,242,0.10)',
                  background: 'rgba(250,247,242,0.05)',
                  color: GLASS.textDim, fontSize: 12, fontWeight: 500,
                  fontFamily: 'Inter, sans-serif', cursor: 'pointer',
                  transition: 'background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s',
                  textAlign: 'left',
                }}
              >
                <span>Willamette Valley AVA</span>
                <span style={{ fontSize: 13, marginLeft: 8, opacity: 0.55, flexShrink: 0 }}>↗</span>
              </button>
            )}
          </div>

          {/* Sibling AVAs */}
          <div style={CARD}>
            <div style={{ ...LBL, marginBottom: 6 }}>
              Other AVAs
              <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 6 }}>({siblingAvas.length})</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: `${GLASS.textMuted} transparent` }}>
              {siblingAvas.map(sibling => (
                <AVAButton
                  key={sibling.slug}
                  item={sibling}
                  onSelectAva={onSelectAva}
                  onHoverAva={onHoverAva}
                  badge={sibling.parentAva ? '2× Nested' : sibling.subAvas ? 'Has Sub-AVAs' : null}
                />
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
                <AVAButton
                  key={a.slug}
                  item={a}
                  onSelectAva={onSelectAva}
                  onHoverAva={onHoverAva}
                  badge={a.parentAva ? '2× Nested' : a.subAvas ? 'Has Sub-AVAs' : null}
                />
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

    </div>
  );
}
