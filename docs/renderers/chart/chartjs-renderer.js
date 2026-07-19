// Chart.js implementation of the ChartRenderer contract.
// Loaded from CDN in index.html.

import { getTheme } from '../../lib/theme.js';

const PALETTE = [
  '#58a6ff', '#3fb950', '#d29922', '#f778ba', '#a371f7',
  '#79c0ff', '#56d364', '#ffa657', '#ff7b72', '#bc8cff',
  '#7ee787', '#ffab70', '#b392f0', '#79b8ff', '#85e89d',
];

function colorsFor(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(PALETTE[i % PALETTE.length]);
  return out;
}

/** Pick black or white text for legibility on a given hex fill. */
function contrastText(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#ffffff';
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  // Relative luminance (sRGB, perceptual weights).
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#000000' : '#ffffff';
}

// Inline plugin (no CDN dependency): draw each slice's share as a percentage
// at the slice centroid. Slices thinner than the threshold are skipped so the
// labels stay readable; the exact percentage is still in the tooltip.
const piePercentLabels = {
  id: 'piePercentLabels',
  afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || !meta.data.length) return;
    const ds = chart.data.datasets[0];
    const values = ds.data || [];
    const total = values.reduce((a, b) => a + (Number(b) || 0), 0);
    if (!total) return;
    const bg = ds.backgroundColor || [];
    const { ctx } = chart;
    ctx.save();
    ctx.font = '600 11px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    meta.data.forEach((arc, i) => {
      const value = Number(values[i]) || 0;
      const pct = (value / total) * 100;
      if (pct < 5) return; // skip thin slices to avoid overlap
      const { x, y } = arc.getCenterPoint();
      ctx.fillStyle = contrastText(Array.isArray(bg) ? bg[i] : bg);
      ctx.fillText(`${Math.round(pct)}%`, x, y);
    });
    ctx.restore();
  },
};

function chartTheme() {
  const light = getTheme() === 'light';
  return {
    text: light ? '#1f2328' : '#e6edf3',
    tickMuted: light ? '#59636e' : '#8b949e',
    grid: light ? '#d1d9e0' : '#30363d',
    pieBorder: light ? '#ffffff' : '#0d1117',
  };
}

function buildCommonOpts() {
  const t = chartTheme();
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: t.text, font: { size: 11 } } },
      tooltip: { bodyColor: t.text, titleColor: t.text },
    },
  };
}

export function createChartJsRenderer() {
  if (typeof Chart === 'undefined') {
    throw new Error('Chart global missing — check the <script> tag in index.html');
  }

  let canvas = null;
  let chart = null;

  /** @type {import('./chart-renderer.js').ChartRenderer} */
  const renderer = {
    init(container) {
      canvas = document.createElement('canvas');
      container.appendChild(canvas);
    },

    render(kind, data, opts = {}) {
      if (!canvas) throw new Error('init() must be called first');
      if (chart) { chart.destroy(); chart = null; }

      const labels = data.map((d) => d.label);
      const values = data.map((d) => d.count);
      const colors = colorsFor(values.length);
      const onSegmentClick = typeof opts.onSegmentClick === 'function' ? opts.onSegmentClick : null;
      const chartOnClick = onSegmentClick
        ? (_evt, elements) => {
            if (!elements.length) return;
            const idx = elements[0].index;
            const d = data[idx];
            if (d) onSegmentClick({ label: d.label, count: d.count, index: idx });
          }
        : undefined;

      const COMMON_OPTS = buildCommonOpts();
      const t = chartTheme();
      let cfg;
      if (kind === 'pie' || kind === 'doughnut') {
        cfg = {
          type: kind,
          data: {
            labels,
            datasets: [{ data: values, backgroundColor: colors, borderColor: t.pieBorder, borderWidth: 1 }],
          },
          options: {
            ...COMMON_OPTS,
            plugins: {
              ...COMMON_OPTS.plugins,
              legend: { ...COMMON_OPTS.plugins.legend, position: 'right' },
              tooltip: {
                ...COMMON_OPTS.plugins.tooltip,
                callbacks: {
                  label: (item) => {
                    const value = Number(item.parsed) || 0;
                    const total = (item.dataset.data || []).reduce((a, b) => a + (Number(b) || 0), 0);
                    const pct = total ? (value / total) * 100 : 0;
                    return `${item.label}: ${value.toLocaleString()} (${pct.toFixed(1)}%)`;
                  },
                },
              },
            },
            ...(chartOnClick ? { onClick: chartOnClick } : {}),
          },
          plugins: [piePercentLabels],
        };
      } else if (kind === 'horizontalBar') {
        cfg = {
          type: 'bar',
          data: {
            labels,
            datasets: [{ data: values, backgroundColor: colors }],
          },
          options: {
            ...COMMON_OPTS,
            indexAxis: 'y',
            plugins: { ...COMMON_OPTS.plugins, legend: { display: false } },
            scales: {
              x: { ticks: { color: t.tickMuted }, grid: { color: t.grid } },
              y: { ticks: { color: t.text }, grid: { color: t.grid } },
            },
            ...(chartOnClick ? { onClick: chartOnClick } : {}),
          },
        };
      } else {
        cfg = {
          type: 'bar',
          data: {
            labels,
            datasets: [{ data: values, backgroundColor: colors }],
          },
          options: {
            ...COMMON_OPTS,
            plugins: { ...COMMON_OPTS.plugins, legend: { display: false } },
            scales: {
              x: { ticks: { color: t.text }, grid: { color: t.grid } },
              y: { ticks: { color: t.tickMuted }, grid: { color: t.grid } },
            },
            ...(chartOnClick ? { onClick: chartOnClick } : {}),
          },
        };
      }

      chart = new Chart(canvas, cfg);
    },

    destroy() {
      if (chart) { try { chart.destroy(); } catch (_) {} chart = null; }
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      canvas = null;
    },
  };

  return renderer;
}
