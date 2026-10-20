import { connection } from "next/server";

import { canonicalMoney } from "@/lib/format-money";
import { publicAreaFromDropoff, publishAreaSummary } from "@/lib/orders/public-area";
import { isOrderStatus, isPaymentType, type OrderStatus, type PaymentType } from "@/lib/orders/status";
import { normalizeTrackingCode } from "@/lib/orders/tracking";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";

/**
 * Fields an anonymous visitor may see. The lookup RPC is the database
 * boundary; this type is the application boundary. OTP, commission, street
 * address, GPS, and phone numbers are not part of it.
 */
export type PublicTracking = {
  trackingCode: string;
  status: OrderStatus;
  paymentType: PaymentType;
  /** Canonical money. Zero when the shipment is prepaid. */
  totalCollectible: string;
  merchantName: string;
  destinationSummary: string;
  createdAt: string | null;
  pickedUpAt: string | null;
  inTransitAt: string | null;
  deliveredAt: string | null;
};

export type TrackingLookup =
  | { ok: true; data: PublicTracking }
  | { ok: false; reason: "invalid" | "not_found" | "error" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function westernDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/\D/g, "");
}

function merchantName(value: unknown): string {
  if (typeof value !== "string") return "Rapid";
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 120) return "Rapid";
  if (/https?:|www\.|@/i.test(trimmed)) return "Rapid";
  if (westernDigits(trimmed).length >= 7) return "Rapid";
  return trimmed;
}

/**
 * Anonymous lookup by exact tracking code.
 *
 * The security-definer RPC is the public boundary once migration 0006 is
 * applied. Until then, the same safe projection is built on the server from
 * a service-role read. The raw dropoff is used only to derive a city or zone
 * and is not returned.
 */
export async function loadPublicTracking(rawCode: string): Promise<TrackingLookup> {
  const code = normalizeTrackingCode(rawCode);
  if (code === null) return { ok: false, reason: "invalid" };

  // Status changes by the minute, so this is never prerendered. It also keeps
  // supabase-js, which reads the clock to check token expiry, out of the
  // prerender pass where Cache Components forbids Date.now().
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("track_order_details", {
    p_tracking_code: code,
  });

  if (!error && Array.isArray(data)) {
    if (data.length === 0) return { ok: false, reason: "not_found" };
    const parsed = parsePublicRow(code, data[0]);
    if (parsed) return { ok: true, data: parsed };
  } else if (error) {
    console.error("track order", error.code, error.message);
  }

  return loadPublicTrackingOnServer(code);
}

function parsePublicRow(code: string, row: unknown): PublicTracking | null {
  if (
    !isRecord(row) ||
    row.tracking_code !== code ||
    !isOrderStatus(row.status) ||
    !isPaymentType(row.payment_type)
  ) {
    return null;
  }

  const collected = canonicalMoney(row.total_collectible);
  if (!collected) return null;

  return {
    trackingCode: code,
    status: row.status,
    paymentType: row.payment_type,
    totalCollectible: row.payment_type === "prepaid" ? "0.00" : collected,
    merchantName: merchantName(row.merchant_name),
    destinationSummary: publishAreaSummary(row.destination_summary),
    createdAt: isoOrNull(row.created_at),
    pickedUpAt: isoOrNull(row.picked_up_at),
    inTransitAt: isoOrNull(row.in_transit_at),
    deliveredAt: isoOrNull(row.delivered_at),
  };
}

const ORDER_COLUMNS =
  "status, payment_type, product_price, dropoff_address, merchant_id, created_at, picked_up_at, in_transit_at, delivered_at";

async function loadPublicTrackingOnServer(code: string): Promise<TrackingLookup> {
  const service = createServiceClient();
  if (!service) return { ok: false, reason: "error" };

  const order = await service
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("tracking_code", code)
    .maybeSingle();

  if (order.error) {
    console.error("track order server", order.error.code, order.error.message);
    return { ok: false, reason: "error" };
  }
  if (!order.data) return { ok: false, reason: "not_found" };

  const row: unknown = order.data;
  if (
    !isRecord(row) ||
    !isOrderStatus(row.status) ||
    !isPaymentType(row.payment_type) ||
    typeof row.merchant_id !== "string" ||
    typeof row.dropoff_address !== "string"
  ) {
    return { ok: false, reason: "error" };
  }

  const collected = canonicalMoney(row.product_price);
  if (!collected) return { ok: false, reason: "error" };

  const merchant = await service
    .from("profiles")
    .select("company_name, full_name")
    .eq("id", row.merchant_id)
    .maybeSingle();

  let name = "Rapid";
  if (!merchant.error && isRecord(merchant.data)) {
    const company = textOrNull(merchant.data.company_name);
    const person = textOrNull(merchant.data.full_name);
    name = merchantName(company ?? person);
  } else if (merchant.error) {
    const personOnly = await service
      .from("profiles")
      .select("full_name")
      .eq("id", row.merchant_id)
      .maybeSingle();
    if (!personOnly.error && isRecord(personOnly.data)) {
      name = merchantName(personOnly.data.full_name);
    }
  }

  const area = publicAreaFromDropoff(row.dropoff_address);

  return {
    ok: true,
    data: {
      trackingCode: code,
      status: row.status,
      paymentType: row.payment_type,
      totalCollectible: row.payment_type === "prepaid" ? "0.00" : collected,
      merchantName: name,
      destinationSummary: area,
      createdAt: isoOrNull(row.created_at),
      pickedUpAt: isoOrNull(row.picked_up_at),
      inTransitAt: isoOrNull(row.in_transit_at),
      deliveredAt: isoOrNull(row.delivered_at),
    },
  };
}
