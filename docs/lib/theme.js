/** Dispatched on `window` after `data-theme` on `<html>` changes (light/dark). */
export const GLOBAL_LINEAGE_THEME_EVENT = 'global-lineage-theme';

export const THEME_STORAGE_KEY = 'global-lineage-theme';

/** @returns {'light'|'dark'} */
export function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
