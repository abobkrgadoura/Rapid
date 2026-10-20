import type { GeoPoint } from "@/lib/math";

export const NAV_APPS = ["google_maps", "waze", "apple_maps"] as const;

export type NavApp = (typeof NAV_APPS)[number];

export function isNavApp(value: unknown): value is NavApp {
  return typeof value === "string" && (NAV_APPS as readonly string[]).includes(value);
}

/**
 * Opens the driver's chosen map app. A stored Google link is used only when
 * Google Maps is the preference; Waze and Apple Maps always get a fresh link.
 */
export function navigationHref(
  app: NavApp,
  input: { gpsUrl: string | null; address: string; point: GeoPoint | null },
): string {
  const point = input.point;
  const query = point ? `${point.latitude},${point.longitude}` : input.address.trim();
  const encoded = encodeURIComponent(query || input.address);

  if (app === "waze") {
    if (point) {
      return `https://waze.com/ul?ll=${point.latitude},${point.longitude}&navigate=yes`;
    }
    return `https://waze.com/ul?q=${encoded}&navigate=yes`;
  }

  if (app === "apple_maps") {
    if (point) {
      return `https://maps.apple.com/?ll=${point.latitude},${point.longitude}&q=${encoded}`;
    }
    return `https://maps.apple.com/?q=${encoded}`;
  }

  if (input.gpsUrl) return input.gpsUrl;
  return `https://www.google.com/maps/search/?api=1&query=${encoded}`;
}
