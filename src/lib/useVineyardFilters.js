/**
 * Vineyard filter state for the Wineries dock & map dimming.
 *
 * Drives:
 *   - GET /api/wineries/query (rollup of matching wineries + parcel ids)
 *   - GET /api/vineyards/parcels?ids=... (matching parcel polygons)
 *   - WineriesPanel listing rows
 *   - WVWAMap: dim non-matching parcels, draw matched overlay
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const API_HEADERS = import.meta.env.VITE_INTERNAL_API_KEY
  ? { 'x-api-key': import.meta.env.VITE_INTERNAL_API_KEY }
  : {};

export const ASPECT_BUCKETS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export const EMPTY_FILTERS = Object.freeze({
  elevation_min: null,   // ft
  elevation_max: null,
  slope_min:     null,   // deg
  slope_max:     null,
  aspects:       [],     // subset of ASPECT_BUCKETS
  variety:       null,
  ava:           null,
  acres_min:     null,
  acres_max:     null,
});

/**
 * True iff at least one filter is set to a non-default value.
 */
export function hasActiveFilters(f) {
  if (!f) return false;
  return (
    f.elevation_min != null || f.elevation_max != null ||
    f.slope_min     != null || f.slope_max     != null ||
    (Array.isArray(f.aspects) && f.aspects.length > 0) ||
    !!f.variety || !!f.ava ||
    f.acres_min != null || f.acres_max != null
  );
}

/**
 * Count of active filter "facets" (used for the SearchBar badge).
 * Each range counts as one regardless of whether one or both bounds are set.
 */
export function activeFilterCount(f) {
  if (!f) return 0;
  let n = 0;
  if (f.elevation_min != null || f.elevation_max != null) n++;
  if (f.slope_min     != null || f.slope_max     != null) n++;
  if (Array.isArray(f.aspects) && f.aspects.length > 0)   n++;
  if (f.variety) n++;
  if (f.ava)     n++;
  if (f.acres_min != null || f.acres_max != null) n++;
  return n;
}

/**
 * Build a query string from a filter object, omitting nulls/empties.
 */
export function filtersToQueryString(f) {
  const params = new URLSearchParams();
  if (!f) return '';
  if (f.elevation_min != null) params.set('elevation_min', String(f.elevation_min));
  if (f.elevation_max != null) params.set('elevation_max', String(f.elevation_max));
  if (f.slope_min     != null) params.set('slope_min',     String(f.slope_min));
  if (f.slope_max     != null) params.set('slope_max',     String(f.slope_max));
  if (Array.isArray(f.aspects) && f.aspects.length > 0) {
    params.set('aspect', f.aspects.join(','));
  }
  if (f.variety) params.set('variety', f.variety);
  if (f.ava)     params.set('ava',     f.ava);
  if (f.acres_min != null) params.set('acres_min', String(f.acres_min));
  if (f.acres_max != null) params.set('acres_max', String(f.acres_max));
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * useVineyardFilters
 *
 * Manages the active filter state plus the live result of running the
 * filter against the server.
 *
 * Returns:
 *   filters                — current filter object
 *   setFilters             — replace the entire filter object
 *   resetFilters           — clear back to EMPTY_FILTERS
 *   isActive               — boolean
 *   activeCount            — number of active facets
 *   loading                — query in flight
 *   queryResult            — { wineries, matching_parcel_ids,
 *                              matching_parcel_total_count, winery_total_count }
 *                            or null when no filters are active
 *   error                  — string | null
 */
export function useVineyardFilters() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(false);
  const [queryResult, setQueryResult] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const isActive    = hasActiveFilters(filters);
  const activeCount = activeFilterCount(filters);

  const resetFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  useEffect(() => {
    // No active filters → clear results
    if (!isActive) {
      if (abortRef.current) abortRef.current.abort();
      setQueryResult(null);
      setLoading(false);
      setError(null);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    const qs = filtersToQueryString(filters);
    fetch(`${API_BASE}/api/wineries/query${qs}`, {
      headers: API_HEADERS,
      signal: controller.signal,
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        setQueryResult(data);
        setLoading(false);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        console.error('Filter query failed:', err);
        setError(err.message || 'Filter query failed');
        setQueryResult(null);
        setLoading(false);
      });

    return () => controller.abort();
  }, [filters, isActive]);

  return useMemo(() => ({
    filters,
    setFilters,
    resetFilters,
    isActive,
    activeCount,
    loading,
    queryResult,
    error,
  }), [filters, resetFilters, isActive, activeCount, loading, queryResult, error]);
}
