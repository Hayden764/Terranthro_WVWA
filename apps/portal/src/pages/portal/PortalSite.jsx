/**
 * PortalSite — settings for the winery's public vineyard page (/w/:slug).
 *
 * Only presentation choices live here (publish, address, accent, which
 * vineyards to show). The page's content is the winery's portal data itself —
 * block edits made anywhere in the portal show up on the page automatically.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { border, crimson, ink, muted, parchment, TOKENS } from '@terranthro/shared/styles/tokens.js';
import { INPUT_STYLE, btn } from '@terranthro/shared/styles/patterns.js';
import { apiJson } from '@terranthro/shared/lib/api.js';
import { SITE_ACCENTS, DEFAULT_ACCENT } from '../../lib/siteTheme';
import PortalHeader from '../../components/portal/PortalHeader';

const ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';

function embedSnippet(slug) {
  const id = `terranthro-vineyards-${slug}`;
  return `<iframe id="${id}" src="${ORIGIN}/w/${slug}?embed=1" title="Our vineyards" loading="lazy"
  style="width:100%;height:900px;border:0;"></iframe>
<script>
  window.addEventListener('message', function (e) {
    if (e.origin !== '${ORIGIN}' || !e.data || e.data.type !== 'terranthro:height') return;
    document.getElementById('${id}').style.height = e.data.height + 'px';
  });
</script>`;
}

export default function PortalSite() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [site, setSite] = useState(null);
  const [slugDraft, setSlugDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([apiJson('/api/portal/profile'), apiJson('/api/portal/site')]);
      setProfile(p); setSite(s); setSlugDraft(s.slug || '');
    } catch {
      navigate('/portal', { replace: true });
    }
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  async function save(patch) {
    setSaving(true); setError(null);
    try {
      await apiJson('/api/portal/site', { method: 'PATCH', body: JSON.stringify(patch) });
      const s = await apiJson('/api/portal/site');
      setSite(s); setSlugDraft(s.slug || '');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!site) return <Shell><p style={{ color: muted }}>Loading…</p></Shell>;

  const pageUrl = site.slug ? `${ORIGIN}/w/${site.slug}` : null;
  const accent = site.accent || DEFAULT_ACCENT;
  const shown = site.vineyards.filter((v) => !v.site_hidden).length;

  return (
    <Shell>
      <PortalHeader title={profile?.title} />
      <Link to="/portal/dashboard" className="tx-link" style={{ color: muted, fontSize: 'var(--type-mono-size)' }}>← Dashboard</Link>

      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--type-display-medium-size)', color: ink, margin: '16px 0 6px' }}>
        Your vineyard page
      </h1>
      <p style={{ color: muted, fontSize: 'var(--type-body-size)', marginBottom: 24, lineHeight: 1.5 }}>
        A public page showing your vineyards, blocks and terrain that you can add to your own website.
        It uses the same data you manage in this portal — when you update a block here, your page updates too.
      </p>

      {error && <p style={{ color: crimson, marginBottom: 16 }}>{error}</p>}

      <Section title="Status">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 500, color: ink }}>
              {site.published ? 'Published' : 'Not published'}
            </div>
            <div style={{ color: muted, fontSize: 'var(--type-body-size)', marginTop: 2 }}>
              {site.published
                ? 'Anyone with the link, or visitors to your website, can see it.'
                : 'Only you can see the preview while signed in.'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {pageUrl && <a href={pageUrl} target="_blank" rel="noopener" style={btn('ghost', { textDecoration: 'none' })}>{site.published ? 'View page' : 'Preview'}</a>}
            <button disabled={saving || !site.slug} onClick={() => save({ published: !site.published })} style={btn(site.published ? 'danger' : 'primary')}>
              {site.published ? 'Unpublish' : 'Publish'}
            </button>
          </div>
        </div>
      </Section>

      <Section title="Page address">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: muted, fontSize: 'var(--type-mono-size)' }}>{ORIGIN}/w/</span>
          <input
            value={slugDraft}
            onChange={(e) => setSlugDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            className="tx-input" style={{ ...INPUT_STYLE, flex: '1 1 200px', minWidth: 160 }}
            maxLength={80}
          />
          <button disabled={saving || !slugDraft || slugDraft === site.slug} onClick={() => save({ slug: slugDraft })} style={btn('primary')}>
            Save
          </button>
        </div>
        {site.published && (
          <p style={{ color: muted, fontSize: 12, marginTop: 8 }}>
            Changing the address breaks links you’ve already shared and any embed code on your site.
          </p>
        )}
      </Section>

      <Section title="Accent colour">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {Object.entries(SITE_ACCENTS).map(([key, { label, hex }]) => (
            <button
              key={key} disabled={saving} onClick={() => save({ accent: key })} title={label}
              aria-pressed={accent === key}
              className={`tx-box${accent === key ? ' is-active' : ''}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                background: parchment, fontFamily: 'var(--font-sans)', fontSize: 13, color: ink,
                border: `${accent === key ? 2 : 1}px solid ${border}`,
              }}
            >
              <span style={{ width: 14, height: 14, borderRadius: 3, background: hex }} />{label}
            </button>
          ))}
        </div>
      </Section>

      <Section title={`Vineyards shown (${shown} of ${site.vineyards.length})`}>
        {site.vineyards.length === 0 && <p style={{ color: muted }}>No vineyards linked to your account yet.</p>}
        {site.vineyards.map((v) => (
          <label key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${TOKENS.ghost}`, cursor: 'pointer' }}>
            <input
              type="checkbox" checked={!v.site_hidden} disabled={saving}
              onChange={(e) => save({ hidden: { [v.id]: !e.target.checked } })}
            />
            <span style={{ flex: 1, color: ink }}>{v.vineyard_name || `Vineyard #${v.id}`}</span>
            {v.acres != null && <span style={{ color: muted, fontSize: 12 }}>{Number(v.acres).toFixed(1)} ac</span>}
            {pageUrl && (
              <a href={`${pageUrl}/${v.site_key}`} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}
                className="tx-link" style={{ fontSize: 12, color: TOKENS.interactive }}>
                link
              </a>
            )}
          </label>
        ))}
      </Section>

      {site.slug && (
        <Section title="Add it to your website">
          <p style={{ color: muted, fontSize: 'var(--type-body-size)', marginBottom: 10, lineHeight: 1.5 }}>
            Paste this into an HTML / embed block on your site (Squarespace “Code”, Wix “Embed HTML”,
            WordPress “Custom HTML”). Or just link to the page address above.
          </p>
          <textarea readOnly value={embedSnippet(site.slug)} rows={8}
            className="tx-input" style={{ ...INPUT_STYLE, width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12, resize: 'vertical' }}
            onFocus={(e) => e.target.select()} />
          <button
            style={{ ...btn('ghost'), marginTop: 8 }}
            onClick={async () => {
              await navigator.clipboard.writeText(embedSnippet(site.slug));
              setCopied(true); setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? 'Copied' : 'Copy embed code'}
          </button>
        </Section>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: parchment, fontFamily: 'var(--font-sans)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>{children}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background: parchment, borderRadius: 10, padding: '20px', border: `1px solid ${border}`, marginBottom: 20 }}>
      <h2 style={{ fontSize: 'var(--type-display-italic-size)', fontWeight: 600, color: ink, margin: '0 0 14px' }}>{title}</h2>
      {children}
    </div>
  );
}
