import { climateLegendGroups, isClimateMapLayer } from '../config/climateMapConfig';
import { earthLegendGroups, isEarthLayer } from '../config/earthLayersConfig';
import { isTopoLayer, topoLegendGroups } from '../config/topoClasses';

/** Filterable legend groups for a data layer, or [] for layers without one. */
export function legendGroupsFor(layerId) {
  if (isClimateMapLayer(layerId)) return climateLegendGroups(layerId);
  if (isEarthLayer(layerId)) return earthLegendGroups(layerId);
  if (isTopoLayer(layerId)) return topoLegendGroups(layerId);
  return [];
}
