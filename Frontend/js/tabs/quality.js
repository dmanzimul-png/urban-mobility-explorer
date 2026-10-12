import { api } from "../api.js";
import { axes, barStyle, renderChart } from "../charts.js";
import { fmt } from "../format.js";
import { token } from "../theme.js";
import { skeletonTiles, tile } from "./shared.js";

export async function loadQuality() {
  const tiles = document.getElementById("quality-tiles");
  skeletonTiles(tiles, 6);

  const [dq, reasons] = await Promise.all([api.dataQuality(), api.rejectionReasons()]);
  const raw = dq.total_raw;

  tiles.innerHTML = [
    tile("Raw records", fmt.compact(raw), fmt.num(raw)),
    tile("Kept", fmt.compact(dq.total_clean), `${fmt.pct(dq.total_clean, raw)} of raw`),
    tile("Rejected", fmt.compact(dq.total_rejected), `${fmt.pct(dq.total_rejected, raw)} of raw`),
    tile("Zero passengers", fmt.num(dq.zero_passenger), "largest single issue"),
    tile("Fare mismatches", fmt.num(dq.fare_mismatch), "total ≠ itemized charges"),
    tile("Missing values filled", fmt.num((dq.null_passenger ?? 0) + (dq.null_ratecode ?? 0)), "passenger count, rate code"),
  ].join("");

  const rows = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, v]) => s + v, 0);

  renderChart(
    "rejection",
    () => ({
      type: "bar",
      data: {
        labels: rows.map(([k]) => fmt.label(k)),
        datasets: [{ label: "Rejected records", data: rows.map(([, v]) => v), ...barStyle(token("--series-1")) }],
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${fmt.num(ctx.parsed.x)} records (${fmt.pct(ctx.parsed.x, total)} of rejections)` } },
        },
        scales: axes({ horizontal: true, format: fmt.compact }),
      },
    }),
    {
      columns: [{ label: "Reason" }, { label: "Records", num: true }, { label: "Share of rejections", num: true }],
      rows: rows.map(([k, v]) => [fmt.label(k), fmt.num(v), fmt.pct(v, total)]),
    },
  );
}
