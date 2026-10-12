/**
 * Small DOM helpers shared by the tabs.
 */

import { esc } from "../format.js";

/** Stat tile markup. `note` is optional secondary text. */
export function tile(label, value, note = "") {
  return `<div class="tile">
    <div class="tile-label">${esc(label)}</div>
    <div class="tile-value" title="${esc(value)}">${esc(value)}</div>
    ${note ? `<div class="tile-note">${esc(note)}</div>` : ""}
  </div>`;
}

export function skeletonTiles(el, n) {
  el.innerHTML = Array.from({ length: n }, () =>
    `<div class="tile skeleton"><div class="tile-label">&nbsp;</div><div class="tile-value">0</div></div>`,
  ).join("");
}

/** Insight card; `html` may contain <strong> built from escaped values. */
export function insight(html) {
  return `<p class="insight">${html}</p>`;
}
