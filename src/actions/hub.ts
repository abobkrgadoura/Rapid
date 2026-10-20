"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import {
  canonicalUuid,
  hubClientFor,
  hubRpc,
  isRecord,
} from "@/lib/hub/rpc";
import type {
  BatchPickupDone,
  HubLoad,
  HubReceipt,
  HubResult,
  PickupScan,
} from "@/lib/hub/types";
import { normalizeTrackingCode } from "@/lib/orders/tracking";
import { alertOutForDelivery } from "@/lib/orders/status-alerts";
import {
  notifyBatchPickedUp,
  notifyOutForDelivery,
  notifyParcelAtHub,
} from "@/lib/whatsapp/notify";

/**
 * Hub & Spoke transitions.
 *
 *   Pickup driver   scanPickupParcel, confirmBatchPickup  pending   -> picked_up
 *   Admin hub       receiveOrderAtHub                      picked_up -> at_hub
 *   Delivery driver startDeliveryFromHub                   at_hub    -> in_transit
 *
 * The caller's role comes from the server session. Arguments only select
 * rows; Postgres re-checks role, status, and ownership in the same call that
 * writes (see supabase/migrations/0004_phase6_hub_privacy_gps.sql). None of
 * these actions read or return customer details.
 */

const BATCH_LIMIT = 100;

function refresh() {
  revalidatePath("/driver");
  revalidatePath("/merchant");
  revalidatePath("/admin");
  revalidatePath("/admin/hub");
}

/**
 * One scan inside the batch modal: can this parcel join the batch for this
 * merchant? Pickup driver only. Writes nothing and returns no customer data.
 */
export async function scanPickupParcel(
  merchantId: string,
  trackingCode: string,
): Promise<HubResult<PickupScan>> {
  const merchant = canonicalUuid(merchantId);
  const code = typeof trackingCode === "string" ? normalizeTrackingCode(trackingCode) : null;
  if (merchant === null || code === null) return { ok: false, error: "invalid_code" };

  const ready = await hubClientFor("driver");
  if (!ready.ok) return ready;

  const result = await hubRpc(ready.client.supabase, "scan_pickup_parcel", {
    p_merchant_id: merchant,
    p_tracking_code: code,
  });
  if ("error" in result) return { ok: false, error: result.error };
  if (!isRecord(result.data) || result.data.tracking_code !== code) {
    return { ok: false, error: "failed" };
  }

  return { ok: true, trackingCode: code };
}

/**
 * Confirm Pickup. Assigns every scanned code to the signed-in driver as
 * pickup_driver_id and moves them to picked_up in one transaction: all or none.
 */
export async function confirmBatchPickup(
  trackingCodes: string[],
): Promise<HubResult<BatchPickupDone>> {
  if (!Array.isArray(trackingCodes) || trackingCodes.length < 1) {
    return { ok: false, error: "empty_batch" };
  }
  if (trackingCodes.length > BATCH_LIMIT) return { ok: false, error: "invalid_code" };

  const codes: string[] = [];
  const seen = new Set<string>();
  for (const raw of trackingCodes) {
    const code = typeof raw === "string" ? normalizeTrackingCode(raw) : null;
    if (code === null || seen.has(code)) return { ok: false, error: "invalid_code" };
    seen.add(code);
    codes.push(code);
  }

  const ready = await hubClientFor("driver");
  if (!ready.ok) return ready;

  const result = await hubRpc(ready.client.supabase, "confirm_batch_pickup", {
    p_tracking_codes: codes,
  });
  if ("error" in result) return { ok: false, error: result.error };

  const data = result.data;
  const merchantId = isRecord(data) ? canonicalUuid(data.merchant_id) : null;
  if (
    !isRecord(data) ||
    merchantId === null ||
    data.count !== codes.length ||
    !Array.isArray(data.tracking_codes) ||
    data.tracking_codes.length !== codes.length ||
    data.tracking_codes.some((code, index) => code !== codes[index])
  ) {
    return { ok: false, error: "failed" };
  }

  refresh();
  after(() => notifyBatchPickedUp(merchantId, codes.length));

  return { ok: true, count: codes.length, trackingCodes: codes };
}

/** Hub manager scan. picked_up -> at_hub. Admin only. Safe to scan twice. */
export async function receiveOrderAtHub(
  trackingCode: string,
): Promise<HubResult<HubReceipt>> {
  const code = typeof trackingCode === "string" ? normalizeTrackingCode(trackingCode) : null;
  if (code === null) return { ok: false, error: "invalid_code" };

  const ready = await hubClientFor("admin");
  if (!ready.ok) return ready;

  const result = await hubRpc(ready.client.supabase, "receive_order_at_hub", {
    p_tracking_code: code,
  });
  if ("error" in result) return { ok: false, error: result.error };

  const data = result.data;
  if (
    !isRecord(data) ||
    data.tracking_code !== code ||
    data.status !== "at_hub" ||
    typeof data.already_received !== "boolean"
  ) {
    return { ok: false, error: "failed" };
  }

  refresh();
  // A repeat scan changed nothing, so it must not message the customer twice.
  if (!data.already_received) after(() => notifyParcelAtHub(code));

  return { ok: true, trackingCode: code, alreadyReceived: data.already_received };
}

/**
 * Delivery driver loads a parcel from the hub. at_hub -> in_transit and
 * driver_id = the signed-in driver. Postgres refuses the parcel's own pickup
 * driver. Only after this does the order become readable to the driver.
 */
export async function startDeliveryFromHub(
  trackingCode: string,
): Promise<HubResult<HubLoad>> {
  const code = typeof trackingCode === "string" ? normalizeTrackingCode(trackingCode) : null;
  if (code === null) return { ok: false, error: "invalid_code" };

  const ready = await hubClientFor("driver");
  if (!ready.ok) return ready;

  const result = await hubRpc(ready.client.supabase, "start_delivery_from_hub", {
    p_tracking_code: code,
  });
  if ("error" in result) return { ok: false, error: result.error };

  const data = result.data;
  if (
    !isRecord(data) ||
    data.tracking_code !== code ||
    data.status !== "in_transit" ||
    typeof data.already_loaded !== "boolean"
  ) {
    return { ok: false, error: "failed" };
  }

  refresh();
  revalidatePath(`/track/${code}`);
  if (!data.already_loaded) {
    const prepaid = data.payment_type === "prepaid";
    after(async () => {
      if (prepaid) await notifyOutForDelivery(code);
      await alertOutForDelivery(code);
    });
  }

  return { ok: true, trackingCode: code, alreadyLoaded: data.already_loaded };
}
