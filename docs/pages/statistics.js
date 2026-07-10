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
              <div class="stats-table-actions">
                <button type="button" id="clear-table-filter" class="stats-table-clear" hidden>Clear filter</button>
                <button type="button" id="download-table-csv" class="stats-table-download" disabled title="Download the filtered table as CSV">Download CSV</button>
                <button type="button" id="download-table-xlsx" class="stats-table-download" disabled title="Download the filtered table as Excel (.xlsx)">Download Excel</button>
              </div>
            </div>
            <div class="stats-table-filters stats-table-metric-filters" role="group" aria-label="Object metrics">
              <label class="stats-filter-field">
                <span>Columns min</span>
                <input type="number" id="filter-cols-min" class="stats-filter-input" min="0" step="1" placeholder="Any">
              </label>
              <label class="stats-filter-field">
                <span>Columns max</span>
                <input type="number" id="filter-cols-max" class="stats-filter-input" min="0" step="1" placeholder="Any">
              </label>
              <label class="stats-filter-field">
                <span>Has filter</span>
                <select id="filter-has-filter" class="stats-filter-select">
                  <option value="">Any</option>
                  <option value="1">Yes</option>
                  <option value="0">No</option>
                </select>
              </label>
              <label class="stats-filter-field">
                <span>CTEs min</span>
                <input type="number" id="filter-cte-min" class="stats-filter-input" min="0" step="1" placeholder="Any">
              </label>
              <label class="stats-filter-field">
                <span>CTEs max</span>
                <input type="number" id="filter-cte-max" class="stats-filter-input" min="0" step="1" placeholder="Any">
              </label>
              <label class="stats-filter-field">
                <span>Selects min</span>
                <input type="number" id="filter-select-min" class="stats-filter-input" min="0" step="1" placeholder="Any">
              </label>
              <label class="stats-filter-field">
                <span>Selects max</span>
                <input type="number" id="filter-select-max" class="stats-filter-input" min="0" step="1" placeholder="Any">
              </label>
              <label class="stats-filter-field">
                <span>Size min</span>
                <input type="number" id="filter-size-min" class="stats-filter-input" min="0" step="1" placeholder="Any">
              </label>
              <label class="stats-filter-field">
                <span>Size max</span>
                <input type="number" id="filter-size-max" class="stats-filter-input" min="0" step="1" placeholder="Any">
              </label>
            </div>
            <span id="table-filter-label" class="stats-table-filter" hidden></span>
          </div>
          <p class="stats-table-hint">Use the menus to filter by catalog, schema, and object metrics. Charts also narrow the table (type, catalog, or a single object). Click column headers to sort.</p>
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
                  <th scope="col" tabindex="0" role="columnheader" class="stats-sortable num" data-sort-key="number_of_columns" title="Sort by column count">Columns</th>
                  <th scope="col" tabindex="0" role="columnheader" class="stats-sortable" data-sort-key="has_filter" title="Sort by filter presence">Has filter</th>
                  <th scope="col" tabindex="0" role="columnheader" class="stats-sortable num" data-sort-key="number_of_CTE" title="Sort by CTE count">CTEs</th>
                  <th scope="col" tabindex="0" role="columnheader" class="stats-sortable num" data-sort-key="number_of_select" title="Sort by SELECT count">Selects</th>
                  <th scope="col" tabindex="0" role="columnheader" class="stats-sortable num" data-sort-key="size" title="Sort by definition size">Size</th>
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
    const downloadCsvBtn = root.querySelector('#download-table-csv');
    const downloadXlsxBtn = root.querySelector('#download-table-xlsx');
    const catalogSelect = root.querySelector('#filter-catalog');
    const schemaSelect = root.querySelector('#filter-schema');
    const colsMinInput = root.querySelector('#filter-cols-min');
    const colsMaxInput = root.querySelector('#filter-cols-max');
    const hasFilterSelect = root.querySelector('#filter-has-filter');
    const cteMinInput = root.querySelector('#filter-cte-min');
    const cteMaxInput = root.querySelector('#filter-cte-max');
    const selectMinInput = root.querySelector('#filter-select-min');
    const selectMaxInput = root.querySelector('#filter-select-max');
    const sizeMinInput = root.querySelector('#filter-size-min');
    const sizeMaxInput = root.querySelector('#filter-size-max');
    const listModal = root.querySelector('#stats-list-modal');
    const listModalTitle = root.querySelector('#stats-list-modal-title');
    const listModalList = root.querySelector('#stats-list-modal-list');
    const listModalClose = root.querySelector('#stats-list-modal-close');
    const tableEl = root.querySelector('#object-table');
    const theadEl = tableEl && tableEl.querySelector('thead');

    const renderers = [];

    /** @type {{ object_type?: string, catalog?: string, schema?: string, object_full_name?: string, certified?: boolean, has_filter?: boolean, number_of_columns_min?: number, number_of_columns_max?: number, number_of_CTE_min?: number, number_of_CTE_max?: number, number_of_select_min?: number, number_of_select_max?: number, size_min?: number, size_max?: number } | null} */
    let tableFilter = null;
    /** @type {{ object_full_name: string, object_type: string|null, catalog: string, schema: string, downstream_count: number, downstream_objects: string[], upstream_count: number, upstream_objects: string[], number_of_columns: number|null, has_filter: boolean|null, number_of_CTE: number|null, number_of_select: number|null, size: number|null }[]} */
    let allTableRows = [];
    /** Rows currently shown in the table (filtered + sorted); source for downloads. */
    let currentTableRows = [];
    /** @type {Map<string, string[]>} */
    let upstreamListByName = new Map();
    /** @type {Map<string, string[]>} */
    let downstreamListByName = new Map();
    /** @type {Map<string, string[]>} */
    let longestUpstreamPathByName = new Map();
    /** @type {Map<string, string[]>} */
    let longestDownstreamPathByName = new Map();

    /** @type {'object_full_name'|'object_type'|'catalog'|'schema'|'upstream_count'|'downstream_count'|'longest_upstream_depth'|'longest_downstream_depth'|'number_of_columns'|'has_filter'|'number_of_CTE'|'number_of_select'|'size'|'certified'} */
    let sortKey = 'object_full_name';
    /** @type {'asc'|'desc'} */
    let sortDir = 'asc';

    function extractSortValue(row, key) {
      if (
        key === 'upstream_count'
        || key === 'downstream_count'
        || key === 'longest_upstream_depth'
        || key === 'longest_downstream_depth'
        || key === 'number_of_columns'
        || key === 'number_of_CTE'
        || key === 'number_of_select'
        || key === 'size'
      ) {
        const value = row[key];
        return value == null ? -1 : Number(value) || 0;
      }
      if (key === 'certified') return row.certified ? 1 : 0;
      if (key === 'has_filter') {
        if (row.has_filter == null) return -1;
        return row.has_filter ? 1 : 0;
      }
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

    // Set true while a column resize drag is in progress so the ensuing
    // click on the header does not also trigger a sort.
    let suppressNextHeadClick = false;

    function onTableHeadClick(e) {
      if (suppressNextHeadClick) {
        suppressNextHeadClick = false;
        return;
      }
      if (e.target.closest('.stats-col-resizer')) return;
      const th = e.target.closest('th[data-sort-key]');
      if (!th) return;
      const key = th.getAttribute('data-sort-key');
      if (!key) return;
      const allowed = new Set([
        'object_full_name', 'object_type', 'certified', 'catalog', 'schema',
        'upstream_count', 'downstream_count', 'longest_upstream_depth', 'longest_downstream_depth',
        'number_of_columns', 'has_filter', 'number_of_CTE', 'number_of_select', 'size',
      ]);
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

    function parseNumberInput(input) {
      if (!input) return null;
      const raw = String(input.value ?? '').trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }

    function readMetricFilters() {
      return {
        number_of_columns_min: parseNumberInput(colsMinInput),
        number_of_columns_max: parseNumberInput(colsMaxInput),
        has_filter: hasFilterSelect.value === '' ? null : hasFilterSelect.value === '1',
        number_of_CTE_min: parseNumberInput(cteMinInput),
        number_of_CTE_max: parseNumberInput(cteMaxInput),
        number_of_select_min: parseNumberInput(selectMinInput),
        number_of_select_max: parseNumberInput(selectMaxInput),
        size_min: parseNumberInput(sizeMinInput),
        size_max: parseNumberInput(sizeMaxInput),
      };
    }

    function metricFiltersActive(metrics) {
      return metrics.number_of_columns_min != null
        || metrics.number_of_columns_max != null
        || metrics.has_filter != null
        || metrics.number_of_CTE_min != null
        || metrics.number_of_CTE_max != null
        || metrics.number_of_select_min != null
        || metrics.number_of_select_max != null
        || metrics.size_min != null
        || metrics.size_max != null;
    }

    function rowMatchesMetricFilters(row, metrics) {
      if (metrics.has_filter != null && row.has_filter !== metrics.has_filter) return false;
      const bounds = [
        ['number_of_columns', metrics.number_of_columns_min, metrics.number_of_columns_max],
        ['number_of_CTE', metrics.number_of_CTE_min, metrics.number_of_CTE_max],
        ['number_of_select', metrics.number_of_select_min, metrics.number_of_select_max],
        ['size', metrics.size_min, metrics.size_max],
      ];
      for (const [key, min, max] of bounds) {
        if (min == null && max == null) continue;
        const value = row[/** @type {keyof typeof row} */ (key)];
        if (value == null) return false;
        if (min != null && value < min) return false;
        if (max != null && value > max) return false;
      }
      return true;
    }

    function clearMetricFilterInputs() {
      for (const input of [colsMinInput, colsMaxInput, cteMinInput, cteMaxInput, selectMinInput, selectMaxInput, sizeMinInput, sizeMaxInput]) {
        if (input) input.value = '';
      }
      if (hasFilterSelect) hasFilterSelect.value = '';
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
      const metrics = readMetricFilters();
      const hasMetrics = metricFiltersActive(metrics);
      const hasChartFilter = tableFilter && (
        tableFilter.object_full_name
        || tableFilter.object_type
        || tableFilter.catalog
        || tableFilter.schema
        || tableFilter.certified !== undefined
      );
      if (!hasChartFilter && !hasMetrics) return '';
      const parts = [];
      if (tableFilter?.object_full_name) {
        parts.push(`object = ${tableFilter.object_full_name}`);
      } else if (tableFilter) {
        if (tableFilter.object_type) parts.push(`type = ${tableFilter.object_type}`);
        if (tableFilter.certified !== undefined) parts.push(`certified = ${tableFilter.certified ? 'yes' : 'no'}`);
        if (tableFilter.catalog) parts.push(`catalog = ${tableFilter.catalog}`);
        if (tableFilter.schema) parts.push(`schema = ${tableFilter.schema}`);
      }
      if (metrics.number_of_columns_min != null || metrics.number_of_columns_max != null) {
        parts.push(`columns ${formatRange(metrics.number_of_columns_min, metrics.number_of_columns_max)}`);
      }
      if (metrics.has_filter != null) parts.push(`has filter = ${metrics.has_filter ? 'yes' : 'no'}`);
      if (metrics.number_of_CTE_min != null || metrics.number_of_CTE_max != null) {
        parts.push(`CTEs ${formatRange(metrics.number_of_CTE_min, metrics.number_of_CTE_max)}`);
      }
      if (metrics.number_of_select_min != null || metrics.number_of_select_max != null) {
        parts.push(`selects ${formatRange(metrics.number_of_select_min, metrics.number_of_select_max)}`);
      }
      if (metrics.size_min != null || metrics.size_max != null) {
        parts.push(`size ${formatRange(metrics.size_min, metrics.size_max)}`);
      }
      return parts.join(' · ');
    }

    function formatRange(min, max) {
      if (min != null && max != null) return `${min}–${max}`;
      if (min != null) return `≥ ${min}`;
      return `≤ ${max}`;
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
      const metrics = readMetricFilters();
      const spec = tableFilter && (tableFilter.object_full_name || tableFilter.object_type || tableFilter.catalog || tableFilter.schema || tableFilter.certified !== undefined)
        ? tableFilter
        : {};
      const rows = allTableRows.filter((r) => {
        if (spec.object_full_name) return r.object_full_name === spec.object_full_name;
        if (spec.object_type && (r.object_type ?? 'Unknown') !== spec.object_type) return false;
        if (spec.certified !== undefined && Boolean(r.certified) !== spec.certified) return false;
        if (spec.catalog && r.catalog !== spec.catalog) return false;
        if (spec.schema && r.schema !== spec.schema) return false;
        if (!rowMatchesMetricFilters(r, metrics)) return false;
        return true;
      });
      const sorted = sortRows(rows);
      currentTableRows = sorted;
      renderTableBody(sorted);
      syncSortHeaders();
      const summary = filterSummary();
      if (summary) {
        filterLabelEl.hidden = false;
        filterLabelEl.textContent = `Filtered: ${summary}`;
        clearFilterBtn.hidden = false;
      } else {
        filterLabelEl.hidden = true;
        clearFilterBtn.hidden = metricFiltersActive(metrics);
      }
      tableCountEl.textContent = `${sorted.length.toLocaleString()} row${sorted.length === 1 ? '' : 's'}`;
      const hasRows = sorted.length > 0;
      if (downloadCsvBtn) downloadCsvBtn.disabled = !hasRows;
      if (downloadXlsxBtn) downloadXlsxBtn.disabled = !hasRows;
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
            const colsCell = renderMetricNumberCell(r.number_of_columns);
            const filterCell = renderHasFilterCell(r.has_filter);
            const cteCell = renderMetricNumberCell(r.number_of_CTE);
            const selectCell = renderMetricNumberCell(r.number_of_select);
            const sizeCell = renderMetricNumberCell(r.size);
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
          ${colsCell}
          ${filterCell}
          ${cteCell}
          ${selectCell}
          ${sizeCell}
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

    // Column resizing: drag the handle on a header's right edge. The first
    // drag freezes all current column widths and switches to a fixed layout
    // so subsequent drags resize precisely without reflowing siblings.
    function setupColumnResizing() {
      if (!theadEl || !tableEl) return () => {};
      const headerRow = theadEl.querySelector('tr');
      if (!headerRow) return () => {};
      const ths = Array.from(headerRow.querySelectorAll('th'));
      let activeTh = null;
      let startX = 0;
      let startWidth = 0;
      let layoutFrozen = false;

      function freezeWidths() {
        const widths = ths.map((th) => th.getBoundingClientRect().width);
        const total = widths.reduce((a, b) => a + b, 0);
        ths.forEach((th, i) => { th.style.width = `${Math.round(widths[i])}px`; });
        tableEl.style.tableLayout = 'fixed';
        tableEl.style.width = `${Math.round(total)}px`;
        tableEl.classList.add('stats-table--resizable');
        layoutFrozen = true;
      }

      function onPointerMove(e) {
        if (!activeTh) return;
        suppressNextHeadClick = true;
        const dx = e.clientX - startX;
        const w = Math.max(56, startWidth + dx);
        activeTh.style.width = `${Math.round(w)}px`;
        const total = ths.reduce((sum, th) => sum + th.getBoundingClientRect().width, 0);
        tableEl.style.width = `${Math.round(total)}px`;
      }

      function onPointerUp() {
        if (!activeTh) return;
        activeTh = null;
        document.body.classList.remove('stats-col-resizing');
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        // Clear any lingering click suppression once the click has fired.
        setTimeout(() => { suppressNextHeadClick = false; }, 0);
      }

      function onPointerDown(e) {
        const handle = e.target.closest('.stats-col-resizer');
        if (!handle) return;
        const th = handle.parentElement;
        if (!th) return;
        e.preventDefault();
        e.stopPropagation();
        if (!layoutFrozen) freezeWidths();
        activeTh = th;
        startX = e.clientX;
        startWidth = th.getBoundingClientRect().width;
        suppressNextHeadClick = true;
        document.body.classList.add('stats-col-resizing');
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      }

      for (const th of ths) {
        const handle = document.createElement('span');
        handle.className = 'stats-col-resizer';
        handle.setAttribute('aria-hidden', 'true');
        th.appendChild(handle);
      }
      theadEl.addEventListener('pointerdown', onPointerDown);

      return () => {
        theadEl.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        document.body.classList.remove('stats-col-resizing');
      };
    }

    tableBodyEl.addEventListener('click', onTableBodyClick);
    if (theadEl) {
      theadEl.addEventListener('click', onTableHeadClick);
      theadEl.addEventListener('keydown', onTableHeadKeydown);
    }
    const teardownColumnResizing = setupColumnResizing();
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
      clearMetricFilterInputs();
      refillSchemaOptions();
      applyTableFilter();
    });

    if (downloadCsvBtn) {
      downloadCsvBtn.addEventListener('click', () => {
        if (!currentTableRows.length) return;
        downloadStatsCsv(currentTableRows);
      });
    }
    if (downloadXlsxBtn) {
      downloadXlsxBtn.addEventListener('click', () => {
        if (!currentTableRows.length) return;
        try {
          downloadStatsXlsx(currentTableRows);
        } catch (err) {
          statusEl.textContent = `Excel download failed: ${err.message}`;
          statusEl.classList.add('error');
        }
      });
    }

    function onMetricFilterChange() {
      applyTableFilter();
    }

    for (const input of [colsMinInput, colsMaxInput, cteMinInput, cteMaxInput, selectMinInput, selectMaxInput, sizeMinInput, sizeMaxInput]) {
      if (input) input.addEventListener('change', onMetricFilterChange);
    }
    if (hasFilterSelect) hasFilterSelect.addEventListener('change', onMetricFilterChange);

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
      teardownColumnResizing();
      tableBodyEl.removeEventListener('click', onTableBodyClick);
      listModal.removeEventListener('click', onListModalClick);
      document.removeEventListener('keydown', onDocKeydown);
      for (const r of renderers) {
        try { r.destroy(); } catch (_) {}
      }
    };
  },
};

function renderMetricNumberCell(value) {
  if (value == null) return '<td class="num stats-num-muted">—</td>';
  return `<td class="num">${Number(value).toLocaleString()}</td>`;
}

function renderHasFilterCell(value) {
  if (value == null) return '<td class="stats-num-muted">—</td>';
  return value
    ? '<td><span class="cert-badge cert-badge--yes" title="Definition includes a filter">Yes</span></td>'
    : '<td><span class="cert-badge cert-badge--no">No</span></td>';
}

// Columns exported by the CSV / Excel downloads — mirrors the visible table.
const STATS_EXPORT_COLUMNS = [
  { header: 'Object', get: (r) => r.object_full_name ?? '' },
  { header: 'Type', get: (r) => r.object_type ?? 'Unknown' },
  { header: 'Certified', get: (r) => (r.certified ? 'Yes' : 'No') },
  { header: 'Catalog', get: (r) => r.catalog ?? '' },
  { header: 'Schema', get: (r) => r.schema ?? '' },
  { header: 'Upstream', get: (r) => Number(r.upstream_count) || 0 },
  { header: 'Downstream', get: (r) => Number(r.downstream_count) || 0 },
  { header: 'Longest upstream depth', get: (r) => Number(r.longest_upstream_depth) || 0 },
  { header: 'Longest downstream depth', get: (r) => Number(r.longest_downstream_depth) || 0 },
  { header: 'Columns', get: (r) => (r.number_of_columns == null ? '' : Number(r.number_of_columns)) },
  { header: 'Has filter', get: (r) => (r.has_filter == null ? '' : r.has_filter ? 'Yes' : 'No') },
  { header: 'CTEs', get: (r) => (r.number_of_CTE == null ? '' : Number(r.number_of_CTE)) },
  { header: 'Selects', get: (r) => (r.number_of_select == null ? '' : Number(r.number_of_select)) },
  { header: 'Size', get: (r) => (r.size == null ? '' : Number(r.size)) },
];

function statsExportRows(rows) {
  const header = STATS_EXPORT_COLUMNS.map((c) => c.header);
  const body = rows.map((r) => STATS_EXPORT_COLUMNS.map((c) => c.get(r)));
  return [header, ...body];
}

function statsCsvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function statsExportFilename(ext) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `lineage-objects-${stamp}.${ext}`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadStatsCsv(rows) {
  const aoa = statsExportRows(rows);
  const csv = aoa.map((r) => r.map(statsCsvCell).join(',')).join('\r\n');
  // Prepend UTF-8 BOM so Excel renders non-ASCII names correctly.
  const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, statsExportFilename('csv'));
}

function downloadStatsXlsx(rows) {
  if (typeof window === 'undefined' || typeof window.XLSX === 'undefined') {
    throw new Error('XLSX library not loaded — check the network for the CDN script.');
  }
  const XLSX = window.XLSX;
  const aoa = statsExportRows(rows);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Size each column to its widest value so nothing is clipped and columns
  // are not all the same fixed default width.
  ws['!cols'] = aoa[0].map((_, col) => {
    let max = 0;
    for (const row of aoa) {
      const len = String(row[col] ?? '').length;
      if (len > max) max = len;
    }
    return { wch: Math.min(Math.max(max + 2, 6), 80) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Objects');
  XLSX.writeFile(wb, statsExportFilename('xlsx'));
}

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
