# Global Lineage

A small **browser-only** app for exploring **data object lineage** as an interactive graph and simple statistics. It reads Unity Catalog–style lineage from JSON (no server-side API): edges mean “this object depends on these upstream tables/views.”

## What it does

- **Lineage** — Search or browse by catalog → schema → table, pick a **root object**, and render the **subgraph** reachable from it (downstream, upstream, or both). Large datasets are meant to be viewed **from a root**, not all at once.
- **Statistics** — Summary counts plus charts: objects by type, by catalog (top 20), and top objects by downstream fan-out.
- **Upload JSON** — Replace the loaded dataset from the header without editing files (same JSON shape as the sample).

Visualization uses **Cytoscape.js** (with **dagre** layout) for the graph and **Chart.js** for the statistics page. Scripts load from a CDN; you need network access when opening the app.

## Quick start

The app lives under `docs/`. Assets use **relative** URLs and `import.meta.url` for the default JSON so the same build works when served as the site root (local dev) or under a **GitHub Pages project path** (e.g. `https://harrydu-db.github.io/global_lineage/`).

From the repository root:

```bash
python3 -m http.server 8080 --directory docs
```

Then open [http://localhost:8080/](http://localhost:8080/).

**GitHub Pages:** set the site to publish from the `/docs` folder on your default branch (or deploy the contents of `docs/` to `gh-pages`). Open the site at `https://<user>.github.io/<repo>/` (not the bare domain unless this is a user/org site repo).

Alternatives:

```bash
npx --yes serve docs -p 8080
```

There is no `package.json` in this repo; any static file server is fine.

## Lineage JSON format

The loader accepts either:

1. **Preferred** — An object with an optional base URL for “open in catalog” links and a `lineage` array:

```json
{
  "catalogExploreBaseUrl": "https://your-workspace.cloud.databricks.com/explore/data/your_catalog/",
  "lineage": [
    {
      "object_full_name": "catalog.schema.table_or_view",
      "object_type": "TABLE",
      "upstream_objects": ["catalog.schema.parent_a", "catalog.schema.parent_b"]
    }
  ]
}
```

2. **Legacy** — A top-level JSON array of the same row objects (no `catalogExploreBaseUrl`).

**Semantics**

- **`object_full_name`** — Full name, typically `catalog.schema.name` (the table segment may contain dots).
- **`upstream_objects`** — Names of **upstream** dependencies. The app builds directed edges **source → target** where **source** is upstream and **target** is the row’s `object_full_name` (the dependent).
- **`object_type`** — Optional string (e.g. `TABLE`, `VIEW`); used in the UI and stats.
- **`catalogExploreBaseUrl`** — Optional. When set, node details and popovers can link into the workspace **Data** explorer for that object. If omitted, the code still builds a sensible explore URL for common Databricks host patterns (see `buildExploreUrl` in `docs/lib/unified-lineage-store.js`).

Bundled examples:

- `docs/lineage_sample.json` — Small demo graph (default fetch URL).
- `docs/unified_lineage.json` — Larger file for stress-testing; use **Upload JSON** or change the default URL in code (see below).

## Using the UI

### Navigation

- Routes use the URL hash: `#/lineage` and `#/statistics`.
- The first page is **Lineage** if you open the site without a hash.

### Lineage page

1. **Object** — Type in the search box (substring match on `object_full_name`) or use **Catalog / Schema / Table** dropdowns. Press **Enter** or confirm your choice to load the graph.
2. **(all)** — If you pick the sentinel “all” option in search, the app loads **every** node and edge. That is only appropriate for smaller exports; very large graphs may be slow or hard to use.
3. **Direction** — **Downstream** (dependents), **Upstream** (sources), or **Both** (all nodes connected to the root through either direction).
4. **Depth** — Limit hops from the root, or **∞** for no limit (within the chosen direction).
5. **Layout** — Choose among layouts supported by the graph renderer (see `docs/renderers/graph/`).
6. **Fit** — Re-fit the graph to the viewport.

**Graph interactions**

- **Click** a node — Details in the side panel (type, upstream/downstream lists, explore link when available).
- **Double-click** a node — Make it the new root and reload the subgraph.
- **Hover** a node — Quick popover; you can move the pointer into the popover to use links.

### Statistics page

Read-only cards driven by the **currently loaded** lineage store (same data as the Lineage page). After **Upload JSON**, navigate away and back or rely on remount to refresh if you change data mid-session.

### Upload JSON (header)

**Upload JSON** parses your file in the browser and replaces the in-memory store. The page reloads the current route so the new data appears immediately. To go back to the default sample file behavior after an upload, reload the whole browser tab (or extend the app to call a “reset to default” path if you add one).

### Changing the default file on first load

By default the app fetches `lineage_sample.json` next to `index.html`, resolved via `new URL('../lineage_sample.json', import.meta.url)` in `docs/lib/unified-lineage-store.js`. To use another bundled file (e.g. `unified_lineage.json`), change that `URL` first argument to `'../unified_lineage.json'`.

## Project layout

| Path | Role |
|------|------|
| `docs/index.html` | Shell: nav, upload control, page root, CDN scripts |
| `docs/app.js` | Hash router and page registry |
| `docs/api/client.js` | Thin `api` facade over the lineage store (search, subgraph, stats, upload) |
| `docs/lib/unified-lineage-store.js` | Fetch/parse JSON, graph adjacency, stats, explore URLs |
| `docs/pages/lineage.js` | Lineage UI + graph renderer wiring |
| `docs/pages/statistics.js` | Statistics UI + chart renderer wiring |
| `docs/renderers/graph/` | Graph renderer abstraction and Cytoscape implementation |
| `docs/renderers/chart/` | Chart renderer abstraction and Chart.js implementation |
| `docs/styles.css` | App styles |

Developer notes for adding pages or swapping visualization libraries are in `docs/pages/README.md` and the `docs/renderers/*/README.md` files.
