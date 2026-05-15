// App shell: hash router + page registry.
//
// To add a new page:
//   1. Create frontend/pages/<my-page>.js exporting `{ id, title, mount }`.
//   2. Import it below and add it to the `pages` array.
// See docs/ADDING_A_PAGE.md for the full contract.

import { api } from '/api/client.js';
import { lineagePage } from '/pages/lineage.js';
import { statisticsPage } from '/pages/statistics.js';

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
window.addEventListener('DOMContentLoaded', () => {
  setupLineageDataControls();
  if (!window.location.hash) window.location.hash = `#/${pages[0].id}`;
  route();
});

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
