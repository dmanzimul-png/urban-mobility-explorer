import { api } from "../api.js";
import { axes, barStyle, renderChart } from "../charts.js";
import { esc, fmt } from "../format.js";
import { token } from "../theme.js";
import { insight } from "./shared.js";
import { renderMap, showMapError } from "./zonemap.js";

export async function loadGeography() {
  const [boroughs, zones] = await Promise.all([api.byBorough(), api.topZones()]);

  const byTrips = [...boroughs].sort((a, b) => b.trips - a.trips);
  const total = byTrips.reduce((s, d) => s + d.trips, 0);

  renderInsights(byTrips, total, zones);
  renderBoroughTrips(byTrips, total);
  renderBoroughFare(byTrips);
  renderZones(zones, total);
  renderMap().catch((err) => showMapError(err));
}

function renderInsights(byTrips, total, zones) {
  const top = byTrips[0];
  const outer = byTrips.filter((d) => ["Brooklyn", "Queens", "Bronx", "Staten Island"].includes(d.borough));
  const outerTrips = outer.reduce((s, d) => s + d.trips, 0);
  const top10 = zones.reduce((s, d) => s + d.trips, 0);
  const priciest = [...byTrips].filter((d) => d.trips >= 1000).sort((a, b) => b.avg_fare - a.avg_fare)[0];

  document.getElementById("geo-insights").innerHTML = [
    insight(`<strong>${esc(fmt.pct(top.trips, total))}</strong> of pickups are in ${esc(top.borough)}; ` +
            `the four outer boroughs together account for ${esc(fmt.pct(outerTrips, total))}.`),
    insight(`The 10 busiest zones alone produce <strong>${esc(fmt.pct(top10, total))}</strong> of all trips.`),
    priciest
      ? insight(`Trips starting in <strong>${esc(priciest.borough)}</strong> cost the most on average ` +
                `(${esc(fmt.money(priciest.avg_fare))}), mostly because they cover ${esc(fmt.dec(priciest.avg_distance))} mi.`)
      : "",
  ].join("");
}

function renderBoroughTrips(rows, total) {
  renderChart(
    "borough",
    () => ({
      type: "bar",
      data: {
        labels: rows.map((d) => d.borough),
        datasets: [{ label: "Trips", data: rows.map((d) => d.trips), ...barStyle(token("--series-1")) }],
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${fmt.num(ctx.parsed.x)} trips (${fmt.pct(ctx.parsed.x, total)})` } },
        },
        scales: axes({ horizontal: true, format: fmt.compact }),
      },
    }),
    {
      columns: [{ label: "Borough" }, { label: "Trips", num: true }, { label: "Share", num: true }, { label: "Revenue", num: true }],
      rows: rows.map((d) => [d.borough, fmt.num(d.trips), fmt.pct(d.trips, total), fmt.money(d.revenue)]),
    },
  );
}

function renderBoroughFare(rows) {
  const sorted = [...rows].sort((a, b) => b.avg_fare - a.avg_fare);
  renderChart(
    "borough-fare",
    () => ({
      type: "bar",
      data: {
        labels: sorted.map((d) => d.borough),
        datasets: [{ label: "Average fare", data: sorted.map((d) => d.avg_fare), ...barStyle(token("--series-1")) }],
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${fmt.money(ctx.parsed.x)} average fare`,
              afterLabel: (ctx) => ` ${fmt.dec(sorted[ctx.dataIndex].avg_distance)} mi average distance`,
            },
          },
        },
        scales: axes({ horizontal: true, format: (v) => `$${v}` }),
      },
    }),
    {
      columns: [{ label: "Borough" }, { label: "Avg fare", num: true }, { label: "Avg distance", num: true }],
      rows: sorted.map((d) => [d.borough, fmt.money(d.avg_fare), `${fmt.dec(d.avg_distance)} mi`]),
    },
  );
}

function renderZones(zones, total) {
  const rows = [...zones].sort((a, b) => b.trips - a.trips);
  renderChart(
    "zones",
    () => ({
      type: "bar",
      data: {
        labels: rows.map((d) => d.zone),
        datasets: [{ label: "Trips", data: rows.map((d) => d.trips), ...barStyle(token("--series-1")) }],
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${fmt.num(ctx.parsed.x)} trips (${fmt.pct(ctx.parsed.x, total)})` } },
        },
        scales: axes({ horizontal: true, format: fmt.compact }),
      },
    }),
    {
      columns: [{ label: "Rank", num: true }, { label: "Zone" }, { label: "Trips", num: true }],
      rows: rows.map((d, i) => [i + 1, d.zone, fmt.num(d.trips)]),
    },
  );
}
