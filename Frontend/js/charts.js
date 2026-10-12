/**
 * Chart.js helpers. Every chart:
 *  - takes its colors from CSS tokens, so light/dark both use validated steps
 *  - has a "Table" toggle that shows the same numbers as an accessible table
 *  - re-renders when the theme changes
 */

import { esc } from "./format.js";
import { onThemeChange, token } from "./theme.js";

const registry = new Map();   // key -> { chart, render }

onThemeChange(() => registry.forEach((entry) => entry.render()));

function applyDefaults() {
  const d = window.Chart.defaults;
  d.font.family = token("--font");
  d.font.size = 12;
  d.color = token("--muted");
  d.borderColor = token("--grid");
  d.maintainAspectRatio = false;
  d.animation.duration = 300;
  d.plugins.legend.labels.boxWidth = 10;
  d.plugins.legend.labels.boxHeight = 10;
  d.plugins.legend.labels.color = token("--ink-2");
  Object.assign(d.plugins.tooltip, {
    backgroundColor: token("--ink"),
    titleColor: token("--surface"),
    bodyColor: token("--surface"),
    padding: 10,
    cornerRadius: 8,
    boxPadding: 4,
    usePointStyle: true,
  });
}

/** Shared axis styling: hairline grid on the value axis only. */
export function axes({ horizontal = false, format = (v) => v, title } = {}) {
  const value = {
    beginAtZero: true,
    grid: { color: token("--grid"), drawTicks: false },
    border: { display: false },
    ticks: { padding: 8, callback: (v) => format(v), maxTicksLimit: 6 },
    title: title ? { display: true, text: title, color: token("--muted") } : undefined,
  };
  const category = {
    grid: { display: false },
    border: { color: token("--axis") },
    ticks: { padding: 6, autoSkipPadding: 12, maxRotation: 0 },
  };
  return horizontal ? { x: value, y: category } : { x: category, y: value };
}

/** Bar dataset styling: thin bars, rounded data end, 2px gap between bars. */
export function barStyle(color) {
  return {
    backgroundColor: color,
    hoverBackgroundColor: color,
    borderRadius: 4,
    borderSkipped: "start",
    borderColor: token("--surface"),
    borderWidth: 0,
    categoryPercentage: 0.8,
    barPercentage: 0.9,
    maxBarThickness: 36,
  };
}

/** Line dataset styling: 2px line, markers only on hover. */
export function lineStyle(color) {
  return {
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    tension: 0.25,
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHoverBorderWidth: 2,
    pointHoverBorderColor: token("--surface"),
    pointHitRadius: 12,
  };
}

function ensureTableToggle(card) {
  if (card.querySelector(".table-toggle")) return;
  const btn = document.getElementById("table-toggle-tpl").content.firstElementChild.cloneNode(true);
  btn.addEventListener("click", () => {
    const on = card.classList.toggle("is-table");
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = on ? "Chart" : "Table";
  });
  card.querySelector(".card-head").appendChild(btn);

  const wrap = document.createElement("div");
  wrap.className = "chart-table";
  card.querySelector(".chart-box").after(wrap);
}

function renderTable(card, { columns, rows }) {
  const head = columns.map((c) => `<th scope="col" class="${c.num ? "num" : ""}">${esc(c.label)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${columns.map((c, i) => `<td class="${c.num ? "num" : ""}">${esc(r[i])}</td>`).join("")}</tr>`)
    .join("");
  card.querySelector(".chart-table").innerHTML =
    `<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * Render (or re-render) the chart inside <article data-chart="key">.
 * `build` returns a Chart.js config and is called again on theme change;
 * `table` is { columns: [{label, num}], rows: [[...]] } for the table view.
 */
export function renderChart(key, build, table) {
  const card = document.querySelector(`[data-chart="${key}"]`);
  if (!card) return;
  card.hidden = false;

  const render = () => {
    applyDefaults();
    registry.get(key)?.chart?.destroy();
    const chart = new window.Chart(card.querySelector("canvas"), build());
    registry.set(key, { chart, render });
  };

  ensureTableToggle(card);
  renderTable(card, table);
  render();
}

/** Put a short error message in place of a chart that failed to load. */
export function chartError(key, message) {
  const card = document.querySelector(`[data-chart="${key}"]`);
  if (!card) return;
  card.querySelector(".chart-box").innerHTML = `<p class="card-sub">${esc(message)}</p>`;
}
