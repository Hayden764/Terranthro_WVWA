/**
 * WinerySitePage — a winery's public vineyard page.
 *
 *   /w/:slug                 all of the winery's vineyards
 *   /w/:slug/:vineyardKey    one vineyard (the future bottle-QR landing page —
 *                            vineyardKey is permanent, see migration 021)
 *
 * `?embed=1` renders for an <iframe> on the winery's own site: transparent
 * background, tighter padding, and the page reports its height to the parent
 * (message { type: 'terranthro:height', height }) so the frame can auto-size.
 *
 * Data comes live from /api/public/sites/:slug, which reads the same rows the
 * portal edits — there is nothing to re-publish after a portal change.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiJson } from '../../lib/api';
import { accentHex, varietyColor, ASPECT_LABELS, UNKNOWN_VARIETY_COLOR } from '../../lib/siteTheme';
import SiteVineyardMap from '../../components/site/SiteVineyardMap';
import './winerySite.css';

const fmtAcres = (a) => (a == null ? null : `${a < 10 ? a.toFixed(1) : Math.round(a)} ac`);
const fmtFt = (f) => (f == null ? null : `${f.toLocaleString()} ft`);
const aspectLabel = (a) => (a ? ASPECT_LABELS[a] || a : null);

function elevationRange(s) {
  if (s.elevation_min_ft == null) return null;
  if (s.elevation_max_ft == null || s.elevation_max_ft === s.elevation_min_ft) return fmtFt(s.elevation_min_ft);
  return `${s.elevation_min_ft.toLocaleString()}–${s.elevation_max_ft.toLocaleString()} ft`;
}

export default function WinerySitePage() {
  const { slug, vineyardKey } = useParams();
  const [searchParams] = useSearchParams();
  const embed = searchParams.get('embed') === '1';
  const [site, setSite] = useState(null);
  const [error, setError] = useState(null);
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setSite(null); setError(null);
    apiJson(`/api/public/sites/${encodeURIComponent(slug)}`)
      .then((d) => { if (!cancelled) setSite(d); })
      .catch(() => { if (!cancelled) setError('not-found'); });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => { setSelectedBlockId(null); }, [vineyardKey]);

  const vineyard = useMemo(
    () => (site && vineyardKey ? site.vineyards.find((v) => v.key === vineyardKey) || null : null),
    [site, vineyardKey]
  );

  // Title + description for sharing/crawlers. (Full SEO needs prerendered HTML — later phase.)
  useEffect(() => {
    if (!site) return;
    const name = site.winery.name;
    document.title = vineyard ? `${vineyard.name} · ${name}` : `Vineyards · ${name}`;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta); }
    meta.content = vineyard
      ? `${vineyard.name}${vineyard.ava ? `, ${vineyard.ava} AVA` : ''} — vineyard blocks, varieties and terroir from ${name}.`
      : `The vineyards of ${name}: blocks, varieties, elevation and aspect.`;
  }, [site, vineyard]);

  // Auto-height for the embed iframe.
  useEffect(() => {
    if (!embed || window.parent === window || !rootRef.current) return undefined;
    const post = () => window.parent.postMessage(
      { type: 'terranthro:height', height: Math.ceil(rootRef.current.getBoundingClientRect().height) }, '*'
    );
    const ro = new ResizeObserver(post);
    ro.observe(rootRef.current);
    post();
    return () => ro.disconnect();
  }, [embed, site, vineyardKey]);

  const accent = accentHex(site?.winery.accent);
  const q = embed ? '?embed=1' : '';

  let body;
  if (error || (site && vineyardKey && !vineyard)) {
    body = <div className="ws-empty">This vineyard page isn’t available.</div>;
  } else if (!site) {
    body = <div className="ws-empty">Loading…</div>;
  } else if (vineyard) {
    body = (
      <VineyardView
        site={site} vineyard={vineyard} backTo={`/w/${slug}${q}`}
        selectedBlockId={selectedBlockId} onBlockSelect={setSelectedBlockId}
      />
    );
  } else {
    body = <OverviewView site={site} slug={slug} q={q} />;
  }

  return (
    <div ref={rootRef} className={`ws${embed ? ' ws--embed' : ''}`} style={{ '--ws-accent': accent }}>
      <div className="ws-inner">
        {site?.preview && (
          <div className="ws-preview">
            Preview — only you can see this page. Publish it from the portal to make it public.
          </div>
        )}
        {body}
        <footer className="ws-foot">
          <span>Mapped boundaries and terrain data by <a href="https://terranthro.com" target="_blank" rel="noopener">Terranthro</a></span>
          {site?.winery.url && !embed && (
            <a href={site.winery.url} target="_blank" rel="noopener">{site.winery.name} website</a>
          )}
        </footer>
      </div>
    </div>
  );
}

function OverviewView({ site, slug, q }) {
  const navigate = useNavigate();
  const { winery, vineyards } = site;
  const totalAcres = vineyards.reduce((s, v) => s + (v.acres || 0), 0);
  const avas = [...new Set(vineyards.map((v) => v.ava).filter(Boolean))];
  const varieties = mergeVarieties(vineyards);
  const [hoverKey, setHoverKey] = useState(null);

  return (
    <>
      <header className="ws-head">
        {winery.image_url && <img className="ws-logo" src={winery.image_url} alt="" />}
        <div>
          <p className="ws-eyebrow">Our vineyards</p>
          <h1 className="ws-title">{winery.name}</h1>
          <p className="ws-sub">
            {vineyards.length} {vineyards.length === 1 ? 'vineyard' : 'vineyards'}
            {totalAcres > 0 && ` · ${fmtAcres(totalAcres)}`}
            {avas.length > 0 && ` · ${avas.join(', ')}`}
          </p>
        </div>
      </header>

      {vineyards.length === 0 ? (
        <div className="ws-empty">No vineyards to show yet.</div>
      ) : (
        <>
          <SiteVineyardMap vineyards={vineyards} selectedKey={hoverKey} onSelect={(key) => navigate(`/w/${slug}/${key}${q}`)} />
          <VarietyLegend varieties={varieties} showUnknown={vineyards.some((v) => v.blocks.some((b) => b.geometry && !b.variety))} />

          <h2 className="ws-section-title">Vineyards</h2>
          <div className="ws-grid">
            {vineyards.map((v) => (
              <Link
                key={v.key} to={`/w/${slug}/${v.key}${q}`} className="ws-card"
                onMouseEnter={() => setHoverKey(v.key)} onMouseLeave={() => setHoverKey(null)}
              >
                <h3 className="ws-card-title">{v.name || 'Vineyard'}</h3>
                <div className="ws-card-meta">
                  {[v.ava && `${v.ava} AVA`, fmtAcres(v.acres)].filter(Boolean).join(' · ')}
                </div>
                <div className="ws-card-facts">
                  {v.summary.varieties.slice(0, 3).map((x) => (
                    <span key={x.name}><span className="ws-swatch" style={{ background: varietyColor(x.name) }} />{x.name}</span>
                  ))}
                </div>
                <div className="ws-card-facts" style={{ color: 'var(--ws-muted)' }}>
                  {elevationRange(v.summary) && <span>{elevationRange(v.summary)}</span>}
                  {v.summary.aspect && <span>{aspectLabel(v.summary.aspect)}-facing</span>}
                  <span>{v.summary.block_count} {v.summary.block_count === 1 ? 'block' : 'blocks'}</span>
                </div>
                <div className="ws-card-more">Explore the vineyard →</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function VineyardView({ site, vineyard: v, backTo, selectedBlockId, onBlockSelect }) {
  const s = v.summary;
  const blockRefs = useRef({});
  // Only blocks with grower-supplied detail get a card; unattributed mapped
  // polygons still appear on the map.
  const described = v.blocks.filter((b) =>
    b.variety || b.clone || b.rootstock || b.trellis || b.year_planted || b.notes);
  const select = (id) => {
    onBlockSelect(id === selectedBlockId ? null : id);
    blockRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const stats = [
    { label: 'Planted area', value: fmtAcres(v.acres) },
    { label: 'Elevation', value: elevationRange(s) },
    { label: 'Mean slope', value: s.slope_mean_deg != null ? `${s.slope_mean_deg}°` : null },
    { label: 'Aspect', value: aspectLabel(s.aspect), sub: s.aspect ? 'predominant' : null },
    { label: 'First planted', value: s.first_planted },
  ].filter((x) => x.value != null);

  return (
    <>
      {site.vineyards.length > 1 && <Link to={backTo} className="ws-back">← All {site.winery.name} vineyards</Link>}
      <p className="ws-eyebrow">{site.winery.name}</p>
      <h1 className="ws-title">{v.name || 'Vineyard'}</h1>
      {v.ava && (
        <p className="ws-sub">{v.ava} AVA{v.parent_ava ? ` · ${v.parent_ava}` : ''}</p>
      )}

      {stats.length > 0 && (
        <div className="ws-stats">
          {stats.map((x) => (
            <div key={x.label} className="ws-stat">
              <div className="ws-stat-label">{x.label}</div>
              <div className="ws-stat-value">{x.value}</div>
              {x.sub && <div className="ws-stat-sub">{x.sub}</div>}
            </div>
          ))}
        </div>
      )}

      <SiteVineyardMap
        vineyards={[v]} selectedKey={v.key} focusKey={v.key}
        selectedBlockId={selectedBlockId} onBlockSelect={select} height={460}
      />
      <VarietyLegend varieties={s.varieties} showUnknown={v.blocks.some((b) => b.geometry && !b.variety)} />

      {described.length > 0 && (
        <>
          <h2 className="ws-section-title">Blocks</h2>
          <div className="ws-blocks">
            {described.map((b) => (
              <button
                key={b.id} type="button" className="ws-block" aria-pressed={b.id === selectedBlockId}
                ref={(el) => { blockRefs.current[b.id] = el; }}
                onClick={b.geometry ? () => select(b.id) : undefined}
                style={{ '--ws-block-color': varietyColor(b.variety), cursor: b.geometry ? 'pointer' : 'default' }}
              >
                <div className="ws-block-name">{b.name}</div>
                <div className="ws-block-variety">{b.variety || 'Variety not listed'}</div>
                <dl className="ws-dl">
                  {[
                    ['Clone', b.clone], ['Rootstock', b.rootstock], ['Trellis', b.trellis],
                    ['Planted', b.year_planted], ['Area', fmtAcres(b.acres)],
                    ['Elevation', fmtFt(b.elevation_ft)],
                    ['Slope', b.slope_deg != null ? `${b.slope_deg}°` : null],
                    ['Aspect', aspectLabel(b.aspect)],
                  ].filter(([, val]) => val != null && val !== '').map(([k, val]) => (
                    <FragmentRow key={k} k={k} v={val} />
                  ))}
                </dl>
                {b.notes && <p className="ws-notes">{b.notes}</p>}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function FragmentRow({ k, v }) {
  return (<><dt>{k}</dt><dd>{v}</dd></>);
}

function VarietyLegend({ varieties, showUnknown = false }) {
  if (!varieties.length && !showUnknown) return null;
  return (
    <div className="ws-legend">
      {varieties.map((x) => (
        <span key={x.name}><span className="ws-swatch" style={{ background: varietyColor(x.name) }} />{x.name}</span>
      ))}
      {showUnknown && (
        <span><span className="ws-swatch" style={{ background: UNKNOWN_VARIETY_COLOR, opacity: 0.5 }} />Variety not recorded</span>
      )}
    </div>
  );
}

function mergeVarieties(vineyards) {
  const acres = {};
  for (const v of vineyards) for (const x of v.summary.varieties) acres[x.name] = (acres[x.name] || 0) + x.acres;
  return Object.entries(acres).sort((a, b) => b[1] - a[1]).map(([name, a]) => ({ name, acres: a }));
}
