// Statistics page: a grid of cards. Each card is independent so adding
// a new metric is just adding a new entry to the `cards` array. Future
// additions: pipeline schedule, latest execution time, etc.
//
// Like the lineage page, this is the only file that knows about the
// concrete chart renderer. See docs/SWITCHING_VIZ.md to swap libraries.

import { api } from '../api/client.js';
import { GLOBAL_LINEAGE_THEME_EVENT } from '../lib/theme.js';
import { createChartJsRenderer as createChartRenderer } from '../renderers/chart/chartjs-renderer.js';

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
        <section id="object-table-section" class="stats-table-section" aria-labelledby="object-table-heading">
          <div class="stats-table-head">
            <h2 id="object-table-heading">Objects</h2>
            <div class="stats-table-filters" role="group" aria-label="Catalog and schema">
              <label class="stats-filter-field">
                <span>Catalog</span>
                <select id="filter-catalog" class="stats-filter-select">
                  <option value="">All catalogs</option>
                </select>
              </label>
              <label class="stats-filter-field">
                <span>Schema</span>
                <select id="filter-schema" class="stats-filter-select" disabled>
                  <option value="">All schemas</option>
                </select>
              </label>
            </div>
            <span id="table-filter-label" class="stats-table-filter" hidden></span>
            <button type="button" id="clear-table-filter" class="stats-table-clear" hidden>Clear filter</button>
          </div>
          <p class="stats-table-hint">Use the menus to filter by catalog and schema. Charts also narrow the table (type, catalog, or a single object). Click column headers to sort.</p>
          <div class="stats-table-wrap">
            <table class="stats-table" id="object-table">
              <thead>
                <tr>
                  <th scope="col" tabindex="0" role="columnheader" class="stats-sortable" data-sort-key="object_full_name" title="Sort by object">Object</th>
                  <th scope="col" tabindex="0" role="columnheader" class="stats-sortable" data-sort-key="object_type" title="Sort by type">Type</th>
                  <th scope="col" tabindex="0" role="columnheader" class="stats-sortable" data-sort-key="certified" title="Sort by certification">Certified</th>
                  <th scope="col" tabindex="0" role="columnheader" class="stats-sortable" data-sort-key="catalog" title="Sort by catalog">Catalog</th>
                  <th scope="col" tabindex="0" role="columnheader" class="stats-sortable" data-sort-key="schema" title="Sort by schema">Schema</th>
                  <th scope="col" tabindex="0" role="columnheader" class="stats-sortable num" data-sort-key="upstream_count" title="Sort by upstream count">Upstream</th>
                  <th scope="col" tabindex="0" role="columnheader" class="stats-sortable num" data-sort-key="downstream_count" title="Sort by downstream count">Downstream</th>
                  <th scope="col" tabindex="0" role="columnheader" class="stats-sortable num" data-sort-key="longest_upstream_depth" title="Sort by longest upstream path depth">Longest upstream depth</th>
                  <th scope="col" tabindex="0" role="columnheader" class="stats-sortable num" data-sort-key="longest_downstream_depth" title="Sort by longest downstream path depth">Longest downstream depth</th>
                </tr>
              </thead>
              <tbody id="object-table-body"></tbody>
            </table>
          </div>
          <p id="object-table-count" class="stats-table-count"></p>
        </section>
        <div id="stats-list-modal" class="stats-modal" hidden role="dialog" aria-modal="true" aria-labelledby="stats-list-modal-title">
          <div class="stats-modal-backdrop" data-close-modal tabindex="-1"></div>
          <div class="stats-modal-panel">
            <div class="stats-modal-header">
              <h3 id="stats-list-modal-title"></h3>
              <button type="button" class="stats-modal-close" id="stats-list-modal-close" data-close-modal aria-label="Close">×</button>
            </div>
            <ul class="stats-modal-list" id="stats-list-modal-list"></ul>
          </div>
        </div>
      </div>
    `;

    const statusEl = root.querySelector('#status');
    const summaryEl = root.querySelector('#summary');
    const cardsEl = root.querySelector('#cards');
    const tableBodyEl = root.querySelector('#object-table-body');
    const tableCountEl = root.querySelector('#object-table-count');
    const filterLabelEl = root.querySelector('#table-filter-label');
    const clearFilterBtn = root.querySelector('#clear-table-filter');
    const catalogSelect = root.querySelector('#filter-catalog');
    const schemaSelect = root.querySelector('#filter-schema');
    const listModal = root.querySelector('#stats-list-modal');
    const listModalTitle = root.querySelector('#stats-list-modal-title');
    const listModalList = root.querySelector('#stats-list-modal-list');
    const listModalClose = root.querySelector('#stats-list-modal-close');
    const tableEl = root.querySelector('#object-table');
    const theadEl = tableEl && tableEl.querySelector('thead');

    const renderers = [];

    /** @type {{ object_type?: string, catalog?: string, schema?: string, object_full_name?: string } | null} */
    let tableFilter = null;
    /** @type {{ object_full_name: string, object_type: string|null, catalog: string, schema: string, downstream_count: number, downstream_objects: string[], upstream_count: number, upstream_objects: string[] }[]} */
    let allTableRows = [];
    /** @type {Map<string, string[]>} */
    let upstreamListByName = new Map();
    /** @type {Map<string, string[]>} */
    let downstreamListByName = new Map();
    /** @type {Map<string, string[]>} */
    let longestUpstreamPathByName = new Map();
    /** @type {Map<string, string[]>} */
    let longestDownstreamPathByName = new Map();

    /** @type {'object_full_name'|'object_type'|'catalog'|'schema'|'upstream_count'|'downstream_count'|'longest_upstream_depth'|'longest_downstream_depth'} */
    let sortKey = 'object_full_name';
    /** @type {'asc'|'desc'} */
    let sortDir = 'asc';

    function extractSortValue(row, key) {
      if (key === 'upstream_count' || key === 'downstream_count' || key === 'longest_upstream_depth' || key === 'longest_downstream_depth') {
        return Number(row[key]) || 0;
      }
      if (key === 'certified') return row.certified ? 1 : 0;
      if (key === 'object_type') return String(row.object_type ?? 'Unknown');
      return String(row[key] ?? '');
    }

    function sortRows(rows) {
      const mult = sortDir === 'asc' ? 1 : -1;
      return [...rows].sort((a, b) => {
        const va = extractSortValue(a, sortKey);
        const vb = extractSortValue(b, sortKey);
        let primary = 0;
        if (typeof va === 'number' && typeof vb === 'number') {
          primary = va - vb;
        } else {
          primary = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
        }
        if (primary !== 0) return mult * primary;
        return a.object_full_name.localeCompare(b.object_full_name);
      });
    }

    function syncSortHeaders() {
      if (!theadEl) return;
      theadEl.querySelectorAll('th[data-sort-key]').forEach((cell) => {
        const k = cell.getAttribute('data-sort-key');
        cell.classList.remove('stats-sorted-asc', 'stats-sorted-desc');
        if (k === sortKey) {
          cell.classList.add(sortDir === 'asc' ? 'stats-sorted-asc' : 'stats-sorted-desc');
          cell.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
        } else {
          cell.removeAttribute('aria-sort');
        }
      });
    }

    function onTableHeadClick(e) {
      const th = e.target.closest('th[data-sort-key]');
      if (!th) return;
      const key = th.getAttribute('data-sort-key');
      if (!key) return;
      const allowed = new Set(['object_full_name', 'object_type', 'certified', 'catalog', 'schema', 'upstream_count', 'downstream_count', 'longest_upstream_depth', 'longest_downstream_depth']);
      if (!allowed.has(key)) return;
      if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else {
        sortKey = /** @type {typeof sortKey} */ (key);
        sortDir = 'asc';
      }
      applyTableFilter();
    }

    function onTableHeadKeydown(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const th = e.target.closest('th[data-sort-key]');
      if (!th || e.target !== th) return;
      e.preventDefault();
      onTableHeadClick(e);
    }

    function uniqueSorted(values) {
      return [...new Set(values)].filter((v) => v != null && v !== '' && v !== '—').sort();
    }

    function refillCatalogOptions() {
      const keep = catalogSelect.value || tableFilter?.catalog || '';
      const catalogs = uniqueSorted(allTableRows.map((r) => r.catalog));
      catalogSelect.innerHTML = '<option value="">All catalogs</option>'
        + catalogs.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
      if (keep && catalogs.includes(keep)) catalogSelect.value = keep;
      else if (tableFilter?.catalog && catalogs.includes(tableFilter.catalog)) {
        catalogSelect.value = tableFilter.catalog;
      }
    }

    function refillSchemaOptions() {
      const cat = catalogSelect.value || '';
      const schemas = uniqueSorted(
        allTableRows.filter((r) => !cat || r.catalog === cat).map((r) => r.schema)
      );
      schemaSelect.innerHTML = '<option value="">All schemas</option>'
        + schemas.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
      schemaSelect.disabled = !cat;
      if (!cat) {
        schemaSelect.value = '';
        return;
      }
      const prefer = tableFilter?.schema;
      if (prefer && schemas.includes(prefer)) schemaSelect.value = prefer;
      else schemaSelect.value = '';
    }

    function filterSummary() {
      if (!tableFilter || (!tableFilter.object_type && !tableFilter.catalog && !tableFilter.schema && !tableFilter.object_full_name && tableFilter.certified === undefined)) {
        return '';
      }
      const parts = [];
      if (tableFilter.object_full_name) {
        parts.push(`object = ${tableFilter.object_full_name}`);
      } else {
        if (tableFilter.object_type) parts.push(`type = ${tableFilter.object_type}`);
        if (tableFilter.certified !== undefined) parts.push(`certified = ${tableFilter.certified ? 'yes' : 'no'}`);
        if (tableFilter.catalog) parts.push(`catalog = ${tableFilter.catalog}`);
        if (tableFilter.schema) parts.push(`schema = ${tableFilter.schema}`);
      }
      return parts.join(' · ');
    }

    /** @param {'type'|'catalog'|'object'|'certified'} source */
    function setFilterFromChart(source, label) {
      if (source === 'object') {
        tableFilter = { object_full_name: label };
        catalogSelect.value = '';
        schemaSelect.value = '';
        refillSchemaOptions();
        applyTableFilter();
        return;
      }
      const prev = tableFilter && !tableFilter.object_full_name ? { ...tableFilter } : {};
      delete prev.object_full_name;
      if (source === 'certified') {
        prev.certified = label === 'Certified';
        catalogSelect.value = prev.catalog || '';
      }
      if (source === 'type') {
        prev.object_type = label;
        catalogSelect.value = prev.catalog || '';
      }
      if (source === 'catalog') {
        prev.catalog = label;
        catalogSelect.value = label;
        delete prev.schema;
        schemaSelect.value = '';
      }
      tableFilter = Object.keys(prev).length ? prev : null;
      refillSchemaOptions();
      applyTableFilter();
    }

    function applyTableFilter() {
      const spec = tableFilter && (tableFilter.object_full_name || tableFilter.object_type || tableFilter.catalog || tableFilter.schema || tableFilter.certified !== undefined)
        ? tableFilter
        : {};
      const rows = allTableRows.filter((r) => {
        if (spec.object_full_name) return r.object_full_name === spec.object_full_name;
        if (spec.object_type && (r.object_type ?? 'Unknown') !== spec.object_type) return false;
        if (spec.certified !== undefined && Boolean(r.certified) !== spec.certified) return false;
        if (spec.catalog && r.catalog !== spec.catalog) return false;
        if (spec.schema && r.schema !== spec.schema) return false;
        return true;
      });
      const sorted = sortRows(rows);
      renderTableBody(sorted);
      syncSortHeaders();
      const summary = filterSummary();
      if (summary) {
        filterLabelEl.hidden = false;
        filterLabelEl.textContent = `Filtered: ${summary}`;
        clearFilterBtn.hidden = false;
      } else {
        filterLabelEl.hidden = true;
        clearFilterBtn.hidden = true;
      }
      tableCountEl.textContent = `${sorted.length.toLocaleString()} row${sorted.length === 1 ? '' : 's'}`;
    }

    function renderTableBody(rows) {
      upstreamListByName = new Map(rows.map((r) => [r.object_full_name, r.upstream_objects || []]));
      downstreamListByName = new Map(rows.map((r) => [r.object_full_name, r.downstream_objects || []]));
      longestUpstreamPathByName = new Map(rows.map((r) => [r.object_full_name, r.longest_upstream_path || []]));
      longestDownstreamPathByName = new Map(rows.map((r) => [r.object_full_name, r.longest_downstream_path || []]));
      tableBodyEl.innerHTML = rows
        .map(
          (r) => {
            const ucnt = Number(r.upstream_count) || 0;
            const dcnt = Number(r.downstream_count) || 0;
            const upCell = ucnt > 0
              ? `<td class="num"><button type="button" class="stats-relation-count-btn" data-relation="upstream" data-lineage-object="${escapeAttr(r.object_full_name)}" aria-label="Show ${ucnt} upstream object${ucnt === 1 ? '' : 's'}">${ucnt.toLocaleString()}</button></td>`
              : `<td class="num stats-num-muted">0</td>`;
            const downCell = dcnt > 0
              ? `<td class="num"><button type="button" class="stats-relation-count-btn" data-relation="downstream" data-lineage-object="${escapeAttr(r.object_full_name)}" aria-label="Show ${dcnt} downstream object${dcnt === 1 ? '' : 's'}">${dcnt.toLocaleString()}</button></td>`
              : `<td class="num stats-num-muted">0</td>`;
            const upDepth = Number(r.longest_upstream_depth) || 0;
            const downDepth = Number(r.longest_downstream_depth) || 0;
            const upDepthCell = upDepth > 0
              ? `<td class="num"><button type="button" class="stats-relation-count-btn" data-path="upstream" data-lineage-object="${escapeAttr(r.object_full_name)}" aria-label="Show longest upstream path (${upDepth} hop${upDepth === 1 ? '' : 's'})">${upDepth.toLocaleString()}</button></td>`
              : `<td class="num stats-num-muted">0</td>`;
            const downDepthCell = downDepth > 0
              ? `<td class="num"><button type="button" class="stats-relation-count-btn" data-path="downstream" data-lineage-object="${escapeAttr(r.object_full_name)}" aria-label="Show longest downstream path (${downDepth} hop${downDepth === 1 ? '' : 's'})">${downDepth.toLocaleString()}</button></td>`
              : `<td class="num stats-num-muted">0</td>`;
            return `
        <tr>
          <td class="cell-name stats-object-cell" title="${escapeAttr(r.object_full_name)}">
            <span class="stats-object-name">${escapeHtml(r.object_full_name)}</span>
            <button type="button" class="stats-lineage-btn" data-open-lineage="${escapeAttr(r.object_full_name)}" aria-label="Open in Lineage">Lineage</button>
          </td>
          <td>${escapeHtml(r.object_type ?? 'Unknown')}</td>
          <td>${r.certified
            ? '<span class="cert-badge cert-badge--yes" title="Certified in Unity Catalog">✓ Certified</span>'
            : '<span class="cert-badge cert-badge--no">—</span>'}</td>
          <td>${escapeHtml(r.catalog)}</td>
          <td>${escapeHtml(r.schema)}</td>
          ${upCell}
          ${downCell}
          ${upDepthCell}
          ${downDepthCell}
        </tr>`;
          }
        )
        .join('');
    }

    function closeStatsListModal() {
      listModal.setAttribute('hidden', '');
    }

    /** @param {'upstream'|'downstream'} relation */
    function openStatsListModal(relation, objectFullName) {
      const map = relation === 'upstream' ? upstreamListByName : downstreamListByName;
      const list = map.get(objectFullName);
      if (!list || !list.length) return;
      const label = relation === 'upstream' ? 'Upstream' : 'Downstream';
      listModalTitle.textContent = `${label} of ${objectFullName}`;
      listModalList.innerHTML = list
        .map((u) => `<li class="stats-modal-list-item" title="${escapeAttr(u)}">${escapeHtml(u)}</li>`)
        .join('');
      listModal.removeAttribute('hidden');
      listModalClose.focus();
    }

    /** @param {'upstream'|'downstream'} direction */
    function openStatsPathModal(direction, objectFullName) {
      const map = direction === 'upstream' ? longestUpstreamPathByName : longestDownstreamPathByName;
      const path = map.get(objectFullName);
      if (!path || path.length <= 1) return;
      const label = direction === 'upstream' ? 'Longest upstream path' : 'Longest downstream path';
      const hops = path.length - 1;
      listModalTitle.textContent = `${label} from ${objectFullName} (${hops} hop${hops === 1 ? '' : 's'})`;
      listModalList.innerHTML = path
        .map(
          (name, i) => `<li class="stats-modal-list-item" title="${escapeAttr(name)}"><span class="stats-modal-step">${i + 1}.</span> ${escapeHtml(name)}</li>`
        )
        .join('');
      listModal.removeAttribute('hidden');
      listModalClose.focus();
    }

    function onTableBodyClick(e) {
      const lineageBtn = e.target.closest('.stats-lineage-btn');
      if (lineageBtn) {
        const name = lineageBtn.getAttribute('data-open-lineage');
        if (name) {
          window.location.hash = `#/lineage?obj=${encodeURIComponent(name)}`;
        }
        return;
      }
      const btn = e.target.closest('.stats-relation-count-btn');
      if (!btn) return;
      const name = btn.getAttribute('data-lineage-object');
      if (!name) return;
      const pathDir = btn.getAttribute('data-path');
      if (pathDir === 'upstream' || pathDir === 'downstream') {
        openStatsPathModal(pathDir, name);
        return;
      }
      const relation = btn.getAttribute('data-relation');
      if (relation !== 'upstream' && relation !== 'downstream') return;
      openStatsListModal(relation, name);
    }

    function onListModalClick(e) {
      if (e.target.closest('[data-close-modal]')) closeStatsListModal();
    }

    function onDocKeydown(e) {
      if (e.key !== 'Escape') return;
      if (listModal.hasAttribute('hidden')) return;
      closeStatsListModal();
    }

    tableBodyEl.addEventListener('click', onTableBodyClick);
    if (theadEl) {
      theadEl.addEventListener('click', onTableHeadClick);
      theadEl.addEventListener('keydown', onTableHeadKeydown);
    }
    listModal.addEventListener('click', onListModalClick);
    document.addEventListener('keydown', onDocKeydown);

    /** Redraw stat charts after theme change (assigned once data is loaded). */
    let rerenderCharts = () => {};
    const onThemeCharts = () => rerenderCharts();
    window.addEventListener(GLOBAL_LINEAGE_THEME_EVENT, onThemeCharts);

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

    catalogSelect.addEventListener('change', () => {
      const v = catalogSelect.value;
      const prev = tableFilter && !tableFilter.object_full_name ? { ...tableFilter } : {};
      delete prev.object_full_name;
      if (v) prev.catalog = v;
      else delete prev.catalog;
      delete prev.schema;
      schemaSelect.value = '';
      tableFilter = Object.keys(prev).length ? prev : null;
      refillSchemaOptions();
      applyTableFilter();
    });

    schemaSelect.addEventListener('change', () => {
      if (!catalogSelect.value) return;
      const prev = tableFilter && !tableFilter.object_full_name ? { ...tableFilter } : {};
      delete prev.object_full_name;
      prev.catalog = catalogSelect.value;
      const s = schemaSelect.value;
      if (s) prev.schema = s;
      else delete prev.schema;
      tableFilter = Object.keys(prev).length ? prev : null;
      applyTableFilter();
    });

    clearFilterBtn.addEventListener('click', () => {
      tableFilter = null;
      catalogSelect.value = '';
      schemaSelect.value = '';
      refillSchemaOptions();
      applyTableFilter();
    });

    try {
      const [summary, byType, byPipeline, top, tableRows] = await Promise.all([
        api.stats.summary(),
        api.stats.byObjectType(),
        api.stats.byPipeline(20),
        api.stats.topDownstream(10),
        api.stats.listObjects({}),
      ]);

      allTableRows = tableRows;
      refillCatalogOptions();
      refillSchemaOptions();
      summaryEl.innerHTML = renderSummary(summary);

      const certBreakdown = () => {
        let yes = 0;
        let no = 0;
        for (const r of allTableRows) {
          if (r.certified) yes += 1;
          else no += 1;
        }
        return [
          { label: 'Certified', count: yes },
          { label: 'Not certified', count: no },
        ];
      };

      const rType = chartCard('Objects by type');
      rType.render('pie', byType, {
        onSegmentClick: ({ label }) => setFilterFromChart('type', label),
      });

      const hasCertified = (summary.certified_objects || 0) > 0;
      const rCert = hasCertified ? chartCard('Certified vs not certified') : null;
      if (rCert) {
        rCert.render('pie', certBreakdown(), {
          onSegmentClick: ({ label }) => setFilterFromChart('certified', label),
        });
      }

      const rCat = chartCard('Objects by catalog (top 20)');
      rCat.render('horizontalBar', byPipeline, {
        onSegmentClick: ({ label }) => setFilterFromChart('catalog', label),
      });

      const rTop = chartCard('Top 10 by downstream count');
      rTop.render(
        'horizontalBar',
        top.map((r) => ({
          label: r.object_full_name,
          count: r.downstream_count,
        })),
        {
          onSegmentClick: ({ label }) => setFilterFromChart('object', label),
        }
      );

      rerenderCharts = () => {
        rType.render('pie', byType, {
          onSegmentClick: ({ label }) => setFilterFromChart('type', label),
        });
        if (rCert) {
          rCert.render('pie', certBreakdown(), {
            onSegmentClick: ({ label }) => setFilterFromChart('certified', label),
          });
        }
        rCat.render('horizontalBar', byPipeline, {
          onSegmentClick: ({ label }) => setFilterFromChart('catalog', label),
        });
        rTop.render(
          'horizontalBar',
          top.map((r) => ({
            label: r.object_full_name,
            count: r.downstream_count,
          })),
          {
            onSegmentClick: ({ label }) => setFilterFromChart('object', label),
          }
        );
      };

      applyTableFilter();
      statusEl.textContent = 'loaded';
    } catch (e) {
      console.error(e);
      statusEl.textContent = `Error: ${e.message}`;
      statusEl.classList.add('error');
    }

    return () => {
      window.removeEventListener(GLOBAL_LINEAGE_THEME_EVENT, onThemeCharts);
      if (theadEl) {
        theadEl.removeEventListener('click', onTableHeadClick);
        theadEl.removeEventListener('keydown', onTableHeadKeydown);
      }
      tableBodyEl.removeEventListener('click', onTableBodyClick);
      listModal.removeEventListener('click', onListModalClick);
      document.removeEventListener('keydown', onDocKeydown);
      for (const r of renderers) {
        try { r.destroy(); } catch (_) {}
      }
    };
  },
};

function renderSummary(s) {
  const items = [
    ['Total objects', s.total_objects],
    ['Certified objects', s.certified_objects],
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
