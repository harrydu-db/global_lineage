// Cytoscape.js implementation of the GraphRenderer contract.
//
// Loaded from CDN in index.html. Uses the dagre extension for a layered
// directed-acyclic layout — best for lineage. Other supported layouts
// fall through to Cytoscape's built-ins.

// Stable, distinct colors per known object_type. Anything unknown falls
// back to a rotating palette so future types still get something visible.
// Keys must match the friendly labels written by the lineage notebook
// into the `object_type` column (see notebook/Collect_Lineage.py).
const TYPE_COLORS = {
  'Table':             '#6fffb0',  // green
  'View':              '#9bdcff',  // blue
  'Materialized View': '#dcc4ff',  // purple
  'External Table':    '#ffe066',  // yellow
  'Streaming Table':   '#ffa8d8',  // pink
  'Foreign Table':     '#ffc8a8',  // orange
};

const TYPE_PALETTE = [
  '#b8e8ff', '#9cffc4', '#ffd699', '#ffbbbb', '#ebe0ff',
];

function colorForType(type, lookup) {
  if (!type) return '#e6edf3';
  if (type in TYPE_COLORS) return TYPE_COLORS[type];
  if (!(type in lookup)) {
    lookup[type] = TYPE_PALETTE[Object.keys(lookup).length % TYPE_PALETTE.length];
  }
  return lookup[type];
}

export function createCytoscapeRenderer() {
  if (typeof cytoscape === 'undefined') {
    throw new Error('cytoscape global missing — check the <script> tag in index.html');
  }
  // Register the dagre extension once.
  if (typeof cytoscapeDagre !== 'undefined' && !cytoscape.__dagreRegistered) {
    cytoscape.use(cytoscapeDagre);
    cytoscape.__dagreRegistered = true;
  }

  let cy = null;
  let typeColors = {};
  let currentLayout = 'dagre';
  let nodeClickCb = null;
  let nodeDoubleClickCb = null;
  let nodeHoverEnterCb = null;
  let nodeHoverLeaveCb = null;

  /** @type {import('./graph-renderer.js').GraphRenderer} */
  const renderer = {
    init(container) {
      typeColors = {};
      cy = cytoscape({
        container,
        wheelSensitivity: 0.2,
        // No drag-rect getting in the way.
        boxSelectionEnabled: false,
        // Performance flags — keep pan/zoom smooth on larger graphs.
        textureOnViewport: true,
        hideEdgesOnViewport: true,
        hideLabelsOnViewport: true,
        motionBlur: false,
        pixelRatio: 1,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': (ele) => colorForType(ele.data('type'), typeColors),
              'label': 'data(display)',         // wrapped label; `label` keeps the clean name for popover/click
              'color': '#ffffff',
              'font-size': 7,
              'font-weight': 500,
              'text-valign': 'bottom',
              'text-margin-y': 4,
              'text-wrap': 'wrap',
              'text-max-width': 260,
              'text-outline-width': 2,
              'text-outline-color': '#0a0e14',
              'width': 18,
              'height': 18,
              'border-width': 2,
              'border-color': '#f0f6fc',
              'border-opacity': 0.95,
              'overlay-opacity': 0,           // kill the dark "active" halo
              'overlay-padding': 0,
              'z-index': 10,                  // paint nodes above edges/arrows
            },
          },
          {
            selector: 'node.highlighted',
            style: {
              'background-color': '#f0883e',
              'border-color': '#fff',
              'border-width': 2.5,
              'width': 22,
              'height': 22,
              'z-index': 99,
            },
          },
          {
            selector: 'node.dimmed',
            style: { 'opacity': 0.48 },
          },
          {
            selector: 'edge',
            style: {
              'width': 3.5,
              'line-color': '#f0f3f6',
              'target-arrow-color': '#f0f3f6',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'arrow-scale': 1.35,
              // Keep arrows away from the node body so high-degree nodes
              // (lots of incoming edges) aren't obscured by stacked arrowheads.
              'target-distance-from-node': 4,
              'source-distance-from-node': 2,
              'opacity': 1,
              'overlay-opacity': 0,
              'overlay-padding': 0,
              'z-index': 1,
            },
          },
          {
            selector: 'edge.dimmed',
            style: { 'opacity': 0.32 },
          },
          // Kill Cytoscape's default :active overlay (the dark halo that
          // appears while the mouse button is held down). The base
          // `node`/`edge` selectors don't override it because :active is
          // a more specific selector.
          {
            selector: 'node:active',
            style: { 'overlay-opacity': 0, 'overlay-padding': 0 },
          },
          {
            selector: 'edge:active',
            style: { 'overlay-opacity': 0, 'overlay-padding': 0 },
          },
        ],
      });

      const toPayload = (n) => ({
        id: n.id(),
        label: n.data('label'),
        type: n.data('type'),
        data: n.data('meta') || {},
      });

      cy.on('tap', 'node', (evt) => {
        if (nodeClickCb) nodeClickCb(toPayload(evt.target));
      });
      cy.on('tap', (evt) => {
        if (evt.target === cy && nodeClickCb) nodeClickCb(null);
      });

      // Cytoscape v3 doesn't dispatch DOM `dblclick` through its own event
      // system, so attach it natively to the container and locate the node
      // under the cursor via rendered bounding boxes.
      container.addEventListener('dblclick', (domEvt) => {
        if (!nodeDoubleClickCb || !cy) return;
        const rect = container.getBoundingClientRect();
        const x = domEvt.clientX - rect.left;
        const y = domEvt.clientY - rect.top;
        let hit = null;
        cy.nodes().forEach((n) => {
          if (hit) return;
          const bb = n.renderedBoundingBox();
          if (x >= bb.x1 && x <= bb.x2 && y >= bb.y1 && y <= bb.y2) hit = n;
        });
        if (hit) nodeDoubleClickCb(toPayload(hit));
      });
      cy.on('mouseover', 'node', (evt) => {
        if (nodeHoverEnterCb) nodeHoverEnterCb(toPayload(evt.target), evt.originalEvent);
      });
      cy.on('mouseout', 'node', () => {
        if (nodeHoverLeaveCb) nodeHoverLeaveCb();
      });
    },

    render(nodes, edges) {
      if (!cy) throw new Error('init() must be called first');
      typeColors = {};
      // "Dense" triggers the cheaper layout fallback. Dagre on >500
      // nodes can freeze the browser for many seconds; concentric is
      // O(n) and finishes in milliseconds.
      const dense = nodes.length > 500 || edges.length > 1500;

      const elements = [];
      for (const n of nodes) {
        const cleanLabel = String(n.label ?? n.id ?? '');
        elements.push({
          data: {
            id: n.id,
            label: cleanLabel,            // unchanged — used by popover/details
            display: wrapForCanvas(cleanLabel),
            type: n.type || null,
            meta: n.data || {},
          },
        });
      }
      for (const e of edges) {
        elements.push({
          data: {
            id: `${e.source}->${e.target}`,
            source: e.source,
            target: e.target,
          },
        });
      }
      cy.batch(() => {
        cy.elements().remove();
        cy.add(elements);
      });
      cy.layout(layoutOpts(currentLayout, dense)).run();
    },

    onNodeClick(cb) { nodeClickCb = cb; },

    onNodeDoubleClick(cb) { nodeDoubleClickCb = cb; },

    onNodeHover(enter, leave) {
      nodeHoverEnterCb = enter || null;
      nodeHoverLeaveCb = leave || null;
    },

    setLayout(name) {
      currentLayout = name;
      if (cy) cy.layout(layoutOpts(name)).run();
    },

    highlight(query) {
      if (!cy) return;
      const q = (query || '').toLowerCase().trim();
      cy.batch(() => {
        cy.elements().removeClass('highlighted dimmed');
        if (!q) return;
        const matches = cy.nodes().filter((n) =>
          String(n.data('label') || '').toLowerCase().includes(q)
        );
        if (matches.length === 0) return;
        const keep = matches.union(matches.neighborhood());
        cy.elements().difference(keep).addClass('dimmed');
        matches.addClass('highlighted');
      });
    },

    fit() { if (cy) cy.fit(undefined, 40); },

    destroy() {
      if (cy) {
        try { cy.destroy(); } catch (_) { /* ignore */ }
        cy = null;
      }
      nodeClickCb = null;
      nodeDoubleClickCb = null;
      nodeHoverEnterCb = null;
      nodeHoverLeaveCb = null;
    },
  };

  return renderer;
}

// Cytoscape `text-wrap: wrap` only breaks on whitespace or explicit
// newlines, but our names look like `catalog.schema.table` with no
// whitespace. Insert newlines after the dots so each segment renders
// on its own line and the full name is visible.
function wrapForCanvas(name) {
  return name.split('.').join('.\n');
}

function layoutOpts(name, dense = false) {
  // For dense graphs, avoid expensive layouts (dagre, cose) — they can
  // freeze the browser for tens of seconds.
  const effective = dense && (name === 'dagre' || name === 'cose') ? 'concentric' : name;
  switch (effective) {
    case 'dagre':
      return {
        name: 'dagre',
        rankDir: 'LR',
        nodeSep: 30,
        rankSep: 80,
        animate: false,
        fit: true,
        padding: 30,
      };
    case 'breadthfirst':
      return { name: 'breadthfirst', directed: true, padding: 30, spacingFactor: 1.25, animate: false };
    case 'cose':
      return { name: 'cose', animate: false, padding: 30, nodeRepulsion: 8000 };
    case 'grid':
      return { name: 'grid', padding: 20, animate: false };
    case 'circle':
      return { name: 'circle', padding: 20, animate: false };
    case 'concentric':
      return { name: 'concentric', padding: 20, animate: false, minNodeSpacing: 18 };
    default:
      return { name: 'concentric', padding: 20, animate: false };
  }
}
