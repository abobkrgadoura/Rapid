"use server";

import { revalidatePath } from "next/cache";

import { adminClient, adminRpc, isRecord } from "@/lib/admin/rpc";
import type { AdminErrorCode, AdminResult, OrderEditInput } from "@/lib/admin/types";
import { canonicalMoney } from "@/lib/format-money";
import { formatCents, parseNonNegativeMoneyCents } from "@/lib/money";
import {
  decodeDropoffNotes,
  decodeRecipientDropoff,
  encodeRecipientDropoff,
  normalizeRecipientPhone,
} from "@/lib/orders/recipient";
import { isOrderStatus, isPaymentType } from "@/lib/orders/status";
import { normalizeTrackingCode } from "@/lib/orders/tracking";

/**
 * Admin exception decisions and shipment corrections.
 * The signed-in role comes from the server session. Both Postgres functions
 * call is_admin() again before they write.
 */

function fail(error: AdminErrorCode): { ok: false; error: AdminErrorCode } {
  return { ok: false, error };
}

function refresh(orderId?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/exceptions");
  revalidatePath("/driver");
  revalidatePath("/merchant");
  if (orderId) revalidatePath(`/admin/orders/${orderId}`);
}

export async function reviewException(
  trackingCode: string,
  decision: "accept" | "reject",
): Promise<AdminResult<{ status: string; decision: "accept" | "reject"; alerted: boolean }>> {
  const code = typeof trackingCode === "string" ? normalizeTrackingCode(trackingCode) : null;
  if (code === null || (decision !== "accept" && decision !== "reject")) return fail("invalid");

  const ready = await adminClient();
  if (!ready.ok) return fail(ready.error);

  const result = await adminRpc(ready.client.supabase, "admin_review_exception", {
    p_tracking_code: code,
    p_decision: decision,
  });
  if ("error" in result) return fail(result.error);

  const data = result.data;
  if (
    !isRecord(data) ||
    data.tracking_code !== code ||
    data.decision !== decision ||
    typeof data.status !== "string" ||
    !isOrderStatus(data.status) ||
    typeof data.alerted !== "boolean"
  ) {
    return fail("failed");
  }

  refresh(typeof data.id === "string" ? data.id : undefined);
  if (decision === "accept" || decision === "reject") revalidatePath(`/track/${code}`);
  return { ok: true, status: data.status, decision, alerted: data.alerted };
}

export async function editOrderDetails(
  input: OrderEditInput,
): Promise<AdminResult<{ changed: boolean }>> {
  if (!isRecord(input)) return fail("invalid");
  const code = typeof input.trackingCode === "string" ? normalizeTrackingCode(input.trackingCode) : null;
  const phone = typeof input.phone === "string" ? normalizeRecipientPhone(input.phone) : null;
  const address = typeof input.address === "string" ? input.address.trim() : "";
  const notes = typeof input.deliveryNotes === "string" ? input.deliveryNotes.trim() : "";
  if (code === null || phone === null || address.length < 1 || address.length > 500 || notes.length > 240) {
    return fail("invalid");
  }

  const ready = await adminClient();
  if (!ready.ok) return fail(ready.error);

  const loaded = await ready.client.supabase
    .from("orders")
    .select("id, tracking_code, status, payment_type, product_price, dropoff_address, delivery_notes, ledger_posted_at")
    .eq("tracking_code", code)
    .maybeSingle();

  if (loaded.error) {
    if (loaded.error.code === "42703" || loaded.error.code === "PGRST204") return fail("migration_pending");
    console.error("admin edit order", loaded.error.code, loaded.error.message);
    return fail("failed");
  }
  if (!isRecord(loaded.data) || typeof loaded.data.dropoff_address !== "string") {
    return fail("not_found");
  }
  if (!isOrderStatus(loaded.data.status) || !isPaymentType(loaded.data.payment_type)) {
    return fail("failed");
  }

  const currentPrice = canonicalMoney(loaded.data.product_price);
  if (currentPrice === null) return fail("failed");

  const recipient = decodeRecipientDropoff(loaded.data.dropoff_address);
  const currentNotes =
    typeof loaded.data.delivery_notes === "string" ? loaded.data.delivery_notes.trim() : "";
  const phoneChanged = normalizeRecipientPhone(recipient.phone) !== phone && recipient.phone !== phone;
  const addressChanged = recipient.dropoffAddress.trim() !== address;
  const notesChanged = currentNotes !== notes;

  let priceArg = "";
  if (loaded.data.payment_type === "cod") {
    const raw = typeof input.codAmount === "string" ? input.codAmount.replace(/[^\d.]/g, "") : "";
    const cents = parseNonNegativeMoneyCents(raw);
    if (cents === null) return fail("invalid");
    let next = "";
    try {
      next = formatCents(cents);
    } catch {
      return fail("invalid");
    }
    if (next !== currentPrice) {
      const locked = loaded.data.status === "delivered" || loaded.data.ledger_posted_at != null;
      if (locked) return fail("locked");
      priceArg = next;
    }
  }

  if (!phoneChanged && !addressChanged && !notesChanged && priceArg === "") {
    return { ok: true, changed: false };
  }

  const dropoff =
    phoneChanged || addressChanged
      ? encodeRecipientDropoff(
          recipient.customerName,
          phone,
          address,
          recipient.secondaryPhone,
          decodeDropoffNotes(loaded.data.dropoff_address),
        )
      : loaded.data.dropoff_address;

  const result = await adminRpc(ready.client.supabase, "admin_edit_order_details", {
    p_tracking_code: code,
    p_dropoff_address: dropoff,
    p_delivery_notes: notes,
    p_product_price: priceArg,
  });
  if ("error" in result) return fail(result.error);

  const data = result.data;
  if (!isRecord(data) || data.tracking_code !== code || typeof data.changed !== "boolean") {
    return fail("failed");
  }

  refresh(typeof loaded.data.id === "string" ? loaded.data.id : undefined);
  revalidatePath(`/track/${code}`);
  return { ok: true, changed: data.changed };
}
