/**
 * Entry point: tabs, theme, API status, and lazy loading of each tab.
 */

import { api } from "./api.js";
import { fmt } from "./format.js";
import { initTheme } from "./theme.js";
import { setupBenchmark } from "./tabs/dsa.js";
import { loadGeography } from "./tabs/geography.js";
import { loadOverview } from "./tabs/overview.js";
import { loadPatterns } from "./tabs/patterns.js";
import { loadQuality } from "./tabs/quality.js";
import { loadTrips } from "./tabs/trips.js";

const loaders = {
  overview: loadOverview,
  patterns: loadPatterns,
  geography: loadGeography,
  trips: loadTrips,
  dsa: async () => setupBenchmark(),
  quality: loadQuality,
};
const loaded = new Set();

function setStatus(state, text) {
  const el = document.getElementById("api-status");
  el.dataset.state = state;
  el.querySelector(".status-text").textContent = text;
  document.getElementById("offline-banner").hidden = state !== "offline";
}

async function loadTab(name) {
  if (loaded.has(name)) return;
  loaded.add(name);
  try {
    await loaders[name]();
  } catch (e) {
    loaded.delete(name);   // allow a retry on the next visit
    console.error(`Failed to load ${name}:`, e);
    if (e.status === 0 || e.status === 503) setStatus("offline", "API offline");
  }
}

// ── Tabs (WAI-ARIA tabs pattern: arrow keys move between tabs) ─────────────
function selectTab(btn, { focus = false } = {}) {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  tabs.forEach((t) => {
    const on = t === btn;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  });
  if (focus) btn.focus();
  const name = btn.getAttribute("aria-controls").replace("tab-", "");
  history.replaceState(null, "", `#${name}`);
  loadTab(name);
}

function setupTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  tabs.forEach((btn, i) => {
    btn.addEventListener("click", () => selectTab(btn));
    btn.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (step) selectTab(tabs[(i + step + tabs.length) % tabs.length], { focus: true });
      if (e.key === "Home") selectTab(tabs[0], { focus: true });
      if (e.key === "End") selectTab(tabs[tabs.length - 1], { focus: true });
    });
  });
  const fromHash = document.getElementById(`tab-btn-${location.hash.slice(1)}`);
  selectTab(fromHash ?? tabs[0]);
}

async function showPeriod() {
  const trend = await api.dailyTrend();
  const dates = trend.map((d) => d.pickup_date).sort();
  if (!dates.length) return;
  const opts = { month: "long", year: "numeric" };
  const first = fmt.date(dates[0], opts);
  const last = fmt.date(dates[dates.length - 1], opts);
  const period = first === last ? first : `${first} – ${last}`;
  document.getElementById("data-period").textContent = `NYC yellow taxi trips · ${period}`;
  document.getElementById("footer-period").textContent = period;
}

(async function init() {
  initTheme(document.getElementById("theme-toggle"));
  setupTabs();
  try {
    await api.summary();
    setStatus("live", "Live");
    await showPeriod();
  } catch (e) {
    setStatus("offline", "API offline");
  }
})();
