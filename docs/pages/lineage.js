// Lineage page: pick a root object, render only its reachable subgraph.
//
// The full graph (~1.7k nodes, ~144k edges) is too large to render at
// once. We let the user search for a starting object, then load just
// the subgraph reachable from it (downstream by default).
//
// This page is the only file that knows about the *concrete* graph
// renderer. To swap Cytoscape for another library, change just the
// import below and ensure the new factory satisfies the GraphRenderer
// contract from renderers/graph/graph-renderer.js.

import { api } from '../api/client.js';
import { getUnifiedLineageStore } from '../lib/unified-lineage-store.js';
import { GLOBAL_LINEAGE_THEME_EVENT } from '../lib/theme.js';
import { createCytoscapeRenderer as createGraphRenderer } from '../renderers/graph/cytoscape-renderer.js';
import { SUPPORTED_LAYOUTS } from '../renderers/graph/graph-renderer.js';

const DEFAULT_DIRECTION = 'both';
const DEFAULT_LAYOUT = 'dagre';
const ALL_SENTINEL = '(all)'; // pick this in the search box to load the whole graph

export const lineagePage = {
  id: 'lineage',
  title: 'Lineage',

  async mount(root) {
    const store = await getUnifiedLineageStore();
    const exploreUrlFor = (fullName) => store.exploreUrlFor(fullName);

    root.innerHTML = `
      <div class="toolbar">
        <label for="root-input">Object</label>
        <input id="root-input" type="search" list="root-options"
               placeholder="Type to search, or pick (all) to load every object"
               autocomplete="off" spellcheck="false" />
        <datalist id="root-options"></datalist>

        <label for="tier-catalog">Catalog</label>
        <select id="tier-catalog" class="tier-select"></select>

        <label for="tier-schema">Schema</label>
        <select id="tier-schema" class="tier-select" disabled></select>

        <label for="tier-table">Table/View</label>
        <select id="tier-table" class="tier-select" disabled></select>

        <label for="direction">Direction</label>
        <select id="direction">
          <option value="both" selected>Both (all connected)</option>
          <option value="down">Downstream (reach)</option>
          <option value="up">Upstream (sources)</option>
        </select>

        <label for="depth">Depth</label>
        <select id="depth" class="depth-select">
          <option value="" selected>∞</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="5">5</option>
        </select>

        <label for="stop-at-table" class="toolbar-check" title="When walking upstream, include tables and materialized views but do not show what feeds them.">
          <input id="stop-at-table" type="checkbox" />
          <span>Stop at table</span>
        </label>

        <label for="certified-only" class="toolbar-check" title="Only show objects that are certified in Unity Catalog.">
          <input id="certified-only" type="checkbox" />
          <span>Certified only</span>
        </label>

        <label for="layout">Layout</label>
        <select id="layout">
          ${SUPPORTED_LAYOUTS.map((l) =>
            `<option value="${l}"${l === DEFAULT_LAYOUT ? ' selected' : ''}>${l}</option>`
          ).join('')}
        </select>

        <button id="fit" class="secondary">Fit</button>
        <button id="download-csv" class="secondary" disabled title="Load lineage first">Download CSV</button>
        <button id="download-xlsx" class="secondary" disabled title="Load lineage first">Download Excel</button>
        <button id="view-table" class="secondary" disabled title="Load lineage first">View Table</button>
        <span id="status" class="status">Pick a root object to view its lineage.</span>
      </div>
      <div class="lineage-body" id="lineage-body">
        <div class="graph-host">
          <div id="graph" class="graph-canvas"></div>
          <div id="node-popover" class="node-popover" role="tooltip" hidden></div>
          <button
            type="button"
            id="side-panel-show"
            class="side-panel-show"
            aria-label="Show details panel"
            title="Show details"
            hidden
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
            <span>Details</span>
          </button>
        </div>
        <aside class="side-panel" id="side-panel">
          <div class="side-panel-header">
            <h2 class="side-panel-heading">Details</h2>
            <button
              type="button"
              id="side-panel-hide"
              class="side-panel-hide"
              aria-label="Hide details panel"
              title="Hide details"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <div class="side-panel-body" id="side-panel-body">
            <div class="empty-state">
              <p>No graph loaded yet.</p>
              <p>Type a table name in the search box above and press <kbd>Enter</kbd> or click <strong>Load</strong>.</p>
            </div>
          </div>
        </aside>
      </div>

      <div id="lineage-table-modal" class="stats-modal" hidden role="dialog" aria-modal="true" aria-labelledby="lineage-table-modal-title">
        <div class="stats-modal-backdrop" data-close-modal tabindex="-1"></div>
        <div class="stats-modal-panel stats-modal-panel--wide">
          <div class="stats-modal-header">
            <h3 id="lineage-table-modal-title">Lineage table</h3>
            <button type="button" class="stats-modal-close" data-close-modal aria-label="Close">×</button>
          </div>
          <div class="stats-table-wrap stats-table-wrap--in-modal">
            <table class="stats-table" id="lineage-table-modal-table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Target Type</th>
                  <th>Source</th>
                  <th>Source Type</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const graphHost = root.querySelector('#graph');
    const popoverEl = root.querySelector('#node-popover');
    const statusEl = root.querySelector('#status');
    const rootInputEl = root.querySelector('#root-input');
    const datalistEl = root.querySelector('#root-options');
    const tierCatalogEl = root.querySelector('#tier-catalog');
    const tierSchemaEl = root.querySelector('#tier-schema');
    const tierTableEl = root.querySelector('#tier-table');
    const directionEl = root.querySelector('#direction');
    const depthEl = root.querySelector('#depth');
    const stopAtTableEl = root.querySelector('#stop-at-table');
    const certifiedOnlyEl = root.querySelector('#certified-only');
    const layoutEl = root.querySelector('#layout');
    const fitBtn = root.querySelector('#fit');
    const downloadCsvBtn = root.querySelector('#download-csv');
    const downloadXlsxBtn = root.querySelector('#download-xlsx');
    const viewTableBtn = root.querySelector('#view-table');
    const tableModalEl = root.querySelector('#lineage-table-modal');
    const tableModalTbody = root.querySelector('#lineage-table-modal-table tbody');
    const tableModalTitle = root.querySelector('#lineage-table-modal-title');
    const lineageBodyEl = root.querySelector('#lineage-body');
    const sidePanelEl = root.querySelector('#side-panel');
    const sideEl = root.querySelector('#side-panel-body');
    const sidePanelHideBtn = root.querySelector('#side-panel-hide');
    const sidePanelShowBtn = root.querySelector('#side-panel-show');

    const SIDE_PANEL_COLLAPSED_KEY = 'global-lineage-side-panel-collapsed';
    function applySidePanelCollapsed(collapsed) {
      lineageBodyEl.classList.toggle('lineage-body--panel-collapsed', collapsed);
      sidePanelEl.classList.toggle('side-panel--collapsed', collapsed);
      sidePanelEl.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
      sidePanelShowBtn.hidden = !collapsed;
    }
    let sidePanelCollapsed = false;
    try {
      sidePanelCollapsed = localStorage.getItem(SIDE_PANEL_COLLAPSED_KEY) === '1';
    } catch (e) { /* ignore */ }
    applySidePanelCollapsed(sidePanelCollapsed);

    // Most recently rendered graph — captured after each successful load so
    // the Download CSV button exports exactly what's on screen.
    let currentNodes = [];
    let currentEdges = [];
    let currentScope = { root: '', direction: '', depth: '' };

    const renderer = createGraphRenderer();
    renderer.init(graphHost);

    function setSidePanelCollapsed(collapsed) {
      sidePanelCollapsed = collapsed;
      applySidePanelCollapsed(collapsed);
      try { localStorage.setItem(SIDE_PANEL_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
      // The graph host width just changed — let cytoscape recompute its viewport.
      try { renderer.fit?.(); } catch (e) { /* ignore */ }
    }
    sidePanelHideBtn.addEventListener('click', () => setSidePanelCollapsed(true));
    sidePanelShowBtn.addEventListener('click', () => setSidePanelCollapsed(false));

    const onGraphTheme = () => {
      if (typeof renderer.refreshTheme === 'function') renderer.refreshTheme();
    };
    window.addEventListener(GLOBAL_LINEAGE_THEME_EVENT, onGraphTheme);

    renderer.onNodeClick((node) => {
      if (!node) {
        sideEl.innerHTML = emptyPanel();
        return;
      }
      sideEl.innerHTML = renderNodeDetails(node, exploreUrlFor);
      // If the user clicked a node while the panel was hidden, surface the
      // details automatically so they don't have to click "Details" too.
      if (sidePanelCollapsed) setSidePanelCollapsed(false);
    });

    // Double-click any node → make it the new root and reload.
    renderer.onNodeDoubleClick((node) => {
      if (!node || !node.id) return;
      rootInputEl.value = node.id;
      lastLoadedRoot = null;
      load();
    });

    // Hover any node → show a popover near the cursor with its info.
    // We delay the hide so the user can move into the popover and click
    // the Unity Catalog link; mouseenter on the popover cancels the
    // pending hide; mouseleave on the popover hides it immediately.
    let popoverHideTimer = null;
    const cancelHide = () => {
      if (popoverHideTimer) { clearTimeout(popoverHideTimer); popoverHideTimer = null; }
    };
    renderer.onNodeHover(
      (node, mouseEvent) => {
        if (!node) return;
        cancelHide();
        popoverEl.innerHTML = renderPopover(node, exploreUrlFor);
        popoverEl.hidden = false;
        positionPopover(popoverEl, mouseEvent, graphHost);
      },
      () => {
        cancelHide();
        popoverHideTimer = setTimeout(() => { popoverEl.hidden = true; }, 250);
      }
    );
    popoverEl.addEventListener('mouseenter', cancelHide);
    popoverEl.addEventListener('mouseleave', () => { popoverEl.hidden = true; });

    function emptyPanel() {
      return `<div class="empty-state">
        <p><strong>Click</strong> a node to see details.</p>
        <p><strong>Double-click</strong> a node to re-center the graph on it.</p>
      </div>`;
    }

    // Datalist: load every object name once on mount and let the browser
    // filter the suggestions as the user types. With our ~2k-row table
    // this is cheaper and more accurate than per-keystroke fetches.
    let knownOptions = new Set();
    let lastLoadedRoot = null;

    // catalog → schema → [table names]; rebuilt whenever the list is fetched.
    let hierarchy = {};

    function buildHierarchy(allNames) {
      const tree = {};
      for (const n of allNames) {
        const parts = n.split('.');
        if (parts.length < 3) continue;          // skip non-three-part names
        const [cat, sch, ...rest] = parts;
        const tbl = rest.join('.');
        (tree[cat] = tree[cat] || {});
        (tree[cat][sch] = tree[cat][sch] || []).push(tbl);
      }
      return tree;
    }

    function fillSelect(el, placeholder, items) {
      const opts = [`<option value="">— ${escapeHtml(placeholder)} —</option>`]
        .concat(items.map((v) => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`));
      el.innerHTML = opts.join('');
    }

    function refreshCatalogList() {
      fillSelect(tierCatalogEl, 'Catalog', Object.keys(hierarchy).sort());
      fillSelect(tierSchemaEl, 'Schema', []);
      fillSelect(tierTableEl, 'Table/View', []);
      tierSchemaEl.disabled = true;
      tierTableEl.disabled = true;
    }

    tierCatalogEl.addEventListener('change', () => {
      const cat = tierCatalogEl.value;
      const schemas = cat ? Object.keys(hierarchy[cat] || {}).sort() : [];
      fillSelect(tierSchemaEl, 'Schema', schemas);
      fillSelect(tierTableEl, 'Table/View', []);
      tierSchemaEl.disabled = !cat;
      tierTableEl.disabled = true;
    });

    tierSchemaEl.addEventListener('change', () => {
      const cat = tierCatalogEl.value;
      const sch = tierSchemaEl.value;
      const tables = (cat && sch) ? (hierarchy[cat][sch] || []).slice().sort() : [];
      fillSelect(tierTableEl, 'Table/View', tables);
      tierTableEl.disabled = !sch;
    });

    tierTableEl.addEventListener('change', () => {
      const cat = tierCatalogEl.value;
      const sch = tierSchemaEl.value;
      const tbl = tierTableEl.value;
      if (!cat || !sch || !tbl) return;
      const fullName = `${cat}.${sch}.${tbl}`;
      rootInputEl.value = fullName;
      lastLoadedRoot = null;
      load();
    });

    async function primeDatalist() {
      try {
        const all = await api.searchObjects('', 0);
        knownOptions = new Set([ALL_SENTINEL, ...all]);
        const allOption = `<option value="${escapeAttr(ALL_SENTINEL)}">Load every object</option>`;
        const opts = all
          .map((n) => `<option value="${escapeAttr(n)}"></option>`)
          .join('');
        datalistEl.innerHTML = allOption + opts;

        hierarchy = buildHierarchy(all);
        refreshCatalogList();
      } catch (e) {
        console.warn('object list failed', e);
        statusEl.textContent = `Error loading object list: ${e.message}`;
        statusEl.classList.add('error');
      }
    }

    // Auto-load whenever the input value matches a known object — fires on
    // every keystroke and on datalist selection.
    rootInputEl.addEventListener('input', () => {
      const v = rootInputEl.value.trim();
      if (v && knownOptions.has(v) && v !== lastLoadedRoot) load();
    });
    // `change` fires on blur or after a datalist selection.
    rootInputEl.addEventListener('change', () => {
      const v = rootInputEl.value.trim();
      if (v === ALL_SENTINEL) {
        refreshCatalogList();
      } else if (v && knownOptions.has(v)) {
        syncTierSelectorsFromRoot(v);
      }
      if (v && v !== lastLoadedRoot) load();
    });

    function lineageRootFromHash() {
      const hash = window.location.hash || '';
      const q = hash.indexOf('?');
      if (q < 0) return null;
      const params = new URLSearchParams(hash.slice(q + 1));
      const raw = (params.get('obj') || params.get('root') || params.get('object') || '').trim();
      return raw || null;
    }

    function stripLineageQueryFromHash() {
      if (!window.location.hash.includes('?')) return;
      const path = `${window.location.pathname}${window.location.search}#/lineage`;
      try {
        history.replaceState(null, '', path);
      } catch (_) { /* ignore */ }
    }

    function syncTierSelectorsFromRoot(fullName) {
      const parts = String(fullName).split('.');
      if (parts.length < 3) return;
      const cat = parts[0];
      const sch = parts[1];
      const tbl = parts.slice(2).join('.');
      if (!hierarchy[cat]) return;
      tierCatalogEl.value = cat;
      tierCatalogEl.dispatchEvent(new Event('change', { bubbles: true }));
      if (!hierarchy[cat][sch]) return;
      tierSchemaEl.value = sch;
      tierSchemaEl.dispatchEvent(new Event('change', { bubbles: true }));
      if ((hierarchy[cat][sch] || []).includes(tbl)) tierTableEl.value = tbl;
    }

    (async () => {
      await primeDatalist();
      const fromHash = lineageRootFromHash();
      if (!fromHash) return;
      if (knownOptions.has(fromHash)) {
        rootInputEl.value = fromHash;
        lastLoadedRoot = null;
        await load();
        stripLineageQueryFromHash();
      } else {
        statusEl.textContent = `Unknown object (not in graph): ${fromHash}`;
        statusEl.classList.add('error');
        stripLineageQueryFromHash();
      }
    })();

    async function load() {
      const rootName = rootInputEl.value.trim();
      if (!rootName) {
        statusEl.textContent = 'Enter a root object first.';
        statusEl.classList.add('error');
        return;
      }
      if (rootName === ALL_SENTINEL) {
        refreshCatalogList();
      } else if (knownOptions.has(rootName)) {
        syncTierSelectorsFromRoot(rootName);
      }
      // Claim this root immediately so overlapping auto-load triggers
      // (input → refreshDatalist + change) coalesce into one request.
      lastLoadedRoot = rootName;
      statusEl.classList.remove('error');
      statusEl.textContent = `loading lineage from ${rootName}…`;

      try {
        const depth = depthEl.value ? Number(depthEl.value) : null;
        const direction = directionEl.value;
        const stopAtTable = !!stopAtTableEl.checked;
        const isAll = rootName === ALL_SENTINEL;
        const t0 = performance.now();
        const result = isAll
          ? await api.lineageAll()
          : await api.lineageFrom(rootName, { direction, depth, stopAtTable });
        const fetchedAt = performance.now();
        let { nodes, edges } = result;

        // "Certified only" — keep certified nodes and edges that connect two
        // certified nodes. Applied client-side after the reachability fetch.
        if (certifiedOnlyEl.checked) {
          const keep = new Set(
            nodes.filter((n) => n.data && n.data.certified).map((n) => n.id),
          );
          nodes = nodes.filter((n) => keep.has(n.id));
          edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
        }

        // For very large views, dagre is too slow — auto-switch to a
        // O(n) layout. User can still flip back with the dropdown.
        if ((isAll || nodes.length > 500) && layoutEl.value === 'dagre') {
          layoutEl.value = 'concentric';
        }

        statusEl.textContent =
          `${nodes.length.toLocaleString()} nodes · ${edges.length.toLocaleString()} edges (fetch ${Math.round(fetchedAt - t0)}ms) — laying out…`;

        // Yield twice: once for the "laying out…" status to paint, once
        // more after a frame so the browser can finish style/layout work
        // before we kick off the synchronous Cytoscape layout.
        await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => setTimeout(r, 0));
        renderer.setLayout(layoutEl.value);
        renderer.render(nodes, edges);

        currentNodes = nodes;
        currentEdges = edges;
        currentScope = {
          root: isAll ? ALL_SENTINEL : rootName,
          direction: isAll ? 'all' : direction,
          depth: depth ?? '',
        };
        downloadCsvBtn.disabled = false;
        downloadCsvBtn.title = 'Download the visible graph as CSV';
        downloadXlsxBtn.disabled = false;
        downloadXlsxBtn.title = 'Download the visible graph as Excel (.xlsx) with merged cells';
        viewTableBtn.disabled = false;
        viewTableBtn.title = 'Open the visible graph as a grouped table';

        const doneAt = performance.now();
        const scopeLabel = isAll
          ? 'entire graph'
          : `from ${rootName} (${direction}${depth ? `, depth ${depth}` : ''})`;
        statusEl.textContent =
          `${nodes.length.toLocaleString()} nodes · ${edges.length.toLocaleString()} edges — ${scopeLabel} — fetch ${Math.round(fetchedAt - t0)}ms · render ${Math.round(doneAt - fetchedAt)}ms`;

        if (isAll) {
          renderer.highlight('');
          sideEl.innerHTML = `<div class="empty-state">Whole graph loaded. Click a node for details.</div>`;
        } else {
          renderer.highlight(rootName);
          const rootNode = nodes.find((n) => n.id === rootName);
          sideEl.innerHTML = renderNodeDetails(
            {
              id: rootName,
              label: rootName,
              type: rootNode?.type ?? null,
              data: rootNode?.data ?? {},
            },
            exploreUrlFor,
          );
        }
      } catch (e) {
        console.error(e);
        statusEl.textContent = `Error: ${e.message}`;
        statusEl.classList.add('error');
        lastLoadedRoot = null; // allow retry
      }
    }

    layoutEl.addEventListener('change', () => renderer.setLayout(layoutEl.value));
    fitBtn.addEventListener('click', () => renderer.fit());
    downloadCsvBtn.addEventListener('click', () => {
      if (!currentNodes.length) return;
      downloadLineageCsv(currentNodes, currentEdges, currentScope);
    });
    downloadXlsxBtn.addEventListener('click', () => {
      if (!currentNodes.length) return;
      try {
        downloadLineageXlsx(currentNodes, currentEdges, currentScope);
      } catch (err) {
        console.error(err);
        statusEl.textContent = `Excel download failed: ${err.message}`;
        statusEl.classList.add('error');
      }
    });
    viewTableBtn.addEventListener('click', () => {
      if (!currentNodes.length) return;
      openLineageTableModal(currentNodes, currentEdges, currentScope);
    });
    tableModalEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-modal]')) closeLineageTableModal();
    });
    const onDocKeydownForTable = (e) => {
      if (e.key === 'Escape' && !tableModalEl.hasAttribute('hidden')) closeLineageTableModal();
    };
    document.addEventListener('keydown', onDocKeydownForTable);

    function openLineageTableModal(nodes, edges, scope) {
      tableModalTbody.innerHTML = renderGroupedLineageRows(nodes, edges);
      tableModalTitle.textContent = lineageTableTitle(scope);
      tableModalEl.removeAttribute('hidden');
    }
    function closeLineageTableModal() {
      tableModalEl.setAttribute('hidden', '');
    }
    // Direction / depth changes re-trigger load if a root is already loaded.
    directionEl.addEventListener('change', () => {
      if (lastLoadedRoot) { lastLoadedRoot = null; load(); }
    });
    depthEl.addEventListener('change', () => {
      if (lastLoadedRoot) { lastLoadedRoot = null; load(); }
    });
    stopAtTableEl.addEventListener('change', () => {
      if (lastLoadedRoot) { lastLoadedRoot = null; load(); }
    });
    certifiedOnlyEl.addEventListener('change', () => {
      if (lastLoadedRoot) { lastLoadedRoot = null; load(); }
    });
    rootInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        lastLoadedRoot = null;
        load();
      }
    });

    return () => {
      if (popoverHideTimer) clearTimeout(popoverHideTimer);
      window.removeEventListener(GLOBAL_LINEAGE_THEME_EVENT, onGraphTheme);
      document.removeEventListener('keydown', onDocKeydownForTable);
      renderer.destroy();
    };
  },
};

function renderPopover(node, exploreUrlFor) {
  const name = node.label || node.id;
  const url = exploreUrlFor(name);
  const externalLink = node.data && node.data.link ? String(node.data.link) : '';
  const certified = !!(node.data && node.data.certified);
  const rowDefs = [['Type', escapeHtml(node.type || '—')]];
  // Only surface certification when the object is actually certified.
  if (certified) rowDefs.push(['Certified', certifiedBadge(true)]);
  rowDefs.push(...objectMetricFieldRows(node.data));
  const rows = rowDefs
    .map(
      ([k, v]) => `<div class="row"><span class="k">${escapeHtml(k)}</span><span class="v">${v}</span></div>`
    )
    .join('');
  const link = `<div class="row"><span class="k">Catalog</span><span class="v"><a href="${escapeAttr(url)}" target="_blank" rel="noopener">Open in Unity Catalog ↗</a></span></div>`;
  return `<div class="title">${objectNameHtml(name, externalLink)}</div>${rows}${link}`;
}

function positionPopover(popoverEl, mouseEvent, hostEl) {
  // Anchor relative to the graph-host so the popover scrolls with it.
  // mouseEvent.clientX/Y are viewport-relative.
  const hostRect = hostEl.getBoundingClientRect();
  const x = mouseEvent.clientX - hostRect.left;
  const y = mouseEvent.clientY - hostRect.top;
  // Show then measure so we can flip-edges to stay inside the host.
  popoverEl.style.left = '0px';
  popoverEl.style.top = '0px';
  const pw = popoverEl.offsetWidth;
  const ph = popoverEl.offsetHeight;
  const margin = 12;
  let left = x + margin;
  let top = y + margin;
  if (left + pw > hostRect.width - 4) left = x - pw - margin;
  if (top + ph > hostRect.height - 4) top = y - ph - margin;
  if (left < 4) left = 4;
  if (top < 4) top = 4;
  popoverEl.style.left = `${left}px`;
  popoverEl.style.top = `${top}px`;
}

function certifiedBadge(certified) {
  return certified
    ? '<span class="cert-badge cert-badge--yes" title="Certified in Unity Catalog">✓ Certified</span>'
    : '<span class="cert-badge cert-badge--no" title="Not certified">Not certified</span>';
}

/** @param {Record<string, unknown>|null|undefined} data */
function objectMetricFieldRows(data) {
  if (!data) return [];
  /** @type {[string, string][]} */
  const rows = [];
  if (data.number_of_columns != null) {
    rows.push(['Columns', escapeHtml(Number(data.number_of_columns).toLocaleString())]);
  }
  if (data.has_filter != null) {
    rows.push(['Has filter', data.has_filter
      ? '<span class="cert-badge cert-badge--yes">Yes</span>'
      : '<span class="cert-badge cert-badge--no">No</span>']);
  }
  if (data.number_of_CTE != null) {
    rows.push(['CTEs', escapeHtml(Number(data.number_of_CTE).toLocaleString())]);
  }
  if (data.number_of_select != null) {
    rows.push(['SELECTs', escapeHtml(Number(data.number_of_select).toLocaleString())]);
  }
  if (data.size != null) {
    rows.push(['Size', escapeHtml(Number(data.size).toLocaleString())]);
  }
  return rows;
}

function renderNodeDetails(node, exploreUrlFor) {
  const name = node.label || node.id;
  const url = exploreUrlFor(name);
  const externalLink = node.data && node.data.link ? String(node.data.link) : '';
  const certified = !!(node.data && node.data.certified);
  const fields = [
    ['Type', escapeHtml(node.type || '—')],
  ];
  // Only surface certification when the object is actually certified.
  if (certified) fields.push(['Certified', certifiedBadge(true)]);
  fields.push(...objectMetricFieldRows(node.data));
  const rows = fields
    .map(
      ([k, v]) => `
        <div class="field">
          <div class="label">${escapeHtml(k)}</div>
          <div class="value">${v}</div>
        </div>`
    )
    .join('');
  const link = `<div class="field">
    <div class="label">Unity Catalog</div>
    <div class="value"><a href="${escapeAttr(url)}" target="_blank" rel="noopener">Open ↗</a></div>
  </div>`;
  return `<div class="detail-title">${objectNameHtml(name, externalLink, 'detail-name')}</div>${rows}${link}`;
}

function objectNameHtml(name, link, className = '') {
  const text = escapeHtml(name);
  const cls = className ? ` class="${escapeAttr(className)}"` : '';
  if (!link) return `<span${cls}>${text}</span>`;
  return `<a${cls} href="${escapeAttr(link)}" target="_blank" rel="noopener">${text}</a>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Build groups for CSV / Excel / table-modal rendering. Each group represents
// one target object and the list of sources feeding it. Groups are ordered
// terminal-first (matching sortEdgesTerminalFirst); "final source tables"
// (nodes that never appear as a target — no upstream in the current subgraph)
// get their own group at the end with an empty source so they aren't lost.
function buildLineageGroups(nodes, edges) {
  const typeOf = new Map(nodes.map((n) => [n.id, n.type ?? '']));
  const sortedEdges = sortEdgesTerminalFirst(nodes, edges);
  const groups = [];
  const groupIndex = new Map();
  const keyOf = (target, targetType) => `${target}\t${targetType}`;
  const pushGroup = (target, targetType) => {
    const k = keyOf(target, targetType);
    if (groupIndex.has(k)) return groups[groupIndex.get(k)];
    const g = { target, targetType, sources: [] };
    groupIndex.set(k, groups.length);
    groups.push(g);
    return g;
  };
  const seenAsTarget = new Set();
  for (const e of sortedEdges) {
    const g = pushGroup(e.target, typeOf.get(e.target) ?? '');
    g.sources.push({ source: e.source, sourceType: typeOf.get(e.source) ?? '' });
    seenAsTarget.add(e.target);
  }
  for (const n of nodes) {
    if (seenAsTarget.has(n.id)) continue;
    pushGroup(n.id, typeOf.get(n.id) ?? '');
  }
  return { groups, typeOf };
}

function downloadLineageCsv(nodes, edges, scope) {
  const { groups } = buildLineageGroups(nodes, edges);
  const header = ['target', 'target_type', 'source', 'source_type'];
  const rows = [header];
  for (const g of groups) {
    if (g.sources.length === 0) {
      rows.push([g.target, g.targetType, '', '']);
      continue;
    }
    for (const s of g.sources) {
      rows.push([g.target, g.targetType, s.source, s.sourceType]);
    }
  }
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  // Excel-friendly: prepend UTF-8 BOM so non-ASCII names render correctly.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = lineageCsvFilename(scope);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Order edges so terminal (most-downstream) targets appear first, then walk
// back through their upstream sources level by level. Rank = distance from a
// terminal node, computed by reverse BFS on the visible subgraph only.
// Nodes inside cycles with no path to a terminal sort to the end.
function sortEdgesTerminalFirst(nodes, edges) {
  const outAdj = new Map();
  const inAdj = new Map();
  for (const e of edges) {
    if (!outAdj.has(e.source)) outAdj.set(e.source, new Set());
    outAdj.get(e.source).add(e.target);
    if (!inAdj.has(e.target)) inAdj.set(e.target, new Set());
    inAdj.get(e.target).add(e.source);
  }
  const rank = new Map();
  const queue = [];
  for (const n of nodes) {
    const outs = outAdj.get(n.id);
    if (!outs || outs.size === 0) {
      rank.set(n.id, 0);
      queue.push(n.id);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const preds = inAdj.get(cur);
    if (!preds) continue;
    for (const p of preds) {
      if (!rank.has(p)) {
        rank.set(p, rank.get(cur) + 1);
        queue.push(p);
      }
    }
  }
  const rankOf = (id) => (rank.has(id) ? rank.get(id) : Number.POSITIVE_INFINITY);
  return edges.slice().sort((a, b) => {
    const rt = rankOf(a.target) - rankOf(b.target);
    if (rt !== 0) return rt;
    const rs = rankOf(a.source) - rankOf(b.source);
    if (rs !== 0) return rs;
    if (a.target !== b.target) return a.target < b.target ? -1 : 1;
    return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
  });
}

// Render the same content as the CSV (sorted terminal-first) as an HTML
// table body. Rows are grouped by target+target_type using rowspan so each
// target appears once and lists all its sources beneath it.
function renderGroupedLineageRows(nodes, edges) {
  const { groups } = buildLineageGroups(nodes, edges);
  const out = [];
  for (const g of groups) {
    const rows = g.sources.length || 1;
    const targetCell = `<td rowspan="${rows}" class="cell-name">${escapeHtml(g.target)}</td>`;
    const targetTypeCell = `<td rowspan="${rows}">${escapeHtml(g.targetType || '—')}</td>`;
    if (g.sources.length === 0) {
      out.push(`<tr>${targetCell}${targetTypeCell}<td>—</td><td>—</td></tr>`);
      continue;
    }
    g.sources.forEach((s, i) => {
      const lead = i === 0 ? `${targetCell}${targetTypeCell}` : '';
      out.push(
        `<tr>${lead}<td class="cell-name">${escapeHtml(s.source)}</td><td>${escapeHtml(s.sourceType || '—')}</td></tr>`,
      );
    });
  }
  return out.join('');
}

function downloadLineageXlsx(nodes, edges, scope) {
  if (typeof window === 'undefined' || typeof window.XLSX === 'undefined') {
    throw new Error('XLSX library not loaded — check the network for the CDN script.');
  }
  const XLSX = window.XLSX;
  const { groups } = buildLineageGroups(nodes, edges);

  const aoa = [['Target', 'Target Type', 'Source', 'Source Type']];
  const merges = [];
  for (const g of groups) {
    const startRow = aoa.length;
    if (g.sources.length === 0) {
      aoa.push([g.target, g.targetType || '', '', '']);
      continue;
    }
    g.sources.forEach((s, i) => {
      if (i === 0) aoa.push([g.target, g.targetType || '', s.source, s.sourceType || '']);
      else aoa.push(['', '', s.source, s.sourceType || '']);
    });
    if (g.sources.length > 1) {
      const endRow = startRow + g.sources.length - 1;
      merges.push({ s: { r: startRow, c: 0 }, e: { r: endRow, c: 0 } }); // Target
      merges.push({ s: { r: startRow, c: 1 }, e: { r: endRow, c: 1 } }); // Target Type
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (merges.length) ws['!merges'] = merges;
  ws['!cols'] = [{ wch: 60 }, { wch: 18 }, { wch: 60 }, { wch: 18 }];
  ws['!autofilter'] = { ref: `A1:D${aoa.length}` };
  ws['!freeze'] = { ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Lineage');
  XLSX.writeFile(wb, lineageXlsxFilename(scope));
}

function lineageXlsxFilename(scope) {
  const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_');
  const parts = ['lineage'];
  const rootPart = scope.root && scope.root !== '(all)' ? safe(scope.root) : 'all';
  parts.push(rootPart);
  if (scope.direction && scope.direction !== 'all' && scope.direction !== 'both') {
    parts.push(scope.direction);
  }
  if (scope.depth !== '' && scope.depth != null) parts.push(`d${scope.depth}`);
  return `${parts.join('-')}.xlsx`;
}

function lineageTableTitle(scope) {
  const rootPart = scope.root && scope.root !== '(all)' ? scope.root : 'entire graph';
  const dir = scope.direction && scope.direction !== 'all' ? ` · ${scope.direction}` : '';
  const depth = scope.depth !== '' && scope.depth != null ? ` · depth ${scope.depth}` : '';
  return `Lineage table — ${rootPart}${dir}${depth}`;
}

function lineageCsvFilename(scope) {
  const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_');
  const parts = ['lineage'];
  const rootPart = scope.root && scope.root !== '(all)' ? safe(scope.root) : 'all';
  parts.push(rootPart);
  if (scope.direction && scope.direction !== 'all' && scope.direction !== 'both') {
    parts.push(scope.direction);
  }
  if (scope.depth !== '' && scope.depth != null) parts.push(`d${scope.depth}`);
  return `${parts.join('-')}.csv`;
}
