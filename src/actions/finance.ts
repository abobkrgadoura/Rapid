"use server";

import { revalidatePath } from "next/cache";

import {
  adminClient,
  canonicalUuid,
  isMigrationPending,
  isRecord,
} from "@/lib/admin/rpc";
import { getAuthSession } from "@/lib/auth/session";
import type { FinanceError, FinanceResult } from "@/lib/finance/types";
import { canonicalMoney } from "@/lib/format-money";
import { createClient } from "@/utils/supabase/server";

/**
 * Finance writes. The signed-in role comes from the server session. Amounts
 * are read inside Postgres (settle_driver_cash, payout_merchant,
 * request_merchant_payout). The client only names which driver or merchant
 * row to settle, never a role and never a figure.
 */

function refresh() {
  revalidatePath("/admin/finance");
  revalidatePath("/admin/staff");
  revalidatePath("/merchant/wallet");
  revalidatePath("/merchant");
  revalidatePath("/driver");
}

function fail(error: FinanceError): FinanceResult {
  return { ok: false, error };
}

function mapMessage(message: string | undefined): FinanceError {
  const match = message?.match(/rapid:[a-z0-9_]+/);
  switch (match?.[0]) {
    case "rapid:unauthorized":
      return "unauthorized";
    case "rapid:forbidden":
      return "forbidden";
    case "rapid:not_found":
      return "not_found";
    case "rapid:insufficient":
      return "insufficient";
    case "rapid:conflict":
      return "conflict";
    case "rapid:invalid":
      return "invalid";
    default:
      return "failed";
  }
}

function amountOf(data: unknown): string | null {
  if (!isRecord(data)) return null;
  return canonicalMoney(data.amount);
}

export async function settleDriverCash(driverId: string): Promise<FinanceResult> {
  const id = canonicalUuid(driverId);
  if (id === null) return fail("invalid");

  const ready = await adminClient();
  if (!ready.ok) return fail(ready.error === "unauthorized" ? "unauthorized" : "forbidden");

  const { data, error } = await ready.client.supabase.rpc("settle_driver_cash", {
    p_driver_id: id,
  });
  if (error) {
    if (isMigrationPending(error)) return fail("migration_pending");
    const code = mapMessage(error.message);
    if (code === "failed") console.error("settle_driver_cash", error.code, error.message);
    return fail(code);
  }

  const amount = amountOf(data);
  if (amount === null) return fail("failed");
  refresh();
  return { ok: true, amount };
}

export async function payoutMerchant(merchantId: string): Promise<FinanceResult> {
  const id = canonicalUuid(merchantId);
  if (id === null) return fail("invalid");

  const ready = await adminClient();
  if (!ready.ok) return fail(ready.error === "unauthorized" ? "unauthorized" : "forbidden");

  const { data, error } = await ready.client.supabase.rpc("payout_merchant", {
    p_merchant_id: id,
  });
  if (error) {
    if (isMigrationPending(error)) return fail("migration_pending");
    const code = mapMessage(error.message);
    if (code === "failed") console.error("payout_merchant", error.code, error.message);
    return fail(code);
  }

  const amount = amountOf(data);
  if (amount === null) return fail("failed");
  refresh();
  return { ok: true, amount };
}

export async function requestMerchantPayout(): Promise<FinanceResult> {
  const session = await getAuthSession();
  if (session.status === "anonymous") return fail("unauthorized");
  if (session.status !== "ready" || session.profile.role !== "merchant") {
    return fail("forbidden");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_merchant_payout");
  if (error) {
    if (isMigrationPending(error)) return fail("migration_pending");
    const code = mapMessage(error.message);
    if (code === "failed") console.error("request_merchant_payout", error.code, error.message);
    return fail(code);
  }

  const amount = amountOf(data);
  if (amount === null) return fail("failed");
  refresh();
  return { ok: true, amount };
}
