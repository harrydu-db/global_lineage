// Chart renderer contract. Mirrors the GraphRenderer pattern: pages
// import a factory and treat the result as an opaque ChartRenderer, so
// swapping the chart library means writing a sibling file and changing
// one import line. See docs/SWITCHING_VIZ.md.

/**
 * @typedef {Object} CategoricalDatum
 * @property {string} label
 * @property {number} count
 */

/**
 * @typedef {'pie'|'doughnut'|'bar'|'horizontalBar'} ChartKind
 */

/**
 * @typedef {Object} ChartRenderer
 * @property {(container: HTMLElement) => void} init
 *           Mount into the container. Container should be the
 *           direct parent that should hold the canvas.
 *
 * @property {(kind: ChartKind, data: CategoricalDatum[], opts?: { onSegmentClick?: (d: CategoricalDatum & { index: number }) => void }) => void} render
 *           Draw a chart of the given kind from categorical data.
 *           `opts` is impl-specific (e.g. {title, valueKey, onSegmentClick}).
 *
 * @property {() => void} destroy
 */
