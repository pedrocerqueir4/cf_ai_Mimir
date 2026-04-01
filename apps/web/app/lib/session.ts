const RESTORE_KEY = "mimir-restore-path";

/**
 * Saves the current path before redirecting to sign-in on session expiry.
 * Used for path restoration after re-authentication (D-03, UX-04).
 */
export function handleSessionExpiry(currentPath: string): void {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(RESTORE_KEY, currentPath);
  }
}

/**
 * Returns the previously stored path (e.g. the page the user was on before
 * being redirected to sign-in) and clears it from storage.
 * Returns null if no path was saved.
 */
export function getRestorePath(): string | null {
  if (typeof window === "undefined") return null;
  const path = sessionStorage.getItem(RESTORE_KEY);
  if (path) {
    sessionStorage.removeItem(RESTORE_KEY);
  }
  return path;
}
