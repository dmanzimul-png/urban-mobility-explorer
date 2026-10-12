import { api } from "../api.js";
import { axes, barStyle, lineStyle, renderChart } from "../charts.js";
import { esc, fmt, WEEKDAYS } from "../format.js";
import { token } from "../theme.js";
import { insight } from "./shared.js";

const SPEED_ORDER = ["0-10", "10-20", "20-30", "30-40", "40+"];

export async function loadPatterns() {
  const [hourly, daily, speed] = await Promise.all([api.byHour(), api.byDay(), api.speed()]);

  const hours = [...hourly].sort((a, b) => a.hour - b.hour);
  const days = WEEKDAYS.map(
    (name) => daily.find((d) => d.day_name === name) ?? { day_name: name, trips: 0, avg_fare: 0, revenue: 0 },
  );

  renderInsights(hours, speed);
  renderHour(hours);
  renderHourFare(hours);
  renderDay(days);
  renderSpeed(speed);
}

function renderInsights(hours, speed) {
  const peak = hours.reduce((a, b) => (b.trips > a.trips ? b : a));
  const low = hours.reduce((a, b) => (b.trips < a.trips ? b : a));
  const priciest = hours.reduce((a, b) => (b.avg_fare > a.avg_fare ? b : a));
  const slowTrips = speed["0-10"] ?? 0;
  const allTrips = Object.values(speed).reduce((s, v) => s + v, 0);

  document.getElementById("pattern-insights").innerHTML = [
    insight(
      `Demand peaks at <strong>${esc(fmt.hour12(peak.hour))}</strong> with ${esc(fmt.num(peak.trips))} trips, ` +
      `${esc((peak.trips / Math.max(low.trips, 1)).toFixed(0))}× the quietest hour (${esc(fmt.hour12(low.hour))}).`,
    ),
    insight(
      `Fares are highest at <strong>${esc(fmt.hour12(priciest.hour))}</strong> ` +
      `(${esc(fmt.money(priciest.avg_fare))} on average): fewer, longer trips such as airport runs.`,
    ),
    insight(
      `<strong>${esc(fmt.pct(slowTrips, allTrips, 0))}</strong> of trips average under 10 mph, ` +
      `a sign of how congested the streets are.`,
    ),
  ].join("");
}

function renderHour(hours) {
  renderChart(
    "hour",
    () => ({
      type: "bar",
      data: {
        labels: hours.map((d) => fmt.hour(d.hour)),
        datasets: [{ label: "Trips", data: hours.map((d) => d.trips), ...barStyle(token("--series-1")) }],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${fmt.num(ctx.parsed.y)} trips` } },
        },
        scales: axes({ format: fmt.compact }),
      },
    }),
    {
      columns: [{ label: "Hour" }, { label: "Trips", num: true }, { label: "Avg fare", num: true }, { label: "Avg duration", num: true }],
      rows: hours.map((d) => [fmt.hour(d.hour), fmt.num(d.trips), fmt.money(d.avg_fare), `${fmt.dec(d.avg_duration)} min`]),
    },
  );
}

function renderHourFare(hours) {
  renderChart(
    "hour-fare",
    () => {
      const scales = axes({ format: (v) => `$${v}` });
      scales.y.beginAtZero = false;
      return {
        type: "line",
        data: {
          labels: hours.map((d) => fmt.hour(d.hour)),
          datasets: [{ label: "Average fare", data: hours.map((d) => d.avg_fare), ...lineStyle(token("--series-1")) }],
        },
        options: {
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => ` ${fmt.money(ctx.parsed.y)} average fare` } },
          },
          scales,
        },
      };
    },
    {
      columns: [{ label: "Hour" }, { label: "Avg fare", num: true }],
      rows: hours.map((d) => [fmt.hour(d.hour), fmt.money(d.avg_fare)]),
    },
  );
}

function renderDay(days) {
  renderChart(
    "day",
    () => ({
      type: "bar",
      data: {
        labels: days.map((d) => d.day_name.slice(0, 3)),
        datasets: [{ label: "Trips", data: days.map((d) => d.trips), ...barStyle(token("--series-1")) }],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => days[items[0].dataIndex].day_name,
              label: (ctx) => ` ${fmt.num(ctx.parsed.y)} trips · ${fmt.money(days[ctx.dataIndex].avg_fare)} avg fare`,
            },
          },
        },
        scales: axes({ format: fmt.compact }),
      },
    }),
    {
      columns: [{ label: "Day" }, { label: "Trips", num: true }, { label: "Avg fare", num: true }, { label: "Revenue", num: true }],
      rows: days.map((d) => [d.day_name, fmt.num(d.trips), fmt.money(d.avg_fare), fmt.money(d.revenue)]),
    },
  );
}

function renderSpeed(speed) {
  const keys = SPEED_ORDER.filter((k) => k in speed);
  const total = keys.reduce((s, k) => s + speed[k], 0);

  renderChart(
    "speed",
    () => ({
      type: "bar",
      data: {
        labels: keys.map((k) => `${k} mph`),
        // Ordered buckets -> one-hue ordinal ramp, slow to fast.
        datasets: [{
          label: "Trips",
          data: keys.map((k) => speed[k]),
          ...barStyle(keys.map((_, i) => token(`--ramp-${i + 1}`))),
        }],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${fmt.num(ctx.parsed.y)} trips (${fmt.pct(ctx.parsed.y, total)})` } },
        },
        scales: axes({ format: fmt.compact }),
      },
    }),
    {
      columns: [{ label: "Speed" }, { label: "Trips", num: true }, { label: "Share", num: true }],
      rows: keys.map((k) => [`${k} mph`, fmt.num(speed[k]), fmt.pct(speed[k], total)]),
    },
  );
}
