import { api } from "../api.js";
import { axes, barStyle, renderChart } from "../charts.js";
import { esc, fmt } from "../format.js";
import { token } from "../theme.js";

const ALGOS = [
  { key: "quicksort", name: "QuickSort", manual: "quicksort_ms", builtin: "python_sort_ms", builtinName: "sort()", match: "quicksort_match" },
  { key: "heap", name: "Min-heap top-k", manual: "heap_ms", builtin: "sorted_ms", builtinName: "sorted()", match: "heap_match" },
  { key: "hashmap", name: "Hash map", manual: "hashmap_ms", builtin: "dict_ms", builtinName: "dict", match: "hashmap_match" },
];

export function setupBenchmark() {
  const btn = document.getElementById("run-benchmark");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Running…";
    try {
      render(await api.benchmark());
    } catch (e) {
      ALGOS.forEach((a) => {
        document.querySelector(`[data-algo="${a.key}"]`).innerHTML = `<span class="check bad">${esc(e.message)}</span>`;
      });
    } finally {
      btn.disabled = false;
      btn.textContent = "Run again";
    }
  });
}

function check(ok) {
  return ok
    ? `<span class="check ok"><span aria-hidden="true">✓</span> Matches built-in</span>`
    : `<span class="check bad"><span aria-hidden="true">✕</span> Differs from built-in</span>`;
}

function render(data) {
  ALGOS.forEach((a) => {
    const extra = a.key === "heap" && data.top_zones?.length
      ? `<dt>Top zone</dt><dd>${esc(data.top_zones[0].zone)}</dd>`
      : "";
    document.querySelector(`[data-algo="${a.key}"]`).innerHTML = `
      <dl>
        <dt>Hand-written</dt><dd>${esc(fmt.dec(data[a.manual], 3))} ms</dd>
        <dt>Python ${esc(a.builtinName)}</dt><dd>${esc(fmt.dec(data[a.builtin], 3))} ms</dd>
        ${extra}
      </dl>
      <p style="margin-top:8px">${check(data[a.match])}</p>`;
  });

  document.getElementById("bench-sub").textContent =
    `Milliseconds, lower is faster · ${fmt.num(data.sample_size)} trips sorted and counted, ${fmt.num(data.zone_count)} zones ranked`;

  // Two series (hand-written vs built-in) -> categorical slots 1 and 2, with a legend.
  renderChart(
    "bench",
    () => ({
      type: "bar",
      data: {
        labels: ALGOS.map((a) => a.name),
        datasets: [
          { label: "Hand-written", data: ALGOS.map((a) => data[a.manual]), ...barStyle(token("--series-1")) },
          { label: "Python built-in", data: ALGOS.map((a) => data[a.builtin]), ...barStyle(token("--series-2")) },
        ],
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: { position: "top", align: "start" },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt.dec(ctx.parsed.x, 3)} ms` } },
        },
        scales: axes({ horizontal: true, format: (v) => `${v} ms` }),
      },
    }),
    {
      columns: [{ label: "Algorithm" }, { label: "Hand-written (ms)", num: true }, { label: "Built-in (ms)", num: true }, { label: "Same result" }],
      rows: ALGOS.map((a) => [a.name, fmt.dec(data[a.manual], 3), fmt.dec(data[a.builtin], 3), data[a.match] ? "Yes" : "No"]),
    },
  );
}
