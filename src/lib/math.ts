/**
 * Great-circle distance on a spherical earth.
 * Geo-fencing compares this result with an allowed radius in meters.
 * It is not a road distance.
 */

const EARTH_RADIUS_METERS = 6_371_000;

export type GeoPoint = {
  latitude: number;
  longitude: number;
};

function assertLatitude(latitude: number): void {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError("Latitude must be a finite number from -90 to 90.");
  }
}

function assertLongitude(longitude: number): void {
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError("Longitude must be a finite number from -180 to 180.");
  }
}

export function assertGeoPoint(point: GeoPoint): void {
  assertLatitude(point.latitude);
  assertLongitude(point.longitude);
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Haversine distance in meters between two WGS84 points.
 * Equal coordinates return 0. The antimeridian is handled by the longitude delta.
 */
export function haversineMeters(origin: GeoPoint, destination: GeoPoint): number {
  assertGeoPoint(origin);
  assertGeoPoint(destination);

  const latitude1 = toRadians(origin.latitude);
  const latitude2 = toRadians(destination.latitude);
  const deltaLatitude = latitude2 - latitude1;
  const deltaLongitude = toRadians(destination.longitude - origin.longitude);

  const sinLatitude = Math.sin(deltaLatitude / 2);
  const sinLongitude = Math.sin(deltaLongitude / 2);
  const h =
    sinLatitude * sinLatitude +
    Math.cos(latitude1) * Math.cos(latitude2) * sinLongitude * sinLongitude;
  const clamped = Math.min(1, Math.max(0, h));
  const arc = 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));

  return EARTH_RADIUS_METERS * arc;
}

/**
 * True when the driver is inside the destination radius, including the boundary.
 * `radiusMeters` is the geo-fence radius and must be finite and >= 0.
 */
export function isWithinGeofence(
  driver: GeoPoint,
  destination: GeoPoint,
  radiusMeters: number,
): boolean {
  if (!Number.isFinite(radiusMeters) || radiusMeters < 0) {
    throw new RangeError("Geo-fence radius must be a finite number of meters >= 0.");
  }

  return haversineMeters(driver, destination) <= radiusMeters;
}
