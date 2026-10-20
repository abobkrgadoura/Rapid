/**
 * Browser-only wrapper around navigator.geolocation.getCurrentPosition.
 * Resolves instead of throwing, so the caller can branch on a reason.
 */

export type PositionFix = {
  latitude: number;
  longitude: number;
  /** Null when the device does not report an accuracy radius. */
  accuracyMeters: number | null;
};

export type PositionFailure =
  | "unsupported"
  | "insecure"
  | "denied"
  | "unavailable"
  | "timeout";

export type PositionResult =
  | { ok: true; fix: PositionFix }
  | { ok: false; reason: PositionFailure };

export const POSITION_FAILURE_MESSAGES: Record<PositionFailure, string> = {
  unsupported: "This device can't share its location.",
  insecure:
    "Location needs a secure (HTTPS) connection. Open the app over HTTPS and try again.",
  denied:
    "Location is blocked. Allow location access for this app in your browser settings, then try again.",
  unavailable: "Your location isn't available right now. Move to open sky and try again.",
  timeout: "Finding your location took too long. Try again.",
};

/** Fresh, high-accuracy fix. A cached position is never accepted for a handoff. */
export function readCurrentPosition(timeoutMs = 15_000): Promise<PositionResult> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      resolve({ ok: false, reason: "unsupported" });
      return;
    }
    if (!window.isSecureContext) {
      resolve({ ok: false, reason: "insecure" });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          resolve({ ok: false, reason: "unavailable" });
          return;
        }
        resolve({
          ok: true,
          fix: {
            latitude,
            longitude,
            accuracyMeters:
              Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
          },
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          resolve({ ok: false, reason: "denied" });
        } else if (error.code === error.TIMEOUT) {
          resolve({ ok: false, reason: "timeout" });
        } else {
          resolve({ ok: false, reason: "unavailable" });
        }
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
