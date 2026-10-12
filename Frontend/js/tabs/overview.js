import { api } from "../api.js";
import { axes, barStyle, chartError, lineStyle, renderChart } from "../charts.js";
import { esc, fmt } from "../format.js";
import { token } from "../theme.js";
import { skeletonTiles, tile } from "./shared.js";

export async function loadOverview() {
  const tiles = document.getElementById("kpi-tiles");
  skeletonTiles(tiles, 6);

  const [summary, trend, payment, airport] = await Promise.all([
    api.summary(), api.dailyTrend(), api.byPayment(), api.airport(),
  ]);

  tiles.innerHTML = [
    tile("Trips", fmt.compact(summary.total_trips), fmt.num(summary.total_trips)),
    tile("Revenue", fmt.moneyCompact(summary.total_revenue), "fares, tips and surcharges"),
    tile("Average fare", fmt.money(summary.avg_fare), `${fmt.money(summary.avg_tip)} avg tip`),
    tile("Average distance", `${fmt.dec(summary.avg_distance, 2)} mi`),
    tile("Average duration", `${fmt.dec(summary.avg_duration)} min`, `${fmt.dec(summary.avg_speed)} mph avg speed`),
    tile("Average tip", `${fmt.dec(summary.avg_tip_pct)}%`, "of the base fare"),
  ].join("");

  renderDaily(trend);
  renderPayment(payment);
  renderAirport(summary, airport);
}

function renderDaily(trend) {
  const rows = [...trend].sort((a, b) => a.pickup_date.localeCompare(b.pickup_date));
  if (!rows.length) return chartError("daily", "No trips loaded.");

  const long = { weekday: "short", month: "short", day: "numeric" };
  const busiest = rows.reduce((a, b) => (b.trips > a.trips ? b : a));
  const quietest = rows.reduce((a, b) => (b.trips < a.trips ? b : a));
  document.getElementById("daily-sub").textContent =
    `Busiest: ${fmt.date(busiest.pickup_date, long)} (${fmt.num(busiest.trips)}) · ` +
    `quietest: ${fmt.date(quietest.pickup_date, long)} (${fmt.num(quietest.trips)})`;

  renderChart(
    "daily",
    () => ({
      type: "line",
      data: {
        labels: rows.map((d) => fmt.date(d.pickup_date)),
        datasets: [{ label: "Trips", data: rows.map((d) => d.trips), ...lineStyle(token("--series-1")), fill: false }],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) =>
                fmt.date(rows[items[0].dataIndex].pickup_date, { weekday: "long", month: "long", day: "numeric" }),
              label: (ctx) => ` ${fmt.num(ctx.parsed.y)} trips · ${fmt.money(rows[ctx.dataIndex].revenue)} revenue`,
            },
          },
        },
        scales: axes({ format: fmt.compact }),
      },
    }),
    {
      columns: [{ label: "Date" }, { label: "Trips", num: true }, { label: "Revenue", num: true }],
      rows: rows.map((d) => [d.pickup_date, fmt.num(d.trips), fmt.money(d.revenue)]),
    },
  );
}

function renderPayment(payment) {
  const rows = [...payment].sort((a, b) => b.trips - a.trips);
  const total = rows.reduce((s, d) => s + d.trips, 0);

  renderChart(
    "payment",
    () => ({
      type: "bar",
      data: {
        labels: rows.map((d) => d.label),
        datasets: [{ label: "Trips", data: rows.map((d) => d.trips), ...barStyle(token("--series-1")) }],
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${fmt.num(ctx.parsed.x)} trips (${fmt.pct(ctx.parsed.x, total)})`,
              afterLabel: (ctx) => ` avg tip ${fmt.money(rows[ctx.dataIndex].avg_tip)}`,
            },
          },
        },
        scales: axes({ horizontal: true, format: fmt.compact }),
      },
    }),
    {
      columns: [{ label: "Payment" }, { label: "Trips", num: true }, { label: "Share", num: true }, { label: "Avg tip", num: true }],
      rows: rows.map((d) => [d.label, fmt.num(d.trips), fmt.pct(d.trips, total), fmt.money(d.avg_tip)]),
    },
  );
}

function renderAirport(summary, airport) {
  const share = fmt.pct(summary.airport_trips, summary.total_trips);
  const ratio = airport.non_airport ? (airport.airport / airport.non_airport).toFixed(1) : "—";

  document.getElementById("airport-compare").innerHTML = `
    <div class="compare-item">
      <div class="compare-label">Airport trips · avg fare</div>
      <div class="compare-value">${esc(fmt.money(airport.airport))}</div>
    </div>
    <div class="compare-item">
      <div class="compare-label">Other trips · avg fare</div>
      <div class="compare-value">${esc(fmt.money(airport.non_airport))}</div>
    </div>`;

  document.getElementById("airport-note").innerHTML =
    `<strong>${esc(fmt.num(summary.airport_trips))}</strong> trips (${esc(share)}) start or end at an airport, ` +
    `and they cost about <strong>${esc(ratio)}×</strong> as much: longer distances, plus the flat JFK–Manhattan fare.`;
}
