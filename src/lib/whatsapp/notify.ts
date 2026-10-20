import type { SupabaseClient } from "@supabase/supabase-js";

import { decodeRecipientDropoff } from "@/lib/orders/recipient";
import { normalizeTrackingCode } from "@/lib/orders/tracking";
import { deliverWhatsApp } from "@/lib/whatsapp/deliver";
import { isDeliveryOtp } from "@/lib/otp";
import { createServiceClient } from "@/utils/supabase/service";

/**
 * Order events -> WhatsApp templates.
 *
 * Every function here is best effort: it never throws and never changes the
 * result of the action that triggered it. They run after the response
 * (see `after()` in the actions), once the acting user's own JWT has already
 * performed and authorized the transition.
 *
 * Some of the data a message needs is deliberately out of reach of whoever
 * triggered it: a delivery driver must not read the customer's OTP and a
 * pickup driver must not read the customer's phone. A service-role client
 * reads it server-side to compose the message, and the values go straight to
 * `deliverWhatsApp`; they are never returned to a caller.
 *
 * Which event sends which template:
 *   1  merchant_order_created        createMerchantOrder
 *   2  merchant_batch_picked_up      confirmBatchPickup
 *   3  customer_picked_up            receiveOrderAtHub (the text says "now in
 *                                    our warehouses", which is true only here)
 *   4  customer_out_for_delivery     startDeliveryFromHub, prepaid orders only
 */

const FALLBACK_MERCHANT = "شريكنا";
const FALLBACK_COMPANY = "التاجر";

type OrderContext = {
  trackingCode: string;
  merchantId: string;
  paymentType: string;
  dropoff: string;
  otp: string | null;
};

type MerchantContact = { name: string | null; phone: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function loadOrder(
  client: SupabaseClient,
  rawCode: string,
): Promise<OrderContext | null> {
  const code = normalizeTrackingCode(rawCode);
  if (code === null) return null;

  const { data, error } = await client
    .from("orders")
    .select("tracking_code, merchant_id, payment_type, dropoff_address, delivery_otp")
    .eq("tracking_code", code)
    .maybeSingle();
  if (error || !isRecord(data)) return null;

  const trackingCode = text(data.tracking_code);
  const merchantId = text(data.merchant_id);
  if (!trackingCode || !merchantId || typeof data.dropoff_address !== "string") {
    return null;
  }

  return {
    trackingCode,
    merchantId,
    paymentType: typeof data.payment_type === "string" ? data.payment_type : "",
    dropoff: data.dropoff_address,
    otp: typeof data.delivery_otp === "string" ? data.delivery_otp : null,
  };
}

async function loadMerchant(
  client: SupabaseClient,
  merchantId: string,
): Promise<MerchantContact | null> {
  const { data, error } = await client
    .from("profiles")
    .select("full_name, company_name, phone")
    .eq("id", merchantId)
    .maybeSingle();
  if (error || !isRecord(data)) return null;

  return {
    name: text(data.company_name) ?? text(data.full_name),
    phone: text(data.phone),
  };
}

async function run(label: string, job: (client: SupabaseClient) => Promise<void>) {
  try {
    const client = createServiceClient();
    if (!client) {
      console.warn(
        `[whatsapp] ${label}: SUPABASE_SERVICE_ROLE_KEY is not set, message not composed`,
      );
      return;
    }
    await job(client);
  } catch (error) {
    console.error(
      `[whatsapp] ${label} failed`,
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

/** Template 1: the merchant's order was created. */
export function notifyOrderCreated(trackingCode: string): Promise<void> {
  return run("merchant_order_created", async (client) => {
    const order = await loadOrder(client, trackingCode);
    if (!order) return;
    const merchant = await loadMerchant(client, order.merchantId);
    if (!merchant) return;

    deliverWhatsApp(
      "merchant_order_created",
      { merchant: merchant.name ?? FALLBACK_MERCHANT },
      merchant.phone,
    );
  });
}

/** Template 2: a driver collected `count` parcels from the merchant today. */
export function notifyBatchPickedUp(
  merchantId: string,
  count: number,
): Promise<void> {
  return run("merchant_batch_picked_up", async (client) => {
    if (!Number.isInteger(count) || count < 1) return;
    const merchant = await loadMerchant(client, merchantId);
    if (!merchant) return;

    deliverWhatsApp("merchant_batch_picked_up", { count }, merchant.phone);
  });
}

/** Template 3: the customer's parcel reached the hub. */
export function notifyParcelAtHub(trackingCode: string): Promise<void> {
  return run("customer_picked_up", async (client) => {
    const order = await loadOrder(client, trackingCode);
    if (!order) return;
    const merchant = await loadMerchant(client, order.merchantId);
    const recipient = decodeRecipientDropoff(order.dropoff);

    deliverWhatsApp(
      "customer_picked_up",
      {
        code: order.trackingCode,
        companyName: merchant?.name ?? FALLBACK_COMPANY,
      },
      recipient.phone || null,
    );
  });
}

/** Template 4: prepaid parcel left the hub. COD orders have no OTP and send nothing. */
export function notifyOutForDelivery(trackingCode: string): Promise<void> {
  return run("customer_out_for_delivery", async (client) => {
    const order = await loadOrder(client, trackingCode);
    if (!order || order.paymentType !== "prepaid") return;

    if (!order.otp || !isDeliveryOtp(order.otp)) {
      console.warn(
        `[whatsapp] customer_out_for_delivery: ${order.trackingCode} is prepaid but has no delivery code issued`,
      );
      return;
    }

    deliverWhatsApp(
      "customer_out_for_delivery",
      { otp: order.otp },
      decodeRecipientDropoff(order.dropoff).phone || null,
    );
  });
}
