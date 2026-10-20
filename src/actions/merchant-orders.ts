"use server";

import { revalidatePath } from "next/cache";

import { getAuthSession } from "@/lib/auth/session";
import { canonicalMoney } from "@/lib/format-money";
import {
  inspectMerchantEdit,
  type MerchantEditFields,
  type MerchantEditIssue,
} from "@/lib/orders/merchant-edit";
import {
  decodeDropoffNotes,
  decodeRecipientDropoff,
  encodeRecipientDropoff,
} from "@/lib/orders/recipient";
import { isOrderStatus, isPaymentType } from "@/lib/orders/status";
import { createClient } from "@/utils/supabase/server";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

export type MerchantEditError =
  | MerchantEditIssue
  | "unauthorized"
  | "forbidden"
  | "invalid"
  | "not_found"
  | "not_pending"
  | "migration_pending"
  | "failed";

export type MerchantEditResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: MerchantEditError };

function fail(error: MerchantEditError): MerchantEditResult {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function missingColumn(code: string | undefined): boolean {
  return code === "42703" || code === "PGRST204";
}

function mapRpc(message: string | undefined, code: string | undefined): MerchantEditError {
  if (code && MISSING_FUNCTION.has(code)) return "migration_pending";
  if (missingColumn(code)) return "migration_pending";
  const match = message?.match(/rapid:[a-z0-9_]+/);
  switch (match?.[0]) {
    case "rapid:unauthorized":
      return "unauthorized";
    case "rapid:forbidden":
      return "forbidden";
    case "rapid:invalid":
      return "invalid";
    case "rapid:not_found":
      return "not_found";
    case "rapid:not_pending":
      return "not_pending";
    default:
      return "failed";
  }
}

const ORDER_COLUMNS =
  "id, tracking_code, status, payment_type, product_price, dropoff_address, pieces_count";
const ORDER_COLUMNS_BASE =
  "id, tracking_code, status, payment_type, product_price, dropoff_address";

/**
 * Corrects a merchant's own order while it is still pending.
 * The role comes from the server session. merchant_edit_pending_order checks
 * the merchant and the status again. Until that function is applied, the
 * same pending-only update is written directly and is not added to history.
 */
export async function updateMerchantOrder(input: MerchantEditFields & { orderId: string }): Promise<MerchantEditResult> {
  const session = await getAuthSession();
  if (session.status === "anonymous") return fail("unauthorized");
  if (session.status !== "ready" || session.profile.role !== "merchant") return fail("forbidden");

  const orderId = typeof input?.orderId === "string" ? input.orderId.trim().toLowerCase() : "";
  if (!UUID.test(orderId)) return fail("not_found");

  const supabase = await createClient();
  const withPieces = await supabase.from("orders").select(ORDER_COLUMNS).eq("id", orderId).maybeSingle();
  const loaded = missingColumn(withPieces.error?.code)
    ? await supabase.from("orders").select(ORDER_COLUMNS_BASE).eq("id", orderId).maybeSingle()
    : withPieces;

  if (loaded.error) {
    console.error("merchant edit load", loaded.error.code, loaded.error.message);
    return fail("failed");
  }
  if (!isRecord(loaded.data) || typeof loaded.data.dropoff_address !== "string") {
    return fail("not_found");
  }
  if (!isOrderStatus(loaded.data.status) || !isPaymentType(loaded.data.payment_type)) {
    return fail("failed");
  }
  if (loaded.data.status !== "pending") return fail("not_pending");

  const currentPrice = canonicalMoney(loaded.data.product_price);
  if (currentPrice === null || typeof loaded.data.tracking_code !== "string") return fail("failed");

  const piecesRaw = (loaded.data as { pieces_count?: unknown }).pieces_count;
  const currentPieces =
    typeof piecesRaw === "number" && piecesRaw >= 1 && piecesRaw <= 99
      ? piecesRaw
      : typeof piecesRaw === "string" && /^[1-9]\d?$/.test(piecesRaw)
        ? Number(piecesRaw)
        : 1;

  const inspected = inspectMerchantEdit(input, loaded.data.payment_type);
  if (!inspected.parsed) return fail(inspected.issues[0] ?? "invalid");
  const parsed = inspected.parsed;

  const recipient = decodeRecipientDropoff(loaded.data.dropoff_address);
  const notes = decodeDropoffNotes(loaded.data.dropoff_address);
  const encoded = encodeRecipientDropoff(
    recipient.customerName.trim() || "العميل",
    parsed.phone,
    parsed.dropoffAddress,
    parsed.secondaryPhone,
    notes,
  );
  const nextPrice = parsed.codAmount;
  const priceChanges = nextPrice !== null && nextPrice !== currentPrice;
  const piecesChange = parsed.piecesCount !== currentPieces;
  const addressChanges = encoded !== loaded.data.dropoff_address;
  if (!priceChanges && !piecesChange && !addressChanges) {
    return { ok: true, changed: false };
  }

  const rpc = await supabase.rpc("merchant_edit_pending_order", {
    p_order_id: orderId,
    p_phone: parsed.phone,
    p_secondary_phone: parsed.secondaryPhone,
    p_dropoff_address: parsed.dropoffAddress,
    p_pieces_count: parsed.piecesCount,
    p_product_price: nextPrice ?? "",
  });

  if (!rpc.error) {
    const data = rpc.data;
    if (!isRecord(data) || data.tracking_code !== loaded.data.tracking_code || typeof data.changed !== "boolean") {
      return fail("failed");
    }
    if (data.changed) refresh(orderId, loaded.data.tracking_code);
    return { ok: true, changed: data.changed };
  }

  const mapped = mapRpc(rpc.error.message, rpc.error.code);
  if (mapped !== "migration_pending") {
    if (mapped === "failed") {
      console.error("merchant edit rpc", rpc.error.code, rpc.error.message);
    }
    return fail(mapped);
  }

  const patch: {
    dropoff_address: string;
    product_price?: string;
    pieces_count?: number;
  } = { dropoff_address: encoded };
  if (priceChanges && nextPrice) patch.product_price = nextPrice;
  if (piecesChange) patch.pieces_count = parsed.piecesCount;

  let write = await supabase
    .from("orders")
    .update(patch)
    .eq("id", orderId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (write.error && missingColumn(write.error.code)) {
    if (piecesChange) return fail("migration_pending");
    const rest: { dropoff_address: string; product_price?: string } = {
      dropoff_address: encoded,
    };
    if (priceChanges && nextPrice) rest.product_price = nextPrice;
    write = await supabase
      .from("orders")
      .update(rest)
      .eq("id", orderId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
  }

  if (write.error) {
    const code = mapRpc(write.error.message, write.error.code);
    if (code === "failed") console.error("merchant edit update", write.error.code, write.error.message);
    return fail(code === "migration_pending" ? "failed" : code);
  }
  if (!isRecord(write.data)) return fail("not_pending");

  refresh(orderId, loaded.data.tracking_code);
  return { ok: true, changed: true };
}

function refresh(orderId: string, trackingCode: string) {
  revalidatePath("/merchant/orders");
  revalidatePath(`/merchant/orders/${orderId}`);
  revalidatePath(`/merchant/orders/${orderId}/awb`);
  revalidatePath(`/track/${trackingCode}`);
  revalidatePath("/admin/orders");
}
