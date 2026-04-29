const STORAGE_KEY = "mimir-theme";

export type Theme = "light" | "dark" | "system";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem(STORAGE_KEY) as Theme) ?? "system";
}

export function setStoredTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  // Dual-write per CONTEXT theming-reconciliation:
  //   class="dark" — preserves any leftover Tailwind .dark: utilities
  //   data-mode="dark" — Kumo's [data-mode="dark"] selector (theme-kumo.css)
  root.classList.toggle("dark", isDark);
  if (isDark) {
    root.setAttribute("data-mode", "dark");
  } else {
    root.removeAttribute("data-mode");
  }
}
