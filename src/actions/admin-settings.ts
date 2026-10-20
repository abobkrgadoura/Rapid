"use server";

import { revalidatePath } from "next/cache";

import { adminClient, adminRpc } from "@/lib/admin/rpc";
import { cleanFleetInput, cleanPricingInput } from "@/lib/admin/pricing";
import type { AdminErrorCode, AdminResult } from "@/lib/admin/types";

function fail(error: AdminErrorCode): { ok: false; error: AdminErrorCode } {
  return { ok: false, error };
}

function refresh() {
  revalidatePath("/admin/settings");
  revalidatePath("/admin/staff");
  revalidatePath("/merchant/orders/new");
}

/** Replace the zone matrix and the pickup-fee rule. Admin session only. */
export async function savePricingSettings(
  input: unknown,
): Promise<AdminResult<{ saved: true }>> {
  const clean = cleanPricingInput(input);
  if (!clean) return fail("invalid");

  const ready = await adminClient();
  if (!ready.ok) return fail(ready.error);

  const result = await adminRpc(ready.client.supabase, "admin_save_pricing", {
    p_zones: clean.zones.map((zone) => ({
      state_name: zone.stateName,
      city_name: zone.cityName,
      fee_sdg: zone.feeSdg,
      is_active: zone.isActive,
    })),
    p_pickup_fee: clean.pickupFeeSdg,
    p_free_from: clean.freeFrom,
  });
  if ("error" in result) return fail(result.error);

  refresh();
  return { ok: true, saved: true };
}

/** Platform default for a new driver's cash ceiling. */
export async function saveFleetRules(
  input: unknown,
): Promise<AdminResult<{ saved: true }>> {
  const maxCash = cleanFleetInput(input);
  if (maxCash === null) return fail("invalid_cash_limit");

  const ready = await adminClient();
  if (!ready.ok) return fail(ready.error);

  const result = await adminRpc(ready.client.supabase, "admin_save_fleet_rules", {
    p_default_max_cash: maxCash,
  });
  if ("error" in result) return fail(result.error);

  refresh();
  return { ok: true, saved: true };
}
