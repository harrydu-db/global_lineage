/**
 * Loads lineage JSON (default: /lineage_sample.json) and exposes graph + stats helpers.
 * Edge direction: source = upstream table/view, target = dependent object.
 */

/** Resolved against this module so fetches work on GitHub Pages (`/repo/`) and local static servers. */
export const DEFAULT_LINEAGE_JSON_URL = new URL('../lineage_sample.json', import.meta.url).href;

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

  /**
   * @param {string} root
   * @param {'down'|'up'|'both'} direction
   * @param {number|null|undefined} maxDepth hops from root; null = unlimited
   */
  function collectNodeIds(root, direction, maxDepth) {
    const out = new Set();
    if (!root) return out;
    out.add(root);

    function bfs(adjGetter) {
      const queue = [[root, 0]];
      let i = 0;
      while (i < queue.length) {
        const [n, dist] = queue[i++];
        if (maxDepth != null && maxDepth !== '' && dist >= maxDepth) continue;
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
      bfs((n) => [...(downstream.get(n) || [])]);
    }
    if (direction === 'up' || direction === 'both') {
      bfs((n) => [...(upstream.get(n) || [])]);
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

  function subgraphFor(root, direction, maxDepth) {
    const ids = collectNodeIds(root, direction, maxDepth);
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
   * @returns {{ object_full_name: string, object_type: string|null, catalog: string, schema: string, downstream_count: number, downstream_objects: string[], upstream_count: number, upstream_objects: string[] }[]}
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
