// Chart.js implementation of the ChartRenderer contract.
// Loaded from CDN in index.html.

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

const COMMON_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#e6edf3', font: { size: 11 } } },
    tooltip: { bodyColor: '#e6edf3', titleColor: '#e6edf3' },
  },
};

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

      let cfg;
      if (kind === 'pie' || kind === 'doughnut') {
        cfg = {
          type: kind,
          data: {
            labels,
            datasets: [{ data: values, backgroundColor: colors, borderColor: '#0d1117', borderWidth: 1 }],
          },
          options: {
            ...COMMON_OPTS,
            plugins: {
              ...COMMON_OPTS.plugins,
              legend: { ...COMMON_OPTS.plugins.legend, position: 'right' },
            },
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
              x: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } },
              y: { ticks: { color: '#e6edf3' }, grid: { color: '#30363d' } },
            },
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
              x: { ticks: { color: '#e6edf3' }, grid: { color: '#30363d' } },
              y: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } },
            },
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
