/**
 * Path encoded by the waybill QR and used by the public tracking pages.
 * The code is already a canonical tracking token (letters, digits, hyphen).
 */
export function trackingPagePath(trackingCode: string): string {
  return `/track/${trackingCode}`;
}

/**
 * QR payload. When NEXT_PUBLIC_SITE_URL is an absolute origin, the code is a
 * full URL a phone can open from a printed label. Otherwise it is the
 * tracking path itself.
 */
export function trackingQrPayload(trackingCode: string): string {
  const path = trackingPagePath(trackingCode);
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ?? "";
  if (/^https?:\/\//i.test(site)) return `${site}${path}`;
  return path;
}
