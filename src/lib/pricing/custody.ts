import type { SupabaseClient } from "@supabase/supabase-js";

import { cashCustodyExceeded } from "@/lib/locale/sudan";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wholeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function missingColumn(code: string | undefined): boolean {
  return code === "42703" || code === "PGRST204";
}

/**
 * True when this driver is over the cash ceiling and must not take new COD
 * work. A missing 0008 column does not block dispatch; the database trigger
 * is the gate once the migration is applied.
 */
export async function driverBlockedFromCod(
  supabase: SupabaseClient,
  driverId: string,
): Promise<boolean> {
  const row = await supabase
    .from("profiles")
    .select("current_cash_in_hand, max_cash_limit")
    .eq("id", driverId)
    .eq("role", "driver")
    .maybeSingle();

  if (row.error) {
    if (!missingColumn(row.error.code)) {
      console.error("driver cash ceiling", row.error.code, row.error.message);
    }
    return false;
  }
  if (!isRecord(row.data)) return false;

  const current = wholeNumber(row.data.current_cash_in_hand);
  const max = wholeNumber(row.data.max_cash_limit);
  if (current === null || max === null) return false;
  return cashCustodyExceeded(current, max);
}

export async function shipmentBatchHasCod(
  supabase: SupabaseClient,
  trackingCodes: readonly string[],
): Promise<boolean> {
  if (trackingCodes.length === 0) return false;
  const rows = await supabase
    .from("orders_readable")
    .select("payment_type")
    .in("tracking_code", [...trackingCodes]);

  if (rows.error || !Array.isArray(rows.data)) return false;
  return rows.data.some((row) => isRecord(row) && row.payment_type === "cod");
}
