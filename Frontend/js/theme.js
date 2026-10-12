/**
 * Light/dark theme: follows the OS by default, the toggle overrides it.
 * Charts read their colors from CSS variables, so they re-render on change.
 */

const listeners = new Set();
const media = window.matchMedia("(prefers-color-scheme: dark)");

export function isDark() {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === "dark" : media.matches;
}

export function onThemeChange(fn) {
  listeners.add(fn);
}

function notify() {
  listeners.forEach((fn) => fn());
}

export function initTheme(button) {
  const sync = () => button.setAttribute("aria-pressed", String(isDark()));
  sync();

  button.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("ume-theme", next); } catch {}
    sync();
    notify();
  });

  media.addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) { sync(); notify(); }
  });
}

/** Read the current value of a CSS custom property. */
export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
