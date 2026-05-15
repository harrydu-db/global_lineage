// API client: lineage and stats from static JSON (default lineage_sample.json) or an uploaded file.
// See lib/unified-lineage-store.js.

import {
  getUnifiedLineageStore,
  reloadLineageFromJsonText,
  refreshLineageFromActiveUrl,
} from '/lib/unified-lineage-store.js';

export const api = {
  /** Substring search over object_full_name. limit=0 means no cap. */
  searchObjects: async (q = '', limit = 0) => {
    const store = await getUnifiedLineageStore();
    return store.searchObjects(q, limit);
  },

  /** Subgraph reachable from `root`. direction: 'down' | 'up' | 'both'. */
  lineageFrom: async (root, { direction = 'down', depth = null } = {}) => {
    const store = await getUnifiedLineageStore();
    const maxDepth = depth != null && depth !== '' ? Number(depth) : null;
    return store.subgraphFor(root, direction, Number.isFinite(maxDepth) ? maxDepth : null);
  },

  /** Whole graph: every object + every edge. */
  lineageAll: async () => {
    const store = await getUnifiedLineageStore();
    return store.lineageAll();
  },

  /** Details for one object_full_name. */
  object: async (fullName) => {
    const store = await getUnifiedLineageStore();
    return store.objectDetail(fullName);
  },

  /** Re-fetch the active URL, or the default sample if the current data came from an upload. */
  refreshLineage: async () => {
    await refreshLineageFromActiveUrl();
    return { ok: true, message: 'Lineage JSON reloaded.' };
  },

  /** Replace lineage with the contents of a user-selected JSON file (same shape as lineage_sample.json). */
  uploadLineageJson: async (file) => {
    if (!file || typeof file.text !== 'function') {
      throw new Error('A JSON file is required');
    }
    const text = await file.text();
    await reloadLineageFromJsonText(text);
    return { ok: true, message: `Loaded ${file.name}` };
  },

  stats: {
    summary: async () => {
      const store = await getUnifiedLineageStore();
      return store.statsSummary();
    },
    byObjectType: async () => {
      const store = await getUnifiedLineageStore();
      return store.statsByObjectType();
    },
    byPipeline: async (limit = 20) => {
      const store = await getUnifiedLineageStore();
      return store.statsByPipeline(limit);
    },
    topDownstream: async (n = 10) => {
      const store = await getUnifiedLineageStore();
      return store.statsTopDownstream(n);
    },
  },
};
