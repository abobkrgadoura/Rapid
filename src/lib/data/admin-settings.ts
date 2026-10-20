import { getAuthSession } from "@/lib/auth/session";
import { defaultPricing, type SettingsSnapshot, type ZoneDraft } from "@/lib/admin/pricing";
import { createClient } from "@/utils/supabase/server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function whole(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return fallback;
}

function schemaMissing(code: string | undefined): boolean {
  return code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205";
}

/** Admin session only. Merchants never receive the settings editor payload. */
export async function loadAdminSettings(): Promise<
  { ok: true; data: SettingsSnapshot } | { ok: false }
> {
  const session = await getAuthSession();
  if (session.status !== "ready" || session.profile.role !== "admin") return { ok: false };

  const db = await createClient();
  const settings = await db
    .from("platform_settings")
    .select("pickup_fee_sdg, pickup_fee_free_from, default_max_cash_sdg")
    .eq("id", true)
    .maybeSingle();

  if (settings.error && schemaMissing(settings.error.code)) {
    return { ok: true, data: { migrationApplied: false, pricing: defaultPricing() } };
  }
  if (settings.error || !isRecord(settings.data)) {
    console.error("admin settings", settings.error?.message);
    return { ok: false };
  }

  const zones = await db
    .from("shipping_zones")
    .select("state_name, city_name, fee_sdg, is_active, sort_order")
    .order("sort_order", { ascending: true });

  if (zones.error && schemaMissing(zones.error.code)) {
    return { ok: true, data: { migrationApplied: false, pricing: defaultPricing() } };
  }
  if (zones.error || !Array.isArray(zones.data)) {
    console.error("admin zones", zones.error?.message);
    return { ok: false };
  }

  const defaults = defaultPricing();
  const parsed: ZoneDraft[] = [];
  for (const row of zones.data) {
    if (!isRecord(row) || typeof row.state_name !== "string") continue;
    parsed.push({
      stateName: row.state_name.trim(),
      cityName: typeof row.city_name === "string" ? row.city_name.trim() : "",
      feeSdg: whole(row.fee_sdg, 0),
      isActive: row.is_active !== false,
    });
  }

  return {
    ok: true,
    data: {
      migrationApplied: true,
      pricing: {
        pickupFeeSdg: whole(settings.data.pickup_fee_sdg, defaults.pickupFeeSdg),
        pickupFeeFreeFrom: whole(settings.data.pickup_fee_free_from, defaults.pickupFeeFreeFrom),
        defaultMaxCashSdg: whole(settings.data.default_max_cash_sdg, defaults.defaultMaxCashSdg),
        zones: parsed,
      },
    },
  };
}
