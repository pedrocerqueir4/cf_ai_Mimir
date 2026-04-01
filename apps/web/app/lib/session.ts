const RESTORE_PATH_KEY = "mimir-restore-path";

/**
 * Returns the previously stored path (e.g. the page the user was on before
 * being redirected to sign-in) and clears it from storage.
 * Returns null if no path was saved.
 */
export function getRestorePath(): string | null {
  if (typeof window === "undefined") return null;
  const path = sessionStorage.getItem(RESTORE_PATH_KEY);
  if (path) {
    sessionStorage.removeItem(RESTORE_PATH_KEY);
  }
  return path;
}

/**
 * Saves the current path so it can be restored after sign-in (UX-04).
 */
export function saveRestorePath(path: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(RESTORE_PATH_KEY, path);
}
