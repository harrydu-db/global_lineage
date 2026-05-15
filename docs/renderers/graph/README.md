# renderers/graph/

Pluggable graph renderers. Pages import a **factory** that returns an
opaque `GraphRenderer`, defined in [`graph-renderer.js`](./graph-renderer.js).

| File | Purpose |
|---|---|
| `graph-renderer.js` | The JSDoc contract every implementation must satisfy. Pages import the typedef + `SUPPORTED_LAYOUTS` constant from here. |
| `cytoscape-renderer.js` | Default implementation backed by Cytoscape.js + the dagre layout extension. |

## Swapping

To use a different library:

1. Write a new file (e.g. `vis-network-renderer.js`) exporting a
   factory `createXxxRenderer()` that returns a `GraphRenderer`.
2. Change the import alias in `pages/lineage.js`:
   ```js
   import { createXxxRenderer as createGraphRenderer } from '/renderers/graph/xxx-renderer.js';
   ```

Full worked examples in [../../../docs/SWITCHING_VIZ.md](../../../docs/SWITCHING_VIZ.md).
