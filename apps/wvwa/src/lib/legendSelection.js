// Legend filtering for the map's data layers (soils, bedrock, climate).
//
// A selection is an array of class keys (soil/bedrock `cls` strings, climate
// `bin` numbers); empty means "show everything". Tapping works "show only"
// first: the first tap isolates what was tapped, later taps add or remove, and
// removing the last selected key goes back to showing everything.

/** Toggle a group of keys (one legend row, or every row under a group header). */
export function toggleLegendKeys(selected = [], keys) {
  if (!selected.length) return [...keys];
  const allOn = keys.every((k) => selected.includes(k));
  return allOn
    ? selected.filter((k) => !keys.includes(k))
    : [...selected, ...keys.filter((k) => !selected.includes(k))];
}

/**
 * Short description of a selection for the on-map chip, using group labels
 * where a whole group is selected, e.g. "Region Ia, Region Ib" or "Volcanic +2".
 */
export function describeLegendSelection(groups, selected = []) {
  if (!selected.length) return '';
  const parts = [];
  for (const g of groups) {
    const on = g.rows.filter((r) => selected.includes(r.key));
    if (!on.length) continue;
    if (g.label && on.length === g.rows.length) parts.push(g.label);
    else parts.push(...on.map((r) => r.label));
  }
  return parts.length <= 2 ? parts.join(', ') : `${parts[0]} +${parts.length - 1}`;
}

// Unselected classes stay on the map as a faint grey wash
export const FADED_FILL_COLOR = '#9c978d';
export const FADED_FILL_OPACITY = 0.16;

/**
 * Paint values for a fill layer under a legend selection: selected classes keep
 * their colour and opacity, the rest fade. `keyExpr` reads the feature's class.
 */
export function legendPaint(selected, keyExpr, colorExpr, opacity) {
  if (!selected?.length) return { color: colorExpr, opacity };
  const isOn = ['in', keyExpr, ['literal', selected]];
  return {
    color: ['case', isOn, colorExpr, FADED_FILL_COLOR],
    opacity: ['case', isOn, opacity, FADED_FILL_OPACITY],
  };
}
