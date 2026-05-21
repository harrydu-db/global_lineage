// App shell: hash router + page registry.
//
// To add a new page:
//   1. Create frontend/pages/<my-page>.js exporting `{ id, title, mount }`.
//   2. Import it below and add it to the `pages` array.
// See docs/ADDING_A_PAGE.md for the full contract.

import { api } from './api/client.js';
import { lineagePage } from './pages/lineage.js';
import { statisticsPage } from './pages/statistics.js';
import { GLOBAL_LINEAGE_THEME_EVENT, THEME_STORAGE_KEY, getTheme } from './lib/theme.js';

const pages = [lineagePage, statisticsPage];

const navEl = document.getElementById('app-nav');
const rootEl = document.getElementById('page-root');

let currentCleanup = null;

function renderNav(activeId) {
  navEl.innerHTML = '';
  for (const p of pages) {
    const a = document.createElement('a');
    a.href = `#/${p.id}`;
    a.textContent = p.title;
    if (p.id === activeId) a.classList.add('active');
    navEl.appendChild(a);
  }
}

function parseRoute() {
  const hash = window.location.hash || '';
  const m = hash.match(/^#\/([^/?]+)/);
  return m ? m[1] : pages[0].id;
}

async function route() {
  const id = parseRoute();
  const page = pages.find((p) => p.id === id) || pages[0];

  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch (e) { console.warn('page cleanup error', e); }
    currentCleanup = null;
  }
  rootEl.innerHTML = '';
  renderNav(page.id);

  try {
    const cleanup = await page.mount(rootEl);
    if (typeof cleanup === 'function') currentCleanup = cleanup;
  } catch (e) {
    console.error('page mount failed', e);
    rootEl.innerHTML = `<div class="empty-state">Failed to load page: ${escapeHtml(e.message)}</div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  setupThemeToggle();
  await setupLineageInputSelect();
  setupLineageDataControls();
  if (!window.location.hash) window.location.hash = `#/${pages[0].id}`;
  route();
});

// Populate the input-folder dropdown from input/index.json. If the folder
// contains at least one JSON, switch the active source to the first file
// BEFORE the initial route so that page mount loads from there. If the
// manifest is missing/empty, leave the bundled sample as the default.
async function setupLineageInputSelect() {
  const select = document.getElementById('lineage-source-select');
  if (!select) return;
  let manifest;
  try {
    manifest = await api.listInputLineageFiles();
  } catch (e) {
    console.warn('input manifest fetch failed', e);
    return;
  }
  const files = (manifest && manifest.files) || [];
  if (files.length === 0) {
    select.hidden = true;
    return;
  }
  select.innerHTML = files
    .map((f) => `<option value="${escapeAttr(f)}">${escapeHtml(f)}</option>`)
    .join('');
  select.value = files[0];
  select.hidden = false;

  try {
    await api.loadInputLineageFile(files[0]);
  } catch (e) {
    console.error('failed to load default input file', e);
  }

  select.addEventListener('change', async () => {
    const filename = select.value;
    if (!filename) return;
    try {
      await api.loadInputLineageFile(filename);
      await route();
    } catch (e) {
      console.error('failed to load input file', e);
    }
  });
}

function escapeAttr(s) { return escapeHtml(s); }

function setupThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const sunSvg =
    '<svg class="theme-toggle-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"/></svg>';
  const moonSvg =
    '<svg class="theme-toggle-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  function syncThemeToggleUi() {
    const icon = btn.querySelector('.theme-toggle-icon');
    const isLight = getTheme() === 'light';
    if (icon) icon.innerHTML = isLight ? moonSvg : sunSvg;
    btn.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
    btn.setAttribute('title', isLight ? 'Dark mode' : 'Light mode');
  }

  syncThemeToggleUi();

  btn.addEventListener('click', () => {
    const next = getTheme() === 'light' ? 'dark' : 'light';
    if (next === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (_) { /* ignore */ }
    syncThemeToggleUi();
    window.dispatchEvent(new CustomEvent(GLOBAL_LINEAGE_THEME_EVENT));
  });
}

function setupLineageDataControls() {
  const fileInput = document.getElementById('lineage-file-input');
  if (!fileInput) return;

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      await api.uploadLineageJson(file);
      await route();
    } catch (e) {
      console.error(e);
    }
  });
}
