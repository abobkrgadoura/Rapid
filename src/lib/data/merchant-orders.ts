import { cache } from "react";

import { getAuthSession } from "@/lib/auth/session";
import { canonicalMoney } from "@/lib/format-money";
import { safeMapsHref } from "@/lib/orders/gps-url";
import { decodeDropoffNotes, decodeRecipientDropoff } from "@/lib/orders/recipient";
import { readShipmentExtras, type ShipmentExtras } from "@/lib/orders/shipment-details";
import { isOrderStatus, isPaymentType, type OrderStatus, type PaymentType } from "@/lib/orders/status";
import { createClient } from "@/utils/supabase/server";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DETAIL_COLUMNS =
  "id, tracking_code, pickup_address, dropoff_address, product_price, delivery_fee, payment_type, status, created_at, picked_up_at, in_transit_at, delivered_at, pickup_gps_url, dropoff_gps_url";

const DETAIL_COLUMNS_PHASE13 = `${DETAIL_COLUMNS}, building_name, floor_number, apartment_number, landmark, is_work_address, parcel_size, pieces_count, product_description, product_image_url, allow_opening, delivery_notes, internal_notes, exception_reason, call_log_proof_url, whatsapp_proof_url, door_photo_proof_url, attempt_gps_lat, attempt_gps_lng, attempt_distance_meters, is_gps_verified, last_attempt_at, suspicious_attempt_flag, failed_attempts, is_partial_delivery, delivered_pieces_count, returned_pieces_count, partial_collected_amount`;

function missingColumn(code: string | undefined): boolean {
  return code === "42703" || code === "PGRST204";
}

export type MerchantOrderRow = {
  id: string;
  trackingCode: string;
  customerName: string;
  phone: string;
  secondaryPhone: string;
  dropoffAddress: string;
  productPrice: string;
  deliveryFee: string;
  paymentType: PaymentType;
  status: OrderStatus;
  createdLabel: string;
  piecesCount: number;
};

export type MerchantOrderDetail = {
  id: string;
  trackingCode: string;
  customerName: string;
  phone: string;
  secondaryPhone: string;
  dropoffAddress: string;
  pickupAddress: string;
  productPrice: string;
  deliveryFee: string;
  paymentType: PaymentType;
  status: OrderStatus;
  createdAt: string;
  createdLabel: string;
  pickedUpAt: string | null;
  inTransitAt: string | null;
  deliveredAt: string | null;
  pickupMapUrl: string | null;
  dropoffMapUrl: string | null;
  originalTracking: string;
  newItemNote: string;
  returnItemNote: string;
  extras: ShipmentExtras | null;
};

export type MerchantOrderLookup =
  | { ok: true; data: MerchantOrderDetail }
  | { ok: false; reason: "not_found" | "error" };

export type LoadResult<T> = { ok: true; data: T } | { ok: false };

const createdAtFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Africa/Khartoum",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatCreatedAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return createdAtFormat.format(date);
}

function piecesInRange(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[1-9]\d?$/.test(value)
        ? Number(value)
        : null;
  return parsed !== null && parsed >= 1 && parsed <= 99 ? parsed : 1;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

export async function loadMerchantOrders(): Promise<
  LoadResult<MerchantOrderRow[]>
> {
  const session = await getAuthSession();
  if (session.status !== "ready" || session.profile.role !== "merchant") {
    return { ok: false };
  }

  const supabase = await createClient();
  const listColumns =
    "id, tracking_code, dropoff_address, product_price, delivery_fee, payment_type, status, created_at, pieces_count";
  const listed = await supabase
    .from("orders_readable")
    .select(listColumns)
    .order("created_at", { ascending: false })
    .limit(100);
  const result = missingColumn(listed.error?.code)
    ? await supabase
        .from("orders_readable")
        .select(
          "id, tracking_code, dropoff_address, product_price, delivery_fee, payment_type, status, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(100)
    : listed;
  const { data, error } = result;

  if (error || !Array.isArray(data)) {
    console.error("merchant orders", error?.message);
    return { ok: false };
  }

  const rows: MerchantOrderRow[] = [];
  for (const row of data) {
    if (!isRecord(row)) return { ok: false };
    if (typeof row.id !== "string" || !UUID.test(row.id)) return { ok: false };
    if (typeof row.tracking_code !== "string" || !row.tracking_code.trim()) {
      return { ok: false };
    }
    if (typeof row.dropoff_address !== "string") return { ok: false };
    if (!isPaymentType(row.payment_type) || !isOrderStatus(row.status)) {
      return { ok: false };
    }

    const productPrice = canonicalMoney(row.product_price);
    const deliveryFee = canonicalMoney(row.delivery_fee);
    const createdLabel = formatCreatedAt(row.created_at);
    if (!productPrice || !deliveryFee || !createdLabel) return { ok: false };

    const recipient = decodeRecipientDropoff(row.dropoff_address);
    rows.push({
      id: row.id.toLowerCase(),
      trackingCode: row.tracking_code,
      customerName: recipient.customerName,
      phone: recipient.phone,
      secondaryPhone: recipient.secondaryPhone,
      dropoffAddress: recipient.dropoffAddress,
      productPrice,
      deliveryFee,
      paymentType: row.payment_type,
      status: row.status,
      createdLabel,
      piecesCount: piecesInRange(
        (row as { pieces_count?: unknown }).pieces_count,
      ),
    });
  }

  return { ok: true, data: rows };
}

/**
 * One order for the signed-in merchant. The id comes from the URL; RLS still
 * returns only that merchant's rows, so another merchant's id is a miss.
 */
export const loadMerchantOrder = cache(async function loadMerchantOrder(
  rawId: string,
): Promise<MerchantOrderLookup> {
  const id = rawId.trim().toLowerCase();
  if (!UUID.test(id)) return { ok: false, reason: "not_found" };

  const session = await getAuthSession();
  if (session.status !== "ready" || session.profile.role !== "merchant") {
    return { ok: false, reason: "error" };
  }

  const supabase = await createClient();
  const phase = await supabase
    .from("orders_readable")
    .select(DETAIL_COLUMNS_PHASE13)
    .eq("id", id)
    .maybeSingle();

  const result = missingColumn(phase.error?.code)
    ? await supabase.from("orders_readable").select(DETAIL_COLUMNS).eq("id", id).maybeSingle()
    : phase;

  const { data, error } = result;

  if (error) {
    console.error("merchant order", error.message);
    return { ok: false, reason: "error" };
  }
  if (!isRecord(data)) return { ok: false, reason: "not_found" };
  if (typeof data.id !== "string" || data.id.toLowerCase() !== id) {
    return { ok: false, reason: "error" };
  }
  if (typeof data.tracking_code !== "string" || !data.tracking_code.trim()) {
    return { ok: false, reason: "error" };
  }
  if (typeof data.pickup_address !== "string" || typeof data.dropoff_address !== "string") {
    return { ok: false, reason: "error" };
  }
  if (!isPaymentType(data.payment_type) || !isOrderStatus(data.status)) {
    return { ok: false, reason: "error" };
  }

  const productPrice = canonicalMoney(data.product_price);
  const deliveryFee = canonicalMoney(data.delivery_fee);
  const createdAt = isoOrNull(data.created_at);
  const createdLabel = formatCreatedAt(data.created_at);
  if (!productPrice || !deliveryFee || !createdAt || !createdLabel) {
    return { ok: false, reason: "error" };
  }

  const recipient = decodeRecipientDropoff(data.dropoff_address);
  const notes = decodeDropoffNotes(data.dropoff_address);

  return {
    ok: true,
    data: {
      id,
      trackingCode: data.tracking_code,
      customerName: recipient.customerName,
      phone: recipient.phone,
      secondaryPhone: recipient.secondaryPhone,
      dropoffAddress: recipient.dropoffAddress,
      pickupAddress: data.pickup_address.trim(),
      productPrice,
      deliveryFee,
      paymentType: data.payment_type,
      status: data.status,
      createdAt,
      createdLabel,
      pickedUpAt: isoOrNull(data.picked_up_at),
      inTransitAt: isoOrNull(data.in_transit_at),
      deliveredAt: isoOrNull(data.delivered_at),
      pickupMapUrl: safeMapsHref(data.pickup_gps_url),
      dropoffMapUrl: safeMapsHref(data.dropoff_gps_url),
      originalTracking: notes.originalTracking,
      newItemNote: notes.newItemNote,
      returnItemNote: notes.returnItemNote,
      extras: readShipmentExtras(data),
    },
  };
});
