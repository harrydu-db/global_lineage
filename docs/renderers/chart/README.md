# renderers/chart/

Pluggable chart renderers. Pages import a **factory** that returns an
opaque `ChartRenderer`, defined in [`chart-renderer.js`](./chart-renderer.js).

| File | Purpose |
|---|---|
| `chart-renderer.js` | The JSDoc contract every implementation must satisfy. |
| `chartjs-renderer.js` | Default implementation backed by Chart.js. |

## Swapping

To use a different library:

1. Write a new file (e.g. `echarts-renderer.js`) exporting a factory
   `createEChartsRenderer()` that returns a `ChartRenderer`.
2. Change the import alias in `pages/statistics.js`:
   ```js
   import { createEChartsRenderer as createChartRenderer } from '/renderers/chart/echarts-renderer.js';
   ```

Full worked examples in [../../../docs/SWITCHING_VIZ.md](../../../docs/SWITCHING_VIZ.md).
