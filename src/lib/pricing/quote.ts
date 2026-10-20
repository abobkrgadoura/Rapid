import type { SupabaseClient } from "@supabase/supabase-js";

import { COUNTRY_CODE } from "@/lib/locale/sudan";
import { matchZoneFee, pickupFeeForOrderCount, sdgToMoney, type ZoneRate } from "@/lib/pricing/fees";

export type OrderPricing = {
  deliveryFee: string;
  pickupFee: string;
  countryCode: typeof COUNTRY_CODE;
  /** True when platform_settings could be read, so the new order columns exist. */
  dynamic: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wholeSdg(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

/**
 * Prices a new merchant shipment from the admin zone matrix and the pickup
 * rule. When migration 0008 is not applied yet, the merchant's typed delivery
 * fee is kept and pickup stays zero so order creation still works.
 */
export async function priceNewOrder(
  supabase: SupabaseClient,
  merchantId: string,
  dropoffAddress: string,
  enteredDeliveryFee: string,
): Promise<OrderPricing> {
  const fallback: OrderPricing = {
    deliveryFee: enteredDeliveryFee,
    pickupFee: "0.00",
    countryCode: COUNTRY_CODE,
    dynamic: false,
  };

  const settings = await supabase
    .from("platform_settings")
    .select("pickup_fee_sdg, pickup_fee_free_from")
    .eq("id", true)
    .maybeSingle();

  if (settings.error || !isRecord(settings.data)) return fallback;

  const feeSdg = wholeSdg(settings.data.pickup_fee_sdg);
  const freeFrom = wholeSdg(settings.data.pickup_fee_free_from);
  if (feeSdg === null || freeFrom === null || freeFrom < 1) return fallback;

  const existing = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("merchant_id", merchantId)
    .neq("status", "cancelled");

  if (existing.error || typeof existing.count !== "number") return fallback;

  const zonesResult = await supabase
    .from("shipping_zones")
    .select("state_name, city_name, fee_sdg, is_active")
    .eq("is_active", true);

  const zones: ZoneRate[] = [];
  if (!zonesResult.error && Array.isArray(zonesResult.data)) {
    for (const row of zonesResult.data) {
      if (!isRecord(row)) continue;
      const fee = wholeSdg(row.fee_sdg);
      if (fee === null || typeof row.state_name !== "string") continue;
      zones.push({
        stateName: row.state_name,
        cityName: typeof row.city_name === "string" ? row.city_name : "",
        feeSdg: fee,
        isActive: row.is_active !== false,
      });
    }
  }

  const zoneFee = matchZoneFee(dropoffAddress, zones);
  const pickup = pickupFeeForOrderCount(existing.count, feeSdg, freeFrom);

  return {
    deliveryFee: zoneFee === null ? enteredDeliveryFee : sdgToMoney(zoneFee),
    pickupFee: sdgToMoney(pickup),
    countryCode: COUNTRY_CODE,
    dynamic: true,
  };
}
