// Statistics page: a grid of cards. Each card is independent so adding
// a new metric is just adding a new entry to the `cards` array. Future
// additions: pipeline schedule, latest execution time, etc.
//
// Like the lineage page, this is the only file that knows about the
// concrete chart renderer. See docs/SWITCHING_VIZ.md to swap libraries.

import { api } from '/api/client.js';
import { createChartJsRenderer as createChartRenderer } from '/renderers/chart/chartjs-renderer.js';

export const statisticsPage = {
  id: 'statistics',
  title: 'Statistics',

  async mount(root) {
    root.innerHTML = `
      <div class="toolbar">
        <span id="status" class="status">loading…</span>
      </div>
      <div class="stats-body">
        <section id="summary" class="summary-row"></section>
        <section id="cards" class="card-grid"></section>
      </div>
    `;

    const statusEl = root.querySelector('#status');
    const summaryEl = root.querySelector('#summary');
    const cardsEl = root.querySelector('#cards');

    const renderers = [];

    function chartCard(title) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<h3>${title}</h3><div class="chart-host"></div>`;
      cardsEl.appendChild(card);
      const r = createChartRenderer();
      r.init(card.querySelector('.chart-host'));
      renderers.push(r);
      return r;
    }

    function listCard(title) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<h3>${title}</h3><ol class="simple-list"></ol>`;
      cardsEl.appendChild(card);
      return card.querySelector('ol');
    }

    try {
      const [summary, byType, byPipeline, top] = await Promise.all([
        api.stats.summary(),
        api.stats.byObjectType(),
        api.stats.byPipeline(20),
        api.stats.topDownstream(10),
      ]);

      summaryEl.innerHTML = renderSummary(summary);

      chartCard('Objects by type').render('pie', byType);
      chartCard('Objects by catalog (top 20)').render('horizontalBar', byPipeline);
      chartCard('Top 10 by downstream count').render('horizontalBar', top.map((r) => ({
        label: r.object_full_name,
        count: r.downstream_count,
      })));

      // Example of a non-chart card. Replace or remove freely.
      const list = listCard('Top 10 (raw list)');
      list.innerHTML = top
        .map(
          (r) => `
            <li>
              <span class="name" title="${escapeAttr(r.object_full_name)}">${escapeHtml(r.object_full_name)}</span>
              <span class="count">${r.downstream_count}</span>
            </li>`
        )
        .join('');

      statusEl.textContent = 'loaded';
    } catch (e) {
      console.error(e);
      statusEl.textContent = `Error: ${e.message}`;
      statusEl.classList.add('error');
    }

    return () => {
      for (const r of renderers) {
        try { r.destroy(); } catch (_) {}
      }
    };
  },
};

function renderSummary(s) {
  const items = [
    ['Total objects', s.total_objects],
    ['Total edges', s.total_edges],
    ['Distinct types', s.distinct_types],
    ['Distinct catalogs', s.distinct_pipelines],
  ];
  return items
    .map(
      ([label, value]) => `
        <div class="summary-card">
          <div class="label">${escapeHtml(label)}</div>
          <div class="value">${Number(value || 0).toLocaleString()}</div>
        </div>`
    )
    .join('');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
