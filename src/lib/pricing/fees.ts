/**
 * Sudan pickup and zone pricing.
 *
 * Pickup: a merchant with fewer than `freeFrom` existing shipments (default 3)
 * pays `feeSdg` on the new shipment. Once they have that many, pickup is free.
 * The count is the shipments that already exist, so the first three pay and
 * the fourth does not when the threshold is 3.
 *
 * Zone: a city name in the address wins over the state name. The longest
 * matching city is used, so "الخرطوم بحري" beats "الخرطوم".
 */

export type ZoneRate = {
  stateName: string;
  cityName: string;
  feeSdg: number;
  isActive: boolean;
};

export function pickupFeeForOrderCount(
  existingOrders: number,
  feeSdg: number,
  freeFrom: number,
): number {
  if (!Number.isInteger(feeSdg) || feeSdg < 0) return 0;
  if (!Number.isInteger(existingOrders) || existingOrders < 0) return feeSdg;
  if (!Number.isInteger(freeFrom) || freeFrom < 1) return feeSdg;
  return existingOrders >= freeFrom ? 0 : feeSdg;
}

export function matchZoneFee(address: string, zones: readonly ZoneRate[]): number | null {
  const haystack = address.replace(/\s+/g, " ").trim();
  if (haystack.length < 2) return null;

  let cityHit: { fee: number; length: number } | null = null;
  let stateHit: { fee: number; length: number } | null = null;

  for (const zone of zones) {
    if (!zone.isActive || !Number.isInteger(zone.feeSdg) || zone.feeSdg < 0) continue;
    const city = zone.cityName.trim();
    const state = zone.stateName.trim();
    if (city.length >= 2 && haystack.includes(city)) {
      if (!cityHit || city.length > cityHit.length) {
        cityHit = { fee: zone.feeSdg, length: city.length };
      }
    } else if (state.length >= 2 && haystack.includes(state)) {
      if (!stateHit || state.length > stateHit.length) {
        stateHit = { fee: zone.feeSdg, length: state.length };
      }
    }
  }

  return cityHit?.fee ?? stateHit?.fee ?? null;
}

export function sdgToMoney(amount: number): string {
  return `${amount.toFixed(2)}`;
}

/** Launch rates. Khartoum is 3,000 SDG and Port Sudan is 5,000 SDG. */
export const SUDAN_LAUNCH_ZONES: readonly ZoneRate[] = [
  { stateName: "ولاية الخرطوم", cityName: "الخرطوم", feeSdg: 3000, isActive: true },
  { stateName: "ولاية الخرطوم", cityName: "أم درمان", feeSdg: 3000, isActive: true },
  { stateName: "ولاية الخرطوم", cityName: "الخرطوم بحري", feeSdg: 3200, isActive: true },
  { stateName: "ولاية البحر الأحمر", cityName: "بورتسودان", feeSdg: 5000, isActive: true },
  { stateName: "ولاية الجزيرة", cityName: "ود مدني", feeSdg: 4000, isActive: true },
  { stateName: "ولاية نهر النيل", cityName: "عطبرة", feeSdg: 4500, isActive: true },
];
