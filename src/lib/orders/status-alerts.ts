import type { SupabaseClient } from "@supabase/supabase-js";

import { decodeRecipientDropoff } from "@/lib/orders/recipient";
import { normalizeTrackingCode } from "@/lib/orders/tracking";
import { sendDeliveredWhatsApp, sendOutForDeliveryWhatsApp } from "@/lib/whatsapp";
import { createServiceClient } from "@/utils/supabase/service";

/**
 * Best-effort customer WhatsApp and merchant bell rows after a status change.
 *
 * The stored status for خارج للتوصيل is `in_transit`. Callers fire
 * `alertOutForDelivery` only on the transition into that status, and
 * `alertDelivered` sends the customer message when the status first becomes
 * delivered, and writes the merchant wallet notice only after the ledger posts.
 *
 * Neither function throws, and neither one changes the action result.
 * Customer phone and name are read with the service role after the acting
 * session has already authorized the write. They are not returned.
 */

const FALLBACK_CUSTOMER = "عميلنا";
const FALLBACK_MERCHANT = "التاجر";

type Shipment = {
  trackingCode: string;
  merchantId: string;
  customerName: string;
  phone: string;
  merchantName: string;
  codAmount: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function codAmount(paymentType: unknown, productPrice: unknown): string {
  if (paymentType !== "cod") return "0";
  const raw =
    typeof productPrice === "number"
      ? productPrice
      : typeof productPrice === "string"
        ? Number(productPrice)
        : Number.NaN;
  if (!Number.isFinite(raw) || raw < 0 || raw > 1_000_000_000) return "0";
  const rounded = Math.round(raw * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

async function loadShipment(
  client: SupabaseClient,
  trackingCode: string,
): Promise<Shipment | null> {
  const code = normalizeTrackingCode(trackingCode);
  if (code === null) return null;

  const { data, error } = await client
    .from("orders")
    .select("tracking_code, merchant_id, payment_type, product_price, dropoff_address")
    .eq("tracking_code", code)
    .maybeSingle();
  if (error || !isRecord(data)) {
    if (error) console.error("[whatsapp] order lookup failed", error.code);
    return null;
  }

  const storedCode = text(data.tracking_code);
  const merchantId = text(data.merchant_id);
  if (!storedCode || !merchantId || typeof data.dropoff_address !== "string") return null;

  const recipient = decodeRecipientDropoff(data.dropoff_address);
  const merchant = await client
    .from("profiles")
    .select("full_name, company_name")
    .eq("id", merchantId)
    .maybeSingle();

  let merchantName = FALLBACK_MERCHANT;
  if (!merchant.error && isRecord(merchant.data)) {
    merchantName = text(merchant.data.company_name) ?? text(merchant.data.full_name) ?? FALLBACK_MERCHANT;
  }

  return {
    trackingCode: storedCode,
    merchantId,
    customerName: recipient.customerName.trim() || FALLBACK_CUSTOMER,
    phone: recipient.phone.trim(),
    merchantName,
    codAmount: codAmount(data.payment_type, data.product_price),
  };
}

async function insertMerchantNotice(
  client: SupabaseClient,
  merchantId: string,
  title: string,
  message: string,
  type: "order" | "finance",
): Promise<void> {
  const { error } = await client.from("notifications").insert({
    user_id: merchantId,
    title,
    message,
    type,
  });
  if (!error) return;

  if (error.code === "42P01" || error.code === "PGRST205") {
    console.warn(
      "[whatsapp] notifications table is missing. Apply supabase/migrations/0014_phase16_notifications.sql.",
    );
    return;
  }
  console.error("[whatsapp] merchant notification insert failed", error.code);
}

async function withShipment(
  label: string,
  trackingCode: string,
  job: (client: SupabaseClient, shipment: Shipment) => Promise<void>,
): Promise<void> {
  try {
    const client = createServiceClient();
    if (!client) {
      console.warn(
        `[whatsapp] ${label}: SUPABASE_SERVICE_ROLE_KEY is not set, so the WhatsApp message and the merchant notice were skipped`,
      );
      return;
    }
    const shipment = await loadShipment(client, trackingCode);
    if (!shipment) return;
    await job(client, shipment);
  } catch (error) {
    console.error(
      `[whatsapp] ${label} failed`,
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

/** Customer WhatsApp plus the merchant bell row for خارج للتوصيل. */
export function alertOutForDelivery(trackingCode: string): Promise<void> {
  return withShipment("out_for_delivery", trackingCode, async (client, shipment) => {
    if (shipment.phone) {
      await sendOutForDeliveryWhatsApp(
        shipment.phone,
        shipment.customerName,
        shipment.trackingCode,
        shipment.merchantName,
        shipment.codAmount,
      );
    } else {
      console.warn(
        `[whatsapp] out_for_delivery: ${shipment.trackingCode} has no customer phone`,
      );
    }

    await insertMerchantNotice(
      client,
      shipment.merchantId,
      "تحديث الشحنة",
      `الشحنة رقم ${shipment.trackingCode} خرجت للتوصيل`,
      "order",
    );
  });
}

/**
 * Customer WhatsApp when a parcel first becomes delivered, and the merchant
 * wallet notice once that delivery's ledger post has succeeded.
 */
export function alertDelivered(
  trackingCode: string,
  options: { whatsapp?: boolean; notice?: boolean } = {},
): Promise<void> {
  const sendMessage = options.whatsapp !== false;
  const writeNotice = options.notice !== false;

  return withShipment("delivered", trackingCode, async (client, shipment) => {
    if (sendMessage) {
      if (shipment.phone) {
        await sendDeliveredWhatsApp(
          shipment.phone,
          shipment.customerName,
          shipment.trackingCode,
        );
      } else {
        console.warn(`[whatsapp] delivered: ${shipment.trackingCode} has no customer phone`);
      }
    }

    if (!writeNotice) return;

    await insertMerchantNotice(
      client,
      shipment.merchantId,
      "تم التوصيل",
      `تم توصيل الشحنة رقم ${shipment.trackingCode} بنجاح، وتم تحديث رصيد المحفظة.`,
      "finance",
    );
  });
}
