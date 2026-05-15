// Graph renderer contract.
//
// Pages import a factory like `createCytoscapeRenderer` and treat it as
// an opaque `GraphRenderer` instance. To swap visualization libraries,
// implement this same shape in a sibling file and change one import line
// in the page. See docs/SWITCHING_VIZ.md.
//
// All methods return synchronously unless noted; impls should not throw
// for empty inputs (just render an empty canvas).

/**
 * @typedef {Object} GraphNode
 * @property {string} id           Stable unique identifier.
 * @property {string} label        Display label.
 * @property {string|null} [type]  Category used for coloring/grouping.
 * @property {Object} [data]       Free-form metadata returned to onNodeClick.
 */

/**
 * @typedef {Object} GraphEdge
 * @property {string} source
 * @property {string} target
 */

/**
 * @typedef {'dagre'|'breadthfirst'|'cose'|'grid'|'circle'|'concentric'} GraphLayoutName
 */

/**
 * @typedef {Object} GraphRenderer
 * @property {(container: HTMLElement) => void} init
 *           Mount into a container. Must be called before render.
 *
 * @property {(nodes: GraphNode[], edges: GraphEdge[]) => void} render
 *           Draw the given graph. Called once or many times.
 *
 * @property {(cb: ((node: GraphNode|null) => void)) => void} onNodeClick
 *           Register a callback fired when the user clicks a node, or
 *           clicks empty space (in which case the callback is invoked
 *           with `null` to clear any selection UI).
 *
 * @property {(cb: ((node: GraphNode) => void)) => void} onNodeDoubleClick
 *           Register a callback fired when the user double-clicks a node.
 *
 * @property {(enter: ((node: GraphNode, event: MouseEvent) => void), leave: (() => void)) => void} onNodeHover
 *           Register hover callbacks. `enter` fires on mouseover with the
 *           hovered node and the underlying MouseEvent (so callers can
 *           position floating UI). `leave` fires on mouseout.
 *
 * @property {(layout: GraphLayoutName) => void} setLayout
 *           Switch to a named layout and re-run it on the current graph.
 *
 * @property {(query: string) => void} highlight
 *           Highlight nodes whose label contains the query (case-insensitive).
 *           Empty string clears the highlight.
 *
 * @property {() => void} fit
 *           Reset zoom/pan to fit the whole graph.
 *
 * @property {() => void} destroy
 *           Tear down. After calling, the instance must not be reused.
 */

export const SUPPORTED_LAYOUTS = ['dagre', 'breadthfirst', 'cose', 'grid', 'circle', 'concentric'];
