import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Generate a v4-style UUID that works in both secure and non-secure browser contexts.
 *
 * `crypto.randomUUID()` is only exposed in secure contexts (HTTPS, `localhost`,
 * `127.0.0.1`). When the dev server is accessed via a LAN IP over plain HTTP
 * (e.g. from a mobile device on the same Wi-Fi), `window.crypto.randomUUID` is
 * `undefined` and calling it throws `TypeError: crypto.randomUUID is not a function`.
 *
 * This helper prefers the native implementation when available and falls back to
 * `crypto.getRandomValues` (available in all modern browsers regardless of secure
 * context) or `Math.random` as a last resort. The output is always formatted as
 * an RFC 4122 v4 UUID, so any downstream code that relies on the shape of the id
 * continues to work identically.
 */
export function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 v4: set version (bits 12-15 of time_hi_and_version to 0100)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // RFC 4122 v4: set variant (bits 6-7 of clock_seq_hi_and_reserved to 10)
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return (
    `${hex.slice(0, 4).join("")}-` +
    `${hex.slice(4, 6).join("")}-` +
    `${hex.slice(6, 8).join("")}-` +
    `${hex.slice(8, 10).join("")}-` +
    `${hex.slice(10, 16).join("")}`
  );
}
