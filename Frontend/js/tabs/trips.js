import { api, ApiError } from "../api.js";
import { esc, fmt, PAYMENT_LABELS } from "../format.js";

const PAGE_SIZE = 25;
const state = { page: 1, filters: {} };

const els = {
  form: () => document.getElementById("trip-filters"),
  body: () => document.getElementById("trips-body"),
  wrap: () => document.getElementById("trips-wrap"),
  info: () => document.getElementById("results-info"),
  pager: () => document.getElementById("pagination"),
  error: () => document.getElementById("filter-error"),
  dialog: () => document.getElementById("trip-dialog"),
};

export async function loadTrips() {
  setupFilters();
  setupDialog();
  await fetchPage(1);
}

async function setupFilters() {
  const hour = document.getElementById("filter-hour");
  for (let h = 0; h < 24; h++) hour.add(new Option(`${fmt.hour(h)} (${fmt.hour12(h)})`, h));

  const form = els.form();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const min = parseFloat(data.min_fare);
    const max = parseFloat(data.max_fare);
    if (!Number.isNaN(min) && !Number.isNaN(max) && min > max) {
      return showError("Min fare can't be higher than max fare.");
    }
    state.filters = data;
    fetchPage(1);
  });
  form.addEventListener("reset", () => {
    state.filters = {};
    // Let the browser clear the fields before re-fetching.
    setTimeout(() => fetchPage(1));
  });

  const borough = document.getElementById("filter-borough");
  try {
    (await api.boroughs()).forEach((b) => borough.add(new Option(b, b)));
  } catch {
    /* the table itself reports the connection error */
  }
}

function showError(message) {
  const el = els.error();
  el.textContent = message;
  el.hidden = !message;
}

async function fetchPage(page) {
  showError("");
  els.wrap().classList.add("loading");
  try {
    const data = await api.trips({ ...state.filters, page, limit: PAGE_SIZE });
    state.page = page;
    renderRows(data);
    renderPager(data);
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) showError(e.message);
    else {
      els.body().innerHTML = `<tr><td colspan="9" class="empty">${esc(e.message)}</td></tr>`;
      els.info().textContent = "";
      els.pager().innerHTML = "";
    }
  } finally {
    els.wrap().classList.remove("loading");
  }
}

function renderRows({ trips, total, page }) {
  const first = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(page * PAGE_SIZE, total);
  els.info().textContent = total
    ? `${fmt.num(first)}–${fmt.num(last)} of ${fmt.num(total)} trips · select a row for details`
    : "No trips match these filters";

  if (!trips.length) {
    els.body().innerHTML = `<tr><td colspan="9" class="empty">No trips match these filters. Try widening the fare range or clearing the hour.</td></tr>`;
    return;
  }

  els.body().innerHTML = trips.map((t) => `
    <tr data-id="${esc(t.trip_id)}" tabindex="0" aria-label="Trip ${esc(t.trip_id)}, open details">
      <td>${esc(fmt.dateTime(t.pickup_datetime))}</td>
      <td>${esc(t.pu_zone)}<small>${esc(t.pu_borough)}</small></td>
      <td>${esc(t.do_zone)}<small>${esc(t.do_borough)}</small></td>
      <td class="num">${esc(fmt.dec(t.trip_distance, 2))} mi</td>
      <td class="num">${esc(fmt.dec(t.trip_duration_min))} min</td>
      <td class="num">${esc(fmt.money(t.fare_amount))}</td>
      <td class="num">${esc(fmt.money(t.tip_amount))}</td>
      <td class="num">${esc(fmt.money(t.total_amount))}</td>
      <td><span class="pill">${esc(PAYMENT_LABELS[t.payment_type] ?? "Other")}</span>${t.is_airport ? ' <span class="pill airport">Airport</span>' : ""}</td>
    </tr>`).join("");
}

function renderPager({ page, pages }) {
  const pager = els.pager();
  pager.innerHTML = "";
  if (pages <= 1) return;

  const info = document.createElement("span");
  info.className = "page-info";
  info.textContent = `Page ${fmt.num(page)} of ${fmt.num(pages)}`;
  pager.appendChild(info);

  const add = (label, target, { current = false, disabled = false, aria } = {}) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.disabled = disabled;
    if (aria) b.setAttribute("aria-label", aria);
    if (current) b.setAttribute("aria-current", "page");
    b.addEventListener("click", () => fetchPage(target));
    pager.appendChild(b);
  };

  add("‹", page - 1, { disabled: page === 1, aria: "Previous page" });
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const end = Math.min(pages, start + 4);
  for (let p = start; p <= end; p++) add(fmt.num(p), p, { current: p === page });
  add("›", page + 1, { disabled: page === pages, aria: "Next page" });
}

// ── Trip detail dialog ──────────────────────────────────────────────────────
function setupDialog() {
  const body = els.body();
  const open = (row) => row?.dataset.id && showTrip(row.dataset.id);
  body.addEventListener("click", (e) => open(e.target.closest("tr")));
  body.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(e.target.closest("tr"));
    }
  });

  const dialog = els.dialog();
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
}

async function showTrip(id) {
  const dialog = els.dialog();
  const content = document.getElementById("trip-dialog-body");
  document.getElementById("trip-dialog-title").textContent = `Trip #${id}`;
  content.innerHTML = `<p class="card-sub">Loading…</p>`;
  dialog.showModal();

  try {
    const t = await api.trip(id);
    const group = (title, items) =>
      `<dt class="group">${esc(title)}</dt>` +
      items.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");

    content.innerHTML = `<dl class="kv">${[
      group("Route", [
        ["Pickup", `${t.pu_zone}, ${t.pu_borough}`],
        ["Dropoff", `${t.do_zone}, ${t.do_borough}`],
        ["Pickup time", fmt.dateTime(t.pickup_datetime)],
        ["Dropoff time", fmt.dateTime(t.dropoff_datetime)],
        ["Airport trip", t.is_airport ? "Yes" : "No"],
      ]),
      group("Trip", [
        ["Distance", `${fmt.dec(t.trip_distance, 2)} mi`],
        ["Duration", `${fmt.dec(t.trip_duration_min)} min`],
        ["Average speed", `${fmt.dec(t.speed_mph)} mph`],
        ["Passengers", t.passenger_count],
      ]),
      group("Payment", [
        ["Fare", fmt.money(t.fare_amount)],
        ["Extra + MTA tax", fmt.money((t.extra ?? 0) + (t.mta_tax ?? 0))],
        ["Improvement surcharge", fmt.money(t.improvement_surcharge)],
        ["Tolls", fmt.money(t.tolls_amount)],
        ["Tip", `${fmt.money(t.tip_amount)} (${fmt.dec(t.tip_percentage)}%)`],
        ["Total", fmt.money(t.total_amount)],
        ["Fare per mile", fmt.money(t.fare_per_mile)],
        ["Method", PAYMENT_LABELS[t.payment_type] ?? "Other"],
      ]),
    ].join("")}</dl>`;
  } catch (e) {
    content.innerHTML = `<p class="form-error">${esc(e.message)}</p>`;
  }
}
