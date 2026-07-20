/**
 * Lightweight SVG charts — no external dependencies.
 */

function escapeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderBarChart(container, series, options = {}) {
  if (!container) return;

  const {
    width = 320,
    height = 180,
    barColor = "#0b66c3",
    emptyLabel = "No data yet",
    valueLabel = "value",
    ariaLabel = "Bar chart"
  } = options;

  const data = Array.isArray(series) ? series : [];
  const hasValues = data.some((point) => Number(point.value) > 0);

  if (!data.length || !hasValues) {
    container.innerHTML = `<div class="chart-empty" role="img" aria-label="${escapeText(emptyLabel)}">${escapeText(emptyLabel)}</div>`;
    return;
  }

  const padding = { top: 12, right: 8, bottom: 36, left: 8 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...data.map((point) => Number(point.value) || 0), 1);
  const gap = 4;
  const barWidth = Math.max(6, (chartWidth - gap * (data.length - 1)) / data.length);

  const bars = data
    .map((point, index) => {
      const value = Number(point.value) || 0;
      const barHeight = Math.max(value > 0 ? 4 : 0, (value / maxValue) * chartHeight);
      const x = padding.left + index * (barWidth + gap);
      const y = padding.top + chartHeight - barHeight;
      const label = escapeText(point.label);
      const title = `${label}: ${value} ${valueLabel}`;
      return `
        <g role="presentation">
          <title>${escapeText(title)}</title>
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="${barColor}" opacity="${value > 0 ? 1 : 0.25}"></rect>
          <text x="${x + barWidth / 2}" y="${height - 10}" text-anchor="middle" class="chart-label">${label}</text>
        </g>`;
    })
    .join("");

  container.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeText(ariaLabel)}">
      <line x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${width - padding.right}" y2="${padding.top + chartHeight}" stroke="rgba(12,27,46,.15)" stroke-width="1"></line>
      ${bars}
    </svg>`;
}

export function renderLineChart(container, series, options = {}) {
  if (!container) return;

  const {
    width = 320,
    height = 180,
    lineColor = "#35d07f",
    pointColor = "#0b66c3",
    emptyLabel = "No data yet",
    valueSuffix = "",
    ariaLabel = "Line chart"
  } = options;

  const data = Array.isArray(series) ? series : [];
  const numeric = data.map((point) => Number(point.value));
  const hasValues = numeric.some((value) => Number.isFinite(value) && value > 0);

  if (!data.length || !hasValues) {
    container.innerHTML = `<div class="chart-empty" role="img" aria-label="${escapeText(emptyLabel)}">${escapeText(emptyLabel)}</div>`;
    return;
  }

  const padding = { top: 14, right: 12, bottom: 36, left: 12 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const minValue = Math.min(...numeric.filter((v) => Number.isFinite(v)));
  const maxValue = Math.max(...numeric.filter((v) => Number.isFinite(v)));
  const range = Math.max(maxValue - minValue, 1);

  const points = data.map((point, index) => {
    const value = Number(point.value);
    const x = padding.left + (data.length === 1 ? chartWidth / 2 : (index / (data.length - 1)) * chartWidth);
    const y = padding.top + chartHeight - ((value - minValue) / range) * chartHeight;
    return { x, y, label: point.label, value };
  });

  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const dots = points
    .map((point) => {
      const title = `${point.label}: ${point.value}${valueSuffix}`;
      return `
        <g role="presentation">
          <title>${escapeText(title)}</title>
          <circle cx="${point.x}" cy="${point.y}" r="4" fill="${pointColor}"></circle>
        </g>`;
    })
    .join("");

  const labels = points
    .filter((_, index) => index === 0 || index === points.length - 1 || index % 2 === 0)
    .map(
      (point) =>
        `<text x="${point.x}" y="${height - 10}" text-anchor="middle" class="chart-label">${escapeText(point.label)}</text>`
    )
    .join("");

  container.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeText(ariaLabel)}">
      <line x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${width - padding.right}" y2="${padding.top + chartHeight}" stroke="rgba(12,27,46,.15)" stroke-width="1"></line>
      <path d="${path}" fill="none" stroke="${lineColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
      ${dots}
      ${labels}
    </svg>`;
}
