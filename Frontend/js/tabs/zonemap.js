import { esc, fmt } from "../format.js";
import { token } from "../theme.js";

// Zone map (Leaflet + taxi_zones boundaries).
// Data comes from the Flask API: /api/zone-shapes (GeoJSON) and /api/zone-counts (pickups per zone).
const API_BASE = location.port === "5000" ? "" : "http://127.0.0.1:5000";
let map = null;
let zoneLayer = null;
let shapesCache = null;
let leafletReady = null;

const okJson = (r) => {
  if (!r.ok) throw new Error(`API returned ${r.status}`);
  return r.json();
};

// Load Leaflet from a CDN only when the Geography tab needs it (no change to index.html).
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (!leafletReady) {
    leafletReady = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(css);
      const js = document.createElement("script");
      js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      js.onload = resolve;
      js.onerror = () => reject(new Error("Could not load the map library (check your internet connection)"));
      document.head.appendChild(js);
    });
  }
  return leafletReady;
}

function ensureMapCard() {
  let card = document.getElementById("zone-map-card");
  if (card) return card;
  card = document.createElement("section");
  card.id = "zone-map-card";
  card.style.margin = "16px 0";
  card.innerHTML =
    `<h3 style="margin:0 0 4px">Pickup map: where trips start</h3>` +
    `<p id="zone-map-note" style="margin:0 0 8px;font-size:.85rem;opacity:.75">` +
    `Darker zones have more pickups. Hover a zone for details.</p>` +
    `<div id="zone-map" style="height:480px;border-radius:8px"></div>`;
  document.getElementById("geo-insights").insertAdjacentElement("afterend", card);
  return card;
}

export function showMapError(err) {
  ensureMapCard();
  document.getElementById("zone-map-note").textContent = `Map unavailable: ${err.message}`;
}

export async function renderMap() {
  ensureMapCard();
  await loadLeaflet();

  if (!shapesCache) shapesCache = await fetch(`${API_BASE}/api/zone-shapes`).then(okJson);
  const rows = await fetch(`${API_BASE}/api/zone-counts`).then(okJson);

  // Match by zone NAME. The lookup lists some places under several IDs
  // (e.g. 56/57, 103/104/105), so names combine them correctly.
  const byZone = {};
  rows.forEach((r) => { byZone[r.zone] = r; });
  const max = Math.max(1, ...rows.map((r) => r.trips));
  const color = token("--series-1") || "#c2410c";

  if (!map) {
    map = L.map("zone-map").setView([40.72, -73.95], 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
  }
  if (zoneLayer) map.removeLayer(zoneLayer);

  zoneLayer = L.geoJSON(shapesCache, {
    style: (f) => {
      const r = byZone[f.properties.zone];
      const share = r ? Math.sqrt(r.trips / max) : 0;       // sqrt so mid-size zones stay visible
      return { color: "#666", weight: 0.6, fillColor: color, fillOpacity: 0.06 + 0.84 * share };
    },
    onEachFeature: (f, layer) => {
      const r = byZone[f.properties.zone];
      layer.bindTooltip(
        `<strong>${esc(f.properties.zone)}</strong> (${esc(f.properties.borough)})<br>` +
        (r ? `${esc(fmt.num(r.trips))} pickups<br>Avg fare ${esc(fmt.money(r.avg_fare))}` : "No pickups recorded"),
        { sticky: true },
      );
    },
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 200);   // fixes sizing if the tab was hidden when created
}
