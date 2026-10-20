import { haversineMeters, type GeoPoint } from "@/lib/math";
import { publicAreaFromDropoff } from "@/lib/orders/public-area";

/** A logged attempt inside this radius counts as at the door. */
export const ATTEMPT_FENCE_METERS = 200;

const CITY_STATE: ReadonlyArray<{ needle: string; state: string }> = [
  { needle: "بورتسودان", state: "ولاية البحر الأحمر" },
  { needle: "ود مدني", state: "ولاية الجزيرة" },
  { needle: "عطبرة", state: "ولاية نهر النيل" },
  { needle: "كسلا", state: "ولاية كسلا" },
  { needle: "القضارف", state: "ولاية القضارف" },
  { needle: "سنار", state: "ولاية سنار" },
  { needle: "كوستي", state: "ولاية النيل الأبيض" },
  { needle: "الدمازين", state: "ولاية النيل الأزرق" },
  { needle: "الأبيض", state: "ولاية شمال كردفان" },
  { needle: "نيالا", state: "ولاية جنوب دارفور" },
  { needle: "الفاشر", state: "ولاية شمال دارفور" },
  { needle: "الجنينة", state: "ولاية غرب دارفور" },
  { needle: "دنقلا", state: "ولاية الشمالية" },
  { needle: "بحري", state: "ولاية الخرطوم" },
  { needle: "أم درمان", state: "ولاية الخرطوم" },
  { needle: "ام درمان", state: "ولاية الخرطوم" },
  { needle: "الخرطوم", state: "ولاية الخرطوم" },
];

const NAMED_STATES = [
  "ولاية الخرطوم",
  "ولاية الجزيرة",
  "ولاية البحر الأحمر",
  "ولاية نهر النيل",
  "ولاية الشمالية",
  "ولاية كسلا",
  "ولاية القضارف",
  "ولاية سنار",
  "ولاية النيل الأبيض",
  "ولاية النيل الأزرق",
  "ولاية شمال كردفان",
  "ولاية جنوب كردفان",
  "ولاية غرب كردفان",
  "ولاية شمال دارفور",
  "ولاية جنوب دارفور",
  "ولاية غرب دارفور",
  "ولاية وسط دارفور",
  "ولاية شرق دارفور",
] as const;

function finitePair(latText: string, lngText: string): GeoPoint | null {
  const latitude = Number(latText);
  const longitude = Number(lngText);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (Math.abs(latitude) < 0.01 && Math.abs(longitude) < 0.01) return null;
  return { latitude, longitude };
}

/**
 * Pulls a WGS84 point out of a shared map link when the link actually
 * contains coordinates. A place name search has none, and returns null.
 */
export function coordsFromMapsUrl(url: string | null): GeoPoint | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const haystack = `${parsed.pathname}?${parsed.search}`;
  const patterns = [
    /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /[?&](?:q|query|ll|destination|daddr)=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /!3d(-?\d{1,3}(?:\.\d+))!4d(-?\d{1,3}(?:\.\d+))/,
  ];
  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (!match) continue;
    const point = finitePair(match[1], match[2]);
    if (point) return point;
  }
  return null;
}

/** State or area used to cluster a route. Never returns the raw street. */
export function zoneFromText(address: string): string {
  const text = address.replace(/\s+/g, " ").trim();
  for (const state of NAMED_STATES) {
    if (text.includes(state)) return state;
  }
  for (const city of CITY_STATE) {
    if (text.includes(city.needle)) return city.state;
  }
  const area = publicAreaFromDropoff(text);
  return area.trim() || "منطقة غير محددة";
}

export function distanceMeters(origin: GeoPoint, destination: GeoPoint): number {
  return Math.round(haversineMeters(origin, destination));
}
