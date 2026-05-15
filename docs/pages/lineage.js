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

import { api } from '/api/client.js';
import { getUnifiedLineageStore } from '/lib/unified-lineage-store.js';
import { createCytoscapeRenderer as createGraphRenderer } from '/renderers/graph/cytoscape-renderer.js';
import { SUPPORTED_LAYOUTS } from '/renderers/graph/graph-renderer.js';

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

        <label for="layout">Layout</label>
        <select id="layout">
          ${SUPPORTED_LAYOUTS.map((l) =>
            `<option value="${l}"${l === DEFAULT_LAYOUT ? ' selected' : ''}>${l}</option>`
          ).join('')}
        </select>

        <button id="fit" class="secondary">Fit</button>
        <span id="status" class="status">Pick a root object to view its lineage.</span>
      </div>
      <div class="lineage-body">
        <div class="graph-host">
          <div id="graph" class="graph-canvas"></div>
          <div id="node-popover" class="node-popover" role="tooltip" hidden></div>
        </div>
        <aside class="side-panel" id="side-panel">
          <div class="empty-state">
            <p>No graph loaded yet.</p>
            <p>Type a table name in the search box above and press <kbd>Enter</kbd> or click <strong>Load</strong>.</p>
          </div>
        </aside>
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
    const layoutEl = root.querySelector('#layout');
    const fitBtn = root.querySelector('#fit');
    const sideEl = root.querySelector('#side-panel');

    const renderer = createGraphRenderer();
    renderer.init(graphHost);

    renderer.onNodeClick((node) => {
      if (!node) {
        sideEl.innerHTML = emptyPanel();
        return;
      }
      sideEl.innerHTML = renderNodeDetails(node, exploreUrlFor);
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
      if (v && v !== lastLoadedRoot) load();
    });

    primeDatalist();

    async function load() {
      const rootName = rootInputEl.value.trim();
      if (!rootName) {
        statusEl.textContent = 'Enter a root object first.';
        statusEl.classList.add('error');
        return;
      }
      // Claim this root immediately so overlapping auto-load triggers
      // (input → refreshDatalist + change) coalesce into one request.
      lastLoadedRoot = rootName;
      statusEl.classList.remove('error');
      statusEl.textContent = `loading lineage from ${rootName}…`;

      try {
        const depth = depthEl.value ? Number(depthEl.value) : null;
        const direction = directionEl.value;
        const isAll = rootName === ALL_SENTINEL;
        const t0 = performance.now();
        const result = isAll
          ? await api.lineageAll()
          : await api.lineageFrom(rootName, { direction, depth });
        const fetchedAt = performance.now();
        const { nodes, edges } = result;

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
          sideEl.innerHTML = renderNodeDetails(
            {
              id: rootName,
              label: rootName,
              type: null,
              data: {},
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
    // Direction / depth changes re-trigger load if a root is already loaded.
    directionEl.addEventListener('change', () => {
      if (lastLoadedRoot) { lastLoadedRoot = null; load(); }
    });
    depthEl.addEventListener('change', () => {
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
      renderer.destroy();
    };
  },
};

function renderPopover(node, exploreUrlFor) {
  const name = node.label || node.id;
  const url = exploreUrlFor(name);
  const rows = [['Type', node.type || '—']]
    .map(
      ([k, v]) => `<div class="row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`
    )
    .join('');
  const link = `<div class="row"><span class="k">Catalog</span><span class="v"><a href="${escapeAttr(url)}" target="_blank" rel="noopener">Open in Unity Catalog ↗</a></span></div>`;
  return `<div class="title">${escapeHtml(name)}</div>${rows}${link}`;
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

function renderNodeDetails(node, exploreUrlFor) {
  const name = node.label || node.id;
  const url = exploreUrlFor(name);
  const fields = [
    ['Object', name],
    ['Type', node.type || '—'],
  ];
  const rows = fields
    .map(
      ([k, v]) => `
        <div class="field">
          <div class="label">${escapeHtml(k)}</div>
          <div class="value">${escapeHtml(v)}</div>
        </div>`
    )
    .join('');
  const link = `<div class="field">
    <div class="label">Unity Catalog</div>
    <div class="value"><a href="${escapeAttr(url)}" target="_blank" rel="noopener">Open ↗</a></div>
  </div>`;
  return `<h2>Details</h2>${rows}${link}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
