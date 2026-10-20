/**
 * Tracking codes are `RP` + 10 hex characters today (see the orders table
 * default). The check is looser than that on purpose so a future format does
 * not strand scanned labels, but it still rejects anything that could be
 * confused with a path, a query string, or markup.
 */
const TRACKING_CODE = /^[A-Z0-9][A-Z0-9-]{3,31}$/;

/**
 * Accepts a bare code ("rp1a2b3c4d5e"), or the text a QR label would encode:
 * a tracking URL ("https://host/track/RP1A2B3C4D5E?x=1"). Returns the
 * canonical upper-case code, or null when the input is not a plausible code.
 */
export function normalizeTrackingCode(input: string): string | null {
  let candidate = input.trim();
  if (candidate.length === 0 || candidate.length > 512) return null;

  if (/[/?#]/.test(candidate)) {
    const withoutQuery = candidate.split(/[?#]/, 1)[0] ?? "";
    const segments = withoutQuery.split("/").filter(Boolean);
    candidate = segments[segments.length - 1] ?? "";
  }

  let decoded = candidate;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    return null;
  }

  const code = decoded.trim().toUpperCase();
  return TRACKING_CODE.test(code) ? code : null;
}
