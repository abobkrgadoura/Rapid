/**
 * Map links on an order. A merchant types them, a driver taps them, so they
 * are held to https and to well-known map hosts. The database enforces the
 * https / length rule too; the host list lives only here because map
 * providers change their share domains more often than we ship migrations.
 */

export const GPS_URL_MAX_LENGTH = 2048;

const MAP_HOSTS = [
  "maps.app.goo.gl",
  "goo.gl",
  "maps.google.com",
  "google.com",
  "google.com.eg",
  "waze.com",
  "maps.apple.com",
  "openstreetmap.org",
  "bing.com",
] as const;

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return MAP_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Returns the normalized https URL, or null when the input is not a usable
 * map link. Never throws.
 */
export function parseMapsUrl(input: string): string | null {
  const text = input.trim();
  if (text.length === 0 || text.length > GPS_URL_MAX_LENGTH) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(text)) return null;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!hostAllowed(url.hostname)) return null;

  const normalized = url.toString();
  return normalized.length <= GPS_URL_MAX_LENGTH ? normalized : null;
}

/** Form fields are optional: blank is valid and stored as null. */
export function readOptionalMapsUrl(
  input: string,
): { ok: true; url: string | null } | { ok: false } {
  if (input.trim().length === 0) return { ok: true, url: null };
  const url = parseMapsUrl(input);
  return url === null ? { ok: false } : { ok: true, url };
}

/**
 * Link to render in an <a href>. Re-validated on read so a value written by
 * any other path can never become a javascript: or data: link.
 */
export function safeMapsHref(stored: unknown): string | null {
  return typeof stored === "string" ? parseMapsUrl(stored) : null;
}

/** Fallback when an order has no map link: search the address instead. */
export function mapsSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
