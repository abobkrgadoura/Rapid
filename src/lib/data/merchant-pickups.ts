import { getAuthSession } from "@/lib/auth/session";
import { canonicalMoney } from "@/lib/format-money";
import {
  DEFAULT_PICKUP_FEE_SDG,
  DEFAULT_PICKUP_FREE_FROM,
} from "@/lib/locale/sudan";
import { decodeRecipientDropoff } from "@/lib/orders/recipient";
import { sdgToMoney } from "@/lib/pricing/fees";
import { createClient } from "@/utils/supabase/server";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PickupParcel = {
  id: string;
  trackingCode: string;
  customerName: string;
};

export type OpenPickupRequest = {
  token: string;
  count: number;
  fee: string;
  verified: boolean;
};

export type MerchantPickupsView = {
  readyCount: number;
  pickedUpToday: number;
  feeSdg: number;
  freeFrom: number;
  /** True when this pending batch is under the free threshold. */
  feeApplies: boolean;
  batchFee: string;
  migrationApplied: boolean;
  openRequest: OpenPickupRequest | null;
  pending: PickupParcel[];
};

export type LoadResult<T> = { ok: true; data: T } | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function missingSchema(code: string | undefined): boolean {
  return code === "42703" || code === "42P01" || code === "PGRST204" || code === "PGRST205";
}

function whole(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return fallback;
}

/** Khartoum is UTC+2 year round. */
function khartoumDayStartIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Khartoum",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}T00:00:00+02:00`;
}

function money(value: unknown): string {
  return canonicalMoney(value) ?? sdgToMoney(0);
}

export async function loadMerchantPickups(): Promise<LoadResult<MerchantPickupsView>> {
  const session = await getAuthSession();
  if (session.status !== "ready" || session.profile.role !== "merchant") {
    return { ok: false };
  }

  const supabase = await createClient();
  const dayStart = khartoumDayStartIso();

  const [ready, collected, settings, pendingRows, openRequest] = await Promise.all([
    supabase
      .from("orders_readable")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("orders_readable")
      .select("id", { count: "exact", head: true })
      .gte("picked_up_at", dayStart)
      .not("picked_up_at", "is", null),
    supabase
      .from("platform_settings")
      .select("pickup_fee_sdg, pickup_fee_free_from")
      .eq("id", true)
      .maybeSingle(),
    supabase
      .from("orders_readable")
      .select("id, tracking_code, dropoff_address")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(30),
    supabase
      .from("pickup_requests")
      .select("handover_qr_token, pending_count, pickup_fee, handover_verified_at, status")
      .eq("status", "requested")
      .maybeSingle(),
  ]);

  if (ready.error || ready.count === null || collected.error || collected.count === null) {
    console.error("merchant pickups", ready.error?.message, collected.error?.message);
    return { ok: false };
  }

  const feeSdg = settings.error
    ? DEFAULT_PICKUP_FEE_SDG
    : whole(isRecord(settings.data) ? settings.data.pickup_fee_sdg : null, DEFAULT_PICKUP_FEE_SDG);
  const freeFrom = settings.error
    ? DEFAULT_PICKUP_FREE_FROM
    : whole(
        isRecord(settings.data) ? settings.data.pickup_fee_free_from : null,
        DEFAULT_PICKUP_FREE_FROM,
      );

  const pending: PickupParcel[] = [];
  if (!pendingRows.error && Array.isArray(pendingRows.data)) {
    for (const row of pendingRows.data) {
      if (!isRecord(row)) continue;
      if (typeof row.id !== "string" || !UUID.test(row.id)) continue;
      if (typeof row.tracking_code !== "string" || typeof row.dropoff_address !== "string") {
        continue;
      }
      const recipient = decodeRecipientDropoff(row.dropoff_address);
      pending.push({
        id: row.id.toLowerCase(),
        trackingCode: row.tracking_code,
        customerName: recipient.customerName,
      });
    }
  }

  let request: OpenPickupRequest | null = null;
  const migrationApplied = !missingSchema(openRequest.error?.code);
  if (migrationApplied && isRecord(openRequest.data)) {
    const token = openRequest.data.handover_qr_token;
    const count = whole(openRequest.data.pending_count, 0);
    if (typeof token === "string" && /^[A-F0-9]{16}$/.test(token) && count > 0) {
      request = {
        token,
        count,
        fee: money(openRequest.data.pickup_fee),
        verified: typeof openRequest.data.handover_verified_at === "string",
      };
    }
  }
  if (openRequest.error && !missingSchema(openRequest.error.code)) {
    console.error("merchant pickup request", openRequest.error.message);
  }

  const batchCount = request?.count ?? ready.count;
  const feeApplies = batchCount < freeFrom;

  return {
    ok: true,
    data: {
      readyCount: ready.count,
      pickedUpToday: collected.count,
      feeSdg,
      freeFrom,
      feeApplies,
      batchFee: request?.fee ?? sdgToMoney(feeApplies ? feeSdg : 0),
      migrationApplied,
      openRequest: request,
      pending,
    },
  };
}
