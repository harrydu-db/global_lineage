/**
 * Loads lineage JSON (default: /lineage_sample.json) and exposes graph + stats helpers.
 * Edge direction: source = upstream table/view, target = dependent object.
 */

/** Resolved against this module so fetches work on GitHub Pages (`/repo/`) and local static servers. */
export const DEFAULT_LINEAGE_JSON_URL = new URL('../lineage_sample.json', import.meta.url).href;

/** Manifest listing the JSON files dropped into docs/input/. Static hosting can't list directories, so the file lives in the repo. */
export const INPUT_MANIFEST_URL = new URL('../input/index.json', import.meta.url).href;

/** Resolve a filename inside docs/input/ to an absolute URL. */
export function inputLineageUrl(filename) {
  return new URL(`../input/${filename}`, import.meta.url).href;
}

/**
 * Fetch the input/ manifest. Returns `{ files: string[] }`. Missing or
 * malformed manifest is treated as empty so the caller can fall back to the
 * bundled sample.
 */
export async function listInputLineageFiles() {
  try {
    const res = await fetch(INPUT_MANIFEST_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { files: [] };
    const body = await res.json();
    const raw = Array.isArray(body) ? body : Array.isArray(body?.files) ? body.files : [];
    const files = raw
      .map((f) => String(f || '').trim())
      .filter((f) => f && f.toLowerCase().endsWith('.json'));
    return { files };
  } catch (_) {
    return { files: [] };
  }
}

/** @typedef {{ object_full_name: string, object_type?: string|null, upstream_objects?: string[] }} UnifiedRow */

let loadPromise = null;
/** URL used for the last fetch-based load; empty after an in-memory upload until reset. */
let activeFetchUrl = DEFAULT_LINEAGE_JSON_URL;

/**
 * @param {string} objectFullName `catalog.schema.table` (table segment may contain dots)
 * @param {string} catalogExploreBaseUrl e.g. `https://host/explore/data/edsp_odp_unified/`
 */
export function buildExploreUrl(objectFullName, catalogExploreBaseUrl) {
  const baseStr = String(catalogExploreBaseUrl || '').trim();
  const enc = (s) => encodeURIComponent(s);
  const segments = String(objectFullName).split('.');
  if (segments.length < 3) {
    return baseStr ? baseStr.replace(/\/?$/, '/') : '/';
  }
  const [cat, sch, ...tblParts] = segments;
  const tbl = tblParts.join('.');
  if (!baseStr) {
    const path = segments.map(enc).join('/');
    return `https://nvidia-odp-or1.cloud.databricks.com/explore/data/${path}`;
  }
  let u;
  try {
    u = new URL(baseStr);
  } catch {
    return `${baseStr.replace(/\/?$/, '/')}${segments.map(enc).join('/')}`;
  }
  const pathNoTrail = u.pathname.replace(/\/+$/, '');
  const m = pathNoTrail.match(/^(\/explore\/data)\/([^/]+)$/);
  if (!m) {
    return `${u.origin}${pathNoTrail}/${segments.map(enc).join('/')}`;
  }
  const dataRoot = `${u.origin}${m[1]}`;
  const baseCatalog = m[2];
  if (cat === baseCatalog) {
    return `${u.origin}${pathNoTrail}/${enc(sch)}/${enc(tbl)}`;
  }
  return `${dataRoot}/${enc(cat)}/${enc(sch)}/${enc(tbl)}`;
}

function addToAdj(adj, from, to) {
  if (!adj.has(from)) adj.set(from, new Set());
  adj.get(from).add(to);
}

/**
 * @param {unknown} body
 * @returns {{ rows: UnifiedRow[], catalogExploreBaseUrl: string }}
 */
export function parseLineageBody(body) {
  let rows;
  let catalogExploreBaseUrl = '';
  if (Array.isArray(body)) {
    rows = body;
  } else if (body && typeof body === 'object' && Array.isArray(body.lineage)) {
    rows = body.lineage;
    catalogExploreBaseUrl = String(body.catalogExploreBaseUrl || '').trim();
  } else {
    throw new Error(
      'Lineage JSON must be { catalogExploreBaseUrl?, lineage: [...] } or a legacy top-level array',
    );
  }
  return { rows, catalogExploreBaseUrl };
}

/**
 * @param {UnifiedRow[]} rows
 * @param {string} catalogExploreBaseUrl
 */
function buildStore(rows, catalogExploreBaseUrl) {
  const edgeKey = new Set();
  /** @type {{ source: string, target: string }[]} */
  const allEdges = [];
  /** @type {Map<string, string|null>} */
  const objectTypes = new Map();
  /** @type {Map<string, Set<string>>} */
  const downstream = new Map();
  /** @type {Map<string, Set<string>>} */
  const upstream = new Map();

  const allNames = new Set();

  for (const row of rows) {
    if (!row || !row.object_full_name) continue;
    const target = row.object_full_name;
    allNames.add(target);
    objectTypes.set(target, row.object_type ?? null);
    const ups = Array.isArray(row.upstream_objects) ? row.upstream_objects : [];
    for (const source of ups) {
      if (!source) continue;
      const k = `${source}\t${target}`;
      if (edgeKey.has(k)) continue;
      edgeKey.add(k);
      allEdges.push({ source, target });
      addToAdj(downstream, source, target);
      addToAdj(upstream, target, source);
    }
  }

  for (const e of allEdges) {
    allNames.add(e.source);
    allNames.add(e.target);
  }

  const sortedNames = [...allNames].sort();

  const isTable = (id) => {
    const t = objectTypes.get(id);
    return typeof t === 'string' && t.toLowerCase() === 'table';
  };

  /**
   * @param {string} root
   * @param {'down'|'up'|'both'} direction
   * @param {number|null|undefined} maxDepth hops from root; null = unlimited
   * @param {{ stopAtTable?: boolean }} [opts] when stopAtTable is set, upstream
   *   traversal includes any TABLE node it reaches but does not walk further
   *   through it (the root is always allowed to expand).
   */
  function collectNodeIds(root, direction, maxDepth, opts = {}) {
    const stopAtTable = !!opts.stopAtTable;
    const out = new Set();
    if (!root) return out;
    out.add(root);

    function bfs(adjGetter, applyStop) {
      const queue = [[root, 0]];
      let i = 0;
      while (i < queue.length) {
        const [n, dist] = queue[i++];
        if (maxDepth != null && maxDepth !== '' && dist >= maxDepth) continue;
        if (applyStop && n !== root && isTable(n)) continue;
        const nexts = adjGetter(n) || [];
        for (const w of nexts) {
          if (!out.has(w)) {
            out.add(w);
            queue.push([w, dist + 1]);
          }
        }
      }
    }

    if (direction === 'down' || direction === 'both') {
      bfs((n) => [...(downstream.get(n) || [])], false);
    }
    if (direction === 'up' || direction === 'both') {
      bfs((n) => [...(upstream.get(n) || [])], stopAtTable);
    }
    return out;
  }

  function toGraphNodes(ids) {
    return [...ids].sort().map((id) => ({
      id,
      label: id,
      type: objectTypes.get(id) ?? null,
      data: {},
    }));
  }

  function subgraphFor(root, direction, maxDepth, opts = {}) {
    const ids = collectNodeIds(root, direction, maxDepth, opts);
    const edgeSet = new Set();
    const edges = [];
    for (const e of allEdges) {
      if (ids.has(e.source) && ids.has(e.target)) {
        const ek = `${e.source}->${e.target}`;
        if (edgeSet.has(ek)) continue;
        edgeSet.add(ek);
        edges.push({ source: e.source, target: e.target });
      }
    }
    return { nodes: toGraphNodes(ids), edges };
  }

  function lineageAll() {
    return {
      nodes: toGraphNodes(allNames),
      edges: allEdges.map((e) => ({ source: e.source, target: e.target })),
    };
  }

  /** Direct downstream count: distinct dependents (edges where this node is upstream). */
  function downstreamCounts() {
    const counts = new Map();
    for (const n of allNames) {
      counts.set(n, (downstream.get(n) || new Set()).size);
    }
    return counts;
  }

  const downstreamCountMap = downstreamCounts();

  /**
   * Longest-path depth (count of edges) from each node, following `adjMap`,
   * and the next hop along that path so callers can reconstruct it.
   * Iterative DFS with memoization; cycle edges are treated as length 0 so
   * a back edge into the current stack does not cause infinite recursion.
   * @param {Map<string, Set<string>>} adjMap
   * @returns {{ depth: Map<string, number>, nextHop: Map<string, string> }}
   */
  function computeLongestDepths(adjMap) {
    const depth = new Map();
    const nextHop = new Map();
    const STATE_OPEN = 1;
    const STATE_DONE = 2;
    const state = new Map();
    for (const n of sortedNames) {
      if (state.get(n) === STATE_DONE) continue;
      const stack = [{ node: n, neighbors: [...(adjMap.get(n) || [])], idx: 0, best: 0, bestNext: null }];
      state.set(n, STATE_OPEN);
      while (stack.length) {
        const frame = stack[stack.length - 1];
        if (frame.idx >= frame.neighbors.length) {
          depth.set(frame.node, frame.best);
          if (frame.bestNext != null) nextHop.set(frame.node, frame.bestNext);
          state.set(frame.node, STATE_DONE);
          stack.pop();
          if (stack.length) {
            const parent = stack[stack.length - 1];
            const candidate = 1 + frame.best;
            if (candidate > parent.best) {
              parent.best = candidate;
              parent.bestNext = frame.node;
            }
          }
          continue;
        }
        const w = frame.neighbors[frame.idx++];
        const s = state.get(w);
        if (s === STATE_DONE) {
          const candidate = 1 + (depth.get(w) || 0);
          if (candidate > frame.best) {
            frame.best = candidate;
            frame.bestNext = w;
          }
        } else if (s === STATE_OPEN) {
          // cycle — skip this edge
        } else {
          state.set(w, STATE_OPEN);
          stack.push({ node: w, neighbors: [...(adjMap.get(w) || [])], idx: 0, best: 0, bestNext: null });
        }
      }
    }
    return { depth, nextHop };
  }

  const { depth: longestUpstreamDepthMap, nextHop: longestUpstreamNextMap } = computeLongestDepths(upstream);
  const { depth: longestDownstreamDepthMap, nextHop: longestDownstreamNextMap } = computeLongestDepths(downstream);

  /** Reconstruct the longest path starting at `start` by following the nextHop chain. */
  function reconstructPath(start, nextHop) {
    if (!start) return [];
    const path = [start];
    const seen = new Set([start]);
    let cur = nextHop.get(start);
    while (cur && !seen.has(cur)) {
      path.push(cur);
      seen.add(cur);
      cur = nextHop.get(cur);
    }
    return path;
  }

  function statsSummary() {
    const typeLabels = new Set();
    for (const n of allNames) typeLabels.add(objectTypes.get(n) ?? 'Unknown');
    const catalogs = new Set();
    for (const n of allNames) {
      const c = n.split('.')[0];
      if (c) catalogs.add(c);
    }
    return {
      total_objects: allNames.size,
      total_edges: allEdges.length,
      distinct_types: typeLabels.size,
      distinct_pipelines: catalogs.size,
    };
  }

  function statsByObjectType() {
    const m = new Map();
    for (const n of allNames) {
      const t = objectTypes.get(n) ?? 'Unknown';
      m.set(t, (m.get(t) || 0) + 1);
    }
    return [...m.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }

  function statsByPipeline(limit) {
    const m = new Map();
    for (const n of allNames) {
      const cat = n.split('.')[0] || '—';
      m.set(cat, (m.get(cat) || 0) + 1);
    }
    return [...m.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  function statsTopDownstream(n) {
    return [...downstreamCountMap.entries()]
      .map(([object_full_name, downstream_count]) => ({ object_full_name, downstream_count }))
      .sort((a, b) => b.downstream_count - a.downstream_count)
      .slice(0, n);
  }

  function parseNameParts(fullName) {
    const segments = String(fullName || '').split('.');
    const catalog = segments[0] || '—';
    const schema = segments.length >= 3 ? segments[1] : '—';
    return { catalog, schema };
  }

  /**
   * Rows for the statistics table. Filters are combined with AND when multiple are set.
   * @param {{ object_type?: string|null, catalog?: string|null, schema?: string|null, object_full_name?: string|null }} filter
   * @returns {{ object_full_name: string, object_type: string|null, catalog: string, schema: string, downstream_count: number, downstream_objects: string[], upstream_count: number, upstream_objects: string[], longest_upstream_depth: number, longest_downstream_depth: number, longest_upstream_path: string[], longest_downstream_path: string[] }[]}
   */
  function listObjectsForStats(filter = {}) {
    const typeEq = filter.object_type != null && filter.object_type !== '' ? String(filter.object_type) : null;
    const catEq = filter.catalog != null && filter.catalog !== '' ? String(filter.catalog) : null;
    const schemaEq = filter.schema != null && filter.schema !== '' ? String(filter.schema) : null;
    const nameEq = filter.object_full_name != null && filter.object_full_name !== ''
      ? String(filter.object_full_name)
      : null;

    let names = sortedNames;
    if (nameEq) {
      names = names.filter((n) => n === nameEq);
    } else {
      if (typeEq) {
        names = names.filter((n) => (objectTypes.get(n) ?? 'Unknown') === typeEq);
      }
      if (catEq) {
        names = names.filter((n) => (n.split('.')[0] || '—') === catEq);
      }
      if (schemaEq) {
        names = names.filter((n) => {
          const { schema } = parseNameParts(n);
          return schema === schemaEq;
        });
      }
    }

    return names.map((object_full_name) => {
      const { catalog, schema } = parseNameParts(object_full_name);
      const upstream_objects = [...(upstream.get(object_full_name) || [])].sort();
      const downstream_objects = [...(downstream.get(object_full_name) || [])].sort();
      return {
        object_full_name,
        object_type: objectTypes.get(object_full_name) ?? null,
        catalog,
        schema,
        downstream_count: downstreamCountMap.get(object_full_name) || 0,
        downstream_objects,
        upstream_count: upstream_objects.length,
        upstream_objects,
        longest_upstream_depth: longestUpstreamDepthMap.get(object_full_name) || 0,
        longest_downstream_depth: longestDownstreamDepthMap.get(object_full_name) || 0,
        longest_upstream_path: reconstructPath(object_full_name, longestUpstreamNextMap),
        longest_downstream_path: reconstructPath(object_full_name, longestDownstreamNextMap),
      };
    });
  }

  function searchObjects(q, limit) {
    const qq = String(q || '').trim().toLowerCase();
    let list = sortedNames;
    if (qq) list = sortedNames.filter((name) => name.toLowerCase().includes(qq));
    if (limit > 0) list = list.slice(0, limit);
    return list;
  }

  function objectDetail(fullName) {
    return {
      object_full_name: fullName,
      object_type: objectTypes.get(fullName) ?? null,
      upstream_objects: [...(upstream.get(fullName) || [])].sort(),
      downstream_objects: [...(downstream.get(fullName) || [])].sort(),
    };
  }

  function exploreUrlFor(fullName) {
    return buildExploreUrl(fullName, catalogExploreBaseUrl);
  }

  return {
    allNames: sortedNames,
    searchObjects,
    subgraphFor,
    lineageAll,
    statsSummary,
    statsByObjectType,
    statsByPipeline,
    statsTopDownstream,
    listObjectsForStats,
    objectDetail,
    exploreUrlFor,
    catalogExploreBaseUrl,
  };
}

async function fetchAndBuild(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  const body = await res.json();
  const { rows, catalogExploreBaseUrl } = parseLineageBody(body);
  return buildStore(rows, catalogExploreBaseUrl);
}

/**
 * Load lineage from a URL (replaces any cached store). `url` defaults to the bundled sample file.
 * @param {string} [url]
 */
export async function reloadLineageFromUrl(url = DEFAULT_LINEAGE_JSON_URL) {
  activeFetchUrl = url;
  loadPromise = fetchAndBuild(url);
  return loadPromise;
}

/**
 * Parse UTF-8 JSON text and replace the store (e.g. after a file upload).
 * @param {string} text
 */
export async function reloadLineageFromJsonText(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const { rows, catalogExploreBaseUrl } = parseLineageBody(body);
  activeFetchUrl = '';
  loadPromise = Promise.resolve(buildStore(rows, catalogExploreBaseUrl));
  return loadPromise;
}

export async function getUnifiedLineageStore() {
  if (!loadPromise) {
    loadPromise = fetchAndBuild(activeFetchUrl || DEFAULT_LINEAGE_JSON_URL);
  }
  return loadPromise;
}

/** Re-fetch the last URL used by {@link reloadLineageFromUrl}, or the default sample if the current data came from an upload. */
export async function refreshLineageFromActiveUrl() {
  const url = activeFetchUrl && activeFetchUrl.trim() ? activeFetchUrl : DEFAULT_LINEAGE_JSON_URL;
  return reloadLineageFromUrl(url);
}
