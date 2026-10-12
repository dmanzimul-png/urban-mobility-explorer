/**
 * Fetch helpers for the backend API.
 */

// Same origin when the dashboard is served by Flask; otherwise (Live Server,
// python -m http.server) call the API on its default port.
const API_BASE =
  window.location.port === "5000" || window.location.pathname.startsWith("/api")
    ? `${window.location.origin}/api`
    : "http://127.0.0.1:5000/api";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function get(path, params) {
  const qs = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => {
    if (v !== "" && v !== null && v !== undefined) qs.append(k, v);
  });
  const url = `${API_BASE}${path}${qs.size ? `?${qs}` : ""}`;

  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new ApiError("Can't reach the API", 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  return body;
}

// Stats endpoints are precomputed and never change while the page is open.
const cache = new Map();
const cached = (path) => () => {
  if (!cache.has(path)) cache.set(path, get(path).catch((e) => { cache.delete(path); throw e; }));
  return cache.get(path);
};

export const api = {
  summary: cached("/summary"),
  dailyTrend: cached("/daily-trend"),
  byPayment: cached("/by-payment"),
  airport: cached("/airport"),
  byHour: cached("/by-hour"),
  byDay: cached("/by-day"),
  speed: cached("/speed-distribution"),
  byBorough: cached("/by-borough"),
  topZones: cached("/top-zones"),
  boroughs: cached("/boroughs"),
  dataQuality: cached("/data-quality"),
  rejectionReasons: cached("/rejection-reasons"),
  trips: (params) => get("/trips", params),
  trip: (id) => get(`/trips/${encodeURIComponent(id)}`),
  benchmark: () => get("/dsa-benchmark"),
};
