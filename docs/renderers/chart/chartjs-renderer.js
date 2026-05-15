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
            },
            ...(chartOnClick ? { onClick: chartOnClick } : {}),
          },
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
