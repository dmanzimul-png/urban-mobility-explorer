/**
 * Number and date formatting shared by every tab.
 */

const nf = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const moneyCompact = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1,
});
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const fmt = {
  num: (v) => nf.format(v ?? 0),
  compact: (v) => compact.format(v ?? 0),
  money: (v) => money.format(v ?? 0),
  moneyCompact: (v) => moneyCompact.format(v ?? 0),
  dec: (v, d = 1) => (v ?? 0).toFixed(d),
  pct: (part, total, d = 1) => (total ? `${((part / total) * 100).toFixed(d)}%` : "0%"),
  hour: (h) => `${String(h).padStart(2, "0")}:00`,
  hour12: (h) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`,
  // pickup_date strings are plain YYYY-MM-DD; format in UTC so the viewer's
  // timezone can't shift them by a day.
  date: (s, opts = { month: "short", day: "numeric" }) =>
    new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" }),
  dateTime: (s) => (s ? s.slice(0, 16).replace("T", " ") : "—"),
  label: (key) => key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
};

export const PAYMENT_LABELS = {
  1: "Credit card", 2: "Cash", 3: "No charge", 4: "Dispute", 5: "Unknown", 6: "Voided",
};

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Escape text before putting API data into innerHTML. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
