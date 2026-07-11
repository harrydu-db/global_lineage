/** Persist statistics table filter UI across page navigation. */

export const STATS_FILTER_STORAGE_KEY = 'global-lineage-stats-filters';

/** @returns {Record<string, unknown> | null} */
export function loadStatsFilterState() {
  try {
    const raw = localStorage.getItem(STATS_FILTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {Record<string, unknown>} state */
export function saveStatsFilterState(state) {
  try {
    localStorage.setItem(STATS_FILTER_STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore quota / private mode */ }
}

export function clearStatsFilterState() {
  try {
    localStorage.removeItem(STATS_FILTER_STORAGE_KEY);
  } catch { /* ignore */ }
}
