export function buildDatasetFilter(datasets) {
  if (!datasets.length) return null;
  return ['in', ['get', 'source_dataset'], ['literal', datasets]];
}

export function buildInteractiveReferenceVineyardFilter(devLayerToggles) {
  const enabledDatasets = [];
  if (devLayerToggles.vineyardsAdelsheimReference) enabledDatasets.push('adelsheim');
  return buildDatasetFilter(enabledDatasets);
}

export function buildPassiveReferenceVineyardFilter(devLayerToggles) {
  const enabledDatasets = [];
  if (devLayerToggles.vineyardsDundeeChehalem) enabledDatasets.push('chehalem-dundee');
  if (devLayerToggles.vineyardsYC) enabledDatasets.push('yamhill-carlton');
  return buildDatasetFilter(enabledDatasets);
}
