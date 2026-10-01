import { useState } from 'react';
import { alpha, border, interactive, ink, muted, parchment, TOKENS, TYPE } from '../styles/tokens';
import { TERMS_BY_ID } from '../config/wineTerms';

/**
 * Glossary pieces shared by the "Wine Terms" sidebar section and the
 * "What's this?" links on vineyard cards. Terms expand in place so reading
 * one never navigates away from the card you were looking at.
 */

function palette(variant) {
  const glass = variant === 'glass';
  return {
    text:   glass ? alpha(TOKENS.parchment, 0.92) : ink,
    sub:    glass ? alpha(TOKENS.parchment, 0.6) : muted,
    line:   glass ? alpha(TOKENS.parchment, 0.14) : border,
    bg:     glass ? alpha(TOKENS.parchment, 0.05) : parchment,
  };
}

/** One term: name + one-line summary; click to reveal the full explanation. */
export function TermItem({ term, open, onToggle, variant = 'light' }) {
  const c = palette(variant);
  return (
    <div className={`tx-box${open ? ' is-active' : ''}`} style={{ border: `1px solid ${c.line}`, borderRadius: 8, background: c.bg, overflow: 'hidden', cursor: 'default' }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="tx-row"
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%', textAlign: 'left',
          padding: '8px 10px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="tx-title" style={{ fontSize: 'var(--type-mono-size)', fontWeight: 600, color: c.text }}>{term.term}</div>
          <div style={{ fontSize: 'var(--type-ui-label-size)', color: c.sub, marginTop: 2, lineHeight: 1.45 }}>{term.short}</div>
        </div>
        <span style={{ fontSize: 'var(--type-ui-label-size)', color: c.sub, flexShrink: 0, lineHeight: 1.6 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <p style={{ margin: 0, padding: '0 10px 10px', fontSize: 'var(--type-body-size)', color: c.text, lineHeight: 1.6 }}>
          {term.body}
        </p>
      )}
    </div>
  );
}

/**
 * A section label with a "What's this?" link on the right. The link reveals
 * the listed glossary terms under the label; with one term it opens straight
 * to that term's explanation.
 */
export default function TermHelp({ label, ids, variant = 'light', style }) {
  const c = palette(variant);
  const terms = ids.map(id => TERMS_BY_ID[id]).filter(Boolean);
  const [shown, setShown] = useState(false);
  const [openId, setOpenId] = useState(terms.length === 1 ? terms[0].id : null);
  if (!terms.length) return label ? <div style={{ ...TYPE.uiLabel, color: c.sub, ...style }}>{label}</div> : null;
  return (
    <div style={style}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        {label ? <div style={{ ...TYPE.uiLabel, color: c.sub }}>{label}</div> : <span />}
        <button
          type="button"
          aria-expanded={shown}
          onClick={() => setShown(s => !s)}
          className={`tx-link${shown ? ' is-active' : ''}`}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0,
            fontFamily: 'var(--font-sans)', fontSize: 'var(--type-ui-label-size)',
            color: shown ? c.text : c.sub, textDecoration: 'underline', textUnderlineOffset: 2,
          }}
        >
          {shown ? 'Hide' : 'What’s this?'}
        </button>
      </div>
      {shown && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {terms.map(t => (
            <TermItem
              key={t.id}
              term={t}
              variant={variant}
              open={openId === t.id}
              onToggle={() => setOpenId(openId === t.id ? null : t.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
