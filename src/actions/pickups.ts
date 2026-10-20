"use server";

import { revalidatePath } from "next/cache";

import { getAuthSession } from "@/lib/auth/session";
import { canonicalMoney } from "@/lib/format-money";
import { createClient } from "@/utils/supabase/server";

export type PickupActionResult =
  | { ok: true; token: string; count: number; fee: string; verified: boolean }
  | { ok: false; error: "unauthorized" | "empty" | "unavailable" | "mismatch" | "failed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function whole(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function readPayload(data: unknown): PickupActionResult {
  if (!isRecord(data)) return { ok: false, error: "failed" };
  const token = data.token;
  const count = whole(data.pending_count);
  const fee = canonicalMoney(data.pickup_fee);
  if (typeof token !== "string" || !/^[A-F0-9]{16}$/.test(token) || count === null || !fee) {
    return { ok: false, error: "failed" };
  }
  return {
    ok: true,
    token,
    count,
    fee,
    verified: data.verified === true,
  };
}

function mapError(message: string | undefined, code: string | undefined): PickupActionResult {
  if (code === "42P01" || code === "42883" || code === "PGRST202" || code === "PGRST205") {
    return { ok: false, error: "unavailable" };
  }
  if (message?.includes("rapid:empty")) return { ok: false, error: "empty" };
  if (message?.includes("rapid:mismatch")) return { ok: false, error: "mismatch" };
  if (message?.includes("rapid:unauthorized") || message?.includes("rapid:forbidden")) {
    return { ok: false, error: "unauthorized" };
  }
  return { ok: false, error: "failed" };
}

async function merchantClient() {
  const session = await getAuthSession();
  if (session.status !== "ready" || session.profile.role !== "merchant") return null;
  return createClient();
}

export async function requestMerchantPickup(): Promise<PickupActionResult> {
  const supabase = await merchantClient();
  if (!supabase) return { ok: false, error: "unauthorized" };

  const { data, error } = await supabase.rpc("request_merchant_pickup");
  if (error) {
    console.error("request pickup", error.code, error.message);
    return mapError(error.message, error.code);
  }

  revalidatePath("/merchant/pickups");
  return readPayload(data);
}

export async function verifyHandoverQr(token: string): Promise<PickupActionResult> {
  const supabase = await merchantClient();
  if (!supabase) return { ok: false, error: "unauthorized" };

  const cleaned = token.toUpperCase().replace(/[^A-F0-9]/g, "");
  const { data, error } = await supabase.rpc("verify_handover_qr", { p_token: cleaned });
  if (error) {
    console.error("verify handover", error.code, error.message);
    return mapError(error.message, error.code);
  }

  revalidatePath("/merchant/pickups");
  revalidatePath("/merchant/orders");
  return readPayload(data);
}
