import { alpha, border, crimson, ink, muted, TOKENS } from '../styles/tokens';
import { describeLegendSelection } from '../lib/legendSelection';

/**
 * On-map reminder that a legend filter is on (mobile, where the legend sits in
 * the closed bottom sheet). Tapping it clears the filter.
 */
export default function LegendSelectionChip({ groups, selected, onClear }) {
  const text = describeLegendSelection(groups, selected);
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={`Showing only ${text}. Tap to show all.`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%', minHeight: 36,
        padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'var(--font-sans)',
        background: alpha(TOKENS.parchment, 0.96), border: `1px solid ${border}`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)', touchAction: 'manipulation',
      }}
    >
      <span style={{ fontSize: 12, color: muted, flexShrink: 0 }}>Showing</span>
      <span style={{ fontSize: 13, fontWeight: 650, color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
      <span aria-hidden="true" style={{ fontSize: 15, color: crimson, flexShrink: 0 }}>✕</span>
    </button>
  );
}
