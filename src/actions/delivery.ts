"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import {
  markDelivered,
  markPartialDelivered,
  postCodDebit,
  postPrepaidCredit,
  previewDeliveryLedger,
  verifyPrepaidOtp,
  type DeliveryLocation,
  type LogisticsErrorCode,
  type PartialHandoff,
} from "@/actions/logistics";
import { getAuthSession } from "@/lib/auth/session";
import type {
  ConfirmDeliveryResult,
  DeliveryErrorCode,
  DeliveryOrder,
  LookupDeliveryResult,
} from "@/lib/delivery/types";
import { canonicalMoney } from "@/lib/format-money";
import { formatCents, parseNonNegativeMoneyCents } from "@/lib/money";
import { decodeRecipientDropoff } from "@/lib/orders/recipient";
import {
  isOrderStatus,
  isPaymentType,
  type OrderStatus,
  type PaymentType,
} from "@/lib/orders/status";
import { alertDelivered } from "@/lib/orders/status-alerts";
import { normalizeTrackingCode } from "@/lib/orders/tracking";
import { isDeliveryOtp } from "@/lib/otp";
import { createClient } from "@/utils/supabase/server";

/**
 * Driver delivery flow. The caller is the signed-in driver, read from the
 * server session; no client field names a driver or a role. Money is never
 * computed here: Postgres computes it and postCodDebit / postPrepaidCredit
 * (src/actions/logistics.ts) post it with its transactions row.
 *
 * Order of operations for confirmDelivery:
 *   prepaid: verify OTP -> mark delivered (+GPS) -> credit wallet
 *   cod:     mark delivered (+GPS) -> debit wallet
 * Each step is idempotent, so a failure after "delivered" can be retried by
 * scanning the same code again.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DriverOrderRow = {
  id: string;
  trackingCode: string;
  status: OrderStatus;
  paymentType: PaymentType;
  productPrice: string;
  dropoff: string;
  ledgerPosted: boolean;
  piecesCount: number;
  merchantName: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fromLogistics(code: LogisticsErrorCode): DeliveryErrorCode {
  switch (code) {
    case "unauthorized":
      return "unauthorized";
    case "forbidden":
      return "forbidden";
    case "conflict":
      return "already_completed";
    case "locked":
      return "otp_locked";
    case "otp_required":
      return "otp_invalid";
    case "invalid":
      return "not_deliverable";
    default:
      return "failed";
  }
}

async function loadDriverOrder(
  rawCode: unknown,
): Promise<
  { ok: true; row: DriverOrderRow } | { ok: false; error: DeliveryErrorCode }
> {
  if (typeof rawCode !== "string") return { ok: false, error: "invalid_code" };
  const code = normalizeTrackingCode(rawCode);
  if (code === null) return { ok: false, error: "invalid_code" };

  const session = await getAuthSession();
  if (session.status === "anonymous") return { ok: false, error: "unauthorized" };
  if (session.status !== "ready" || session.profile.role !== "driver") {
    return { ok: false, error: "forbidden" };
  }

  const supabase = await createClient();
  const columns =
    "id, tracking_code, status, payment_type, product_price, dropoff_address, ledger_posted_at, pieces_count, merchant_id";
  const primary = await supabase
    .from("orders_readable")
    .select(columns)
    .eq("tracking_code", code)
    .eq("driver_id", session.profile.id)
    .maybeSingle();
  const loadedRow =
    primary.error?.code === "42703" || primary.error?.code === "PGRST204"
      ? await supabase
          .from("orders_readable")
          .select(
            "id, tracking_code, status, payment_type, product_price, dropoff_address, ledger_posted_at, merchant_id",
          )
          .eq("tracking_code", code)
          .eq("driver_id", session.profile.id)
          .maybeSingle()
      : primary;
  const { data, error } = loadedRow;

  if (error) {
    console.error("delivery lookup", error.code, error.message);
    return { ok: false, error: "failed" };
  }
  if (!data) return { ok: false, error: "not_found" };

  const record: unknown = data;
  if (!isRecord(record)) return { ok: false, error: "failed" };
  const productPrice = canonicalMoney(record.product_price);
  if (
    typeof record.id !== "string" ||
    !UUID.test(record.id) ||
    typeof record.tracking_code !== "string" ||
    typeof record.dropoff_address !== "string" ||
    !isOrderStatus(record.status) ||
    !isPaymentType(record.payment_type) ||
    productPrice === null
  ) {
    return { ok: false, error: "failed" };
  }

  const pieces =
    typeof record.pieces_count === "number" && Number.isInteger(record.pieces_count)
      ? record.pieces_count
      : typeof record.pieces_count === "string" && /^\d+$/.test(record.pieces_count)
        ? Number(record.pieces_count)
        : 1;

  let merchantName = "المتجر";
  if (typeof record.merchant_id === "string") {
    const names = await supabase.rpc("driver_assigned_merchants");
    if (!names.error && Array.isArray(names.data)) {
      const match = names.data.find(
        (item) =>
          isRecord(item) &&
          typeof item.merchant_id === "string" &&
          item.merchant_id.toLowerCase() === record.merchant_id?.toString().toLowerCase(),
      );
      if (isRecord(match) && typeof match.company_name === "string" && match.company_name.trim()) {
        merchantName = match.company_name.trim();
      }
    }
  }

  return {
    ok: true,
    row: {
      id: record.id.toLowerCase(),
      trackingCode: record.tracking_code,
      status: record.status,
      paymentType: record.payment_type,
      productPrice,
      dropoff: record.dropoff_address,
      ledgerPosted: record.ledger_posted_at != null,
      piecesCount: pieces >= 1 && pieces <= 99 ? pieces : 1,
      merchantName,
    },
  };
}

/**
 * Which of the driver's states may enter the delivery flow. Only a parcel the
 * driver loaded from the hub (in_transit) can be handed over; the driver can
 * only read orders assigned to them, which happens in that same step.
 */
function deliveryGate(row: DriverOrderRow): DeliveryErrorCode | null {
  if (row.status === "in_transit") return null;
  if (row.status === "delivered") {
    return row.ledgerPosted ? "already_completed" : null;
  }
  if (
    row.status === "pending" ||
    row.status === "assigned" ||
    row.status === "picked_up" ||
    row.status === "at_hub"
  ) {
    return "not_picked_up";
  }
  return "not_deliverable";
}

function revalidateOrder(trackingCode: string) {
  revalidatePath("/driver");
  revalidatePath("/merchant");
  revalidatePath("/admin");
  revalidatePath(`/track/${trackingCode}`);
}

/**
 * Step one of the scanner: resolve the (simulated) scanned code to one of
 * this driver's orders and report whether the OTP form is needed.
 */
export async function lookupDeliveryOrder(
  trackingCode: string,
): Promise<LookupDeliveryResult> {
  const loaded = await loadDriverOrder(trackingCode);
  if (!loaded.ok) return loaded;

  const gate = deliveryGate(loaded.row);
  if (gate) return { ok: false, error: gate };

  const preview = await previewDeliveryLedger(loaded.row.id);
  if (!preview.ok) return { ok: false, error: fromLogistics(preview.error) };
  if (preview.paymentType !== loaded.row.paymentType) {
    return { ok: false, error: "failed" };
  }

  const recipient = decodeRecipientDropoff(loaded.row.dropoff);
  const resume = loaded.row.status === "delivered";

  const order: DeliveryOrder = {
    orderId: loaded.row.id,
    trackingCode: loaded.row.trackingCode,
    paymentType: loaded.row.paymentType,
    status: loaded.row.status,
    customerName: recipient.customerName,
    phone: recipient.phone,
    dropoffAddress: recipient.dropoffAddress,
    productPrice: loaded.row.productPrice,
    walletAmount: preview.amount,
    requiresOtp: loaded.row.paymentType === "prepaid" && !resume,
    resume,
    piecesCount: loaded.row.piecesCount,
    merchantName: loaded.row.merchantName,
  };

  return { ok: true, order };
}

type ConfirmInput = {
  trackingCode: string;
  otp?: string | null;
  location: DeliveryLocation;
  /** Present only for a partial handoff. Full delivery leaves this out. */
  partial?: PartialHandoff | null;
};

/**
 * Final step of the scanner. Re-reads the order itself instead of trusting
 * anything from the lookup, then runs verify -> deliver -> post.
 */
export async function confirmDelivery(
  input: ConfirmInput,
): Promise<ConfirmDeliveryResult> {
  if (!isRecord(input) || !isRecord(input.location)) {
    return { ok: false, error: "invalid_location" };
  }

  const { latitude, longitude, accuracyMeters } = input.location;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    (accuracyMeters != null &&
      (typeof accuracyMeters !== "number" ||
        !Number.isFinite(accuracyMeters) ||
        accuracyMeters < 0))
  ) {
    return { ok: false, error: "invalid_location" };
  }
  const location: DeliveryLocation = {
    latitude,
    longitude,
    accuracyMeters: accuracyMeters ?? null,
  };

  const loaded = await loadDriverOrder(input.trackingCode);
  if (!loaded.ok) return loaded;
  const { row } = loaded;

  const gate = deliveryGate(row);
  if (gate) return { ok: false, error: gate };

  const resume = row.status === "delivered";
  let freshDelivery = false;

  if (row.paymentType === "prepaid" && !resume) {
    const otp = typeof input.otp === "string" ? input.otp : "";
    if (!isDeliveryOtp(otp)) return { ok: false, error: "otp_required" };

    const verified = await verifyPrepaidOtp(row.id, otp);
    if (!verified.ok) {
      // An order with no issued code comes back from Postgres as "invalid".
      const error =
        verified.error === "invalid" ? "otp_unavailable" : fromLogistics(verified.error);
      return { ok: false, error };
    }
    if (!verified.valid) {
      return {
        ok: false,
        error: verified.attemptsRemaining === 0 ? "otp_locked" : "otp_invalid",
        attemptsRemaining: verified.attemptsRemaining,
      };
    }
  }

  if (!resume) {
    const partial = isRecord(input.partial) ? input.partial : null;
    if (partial) {
      const deliveredPieces = partial.deliveredPieces;
      const returnedPieces = partial.returnedPieces;
      const collectedAmount =
        typeof partial.collectedAmount === "string" ? partial.collectedAmount : "";
      if (
        typeof deliveredPieces !== "number" ||
        typeof returnedPieces !== "number" ||
        deliveredPieces < 1 ||
        returnedPieces < 1 ||
        deliveredPieces + returnedPieces !== row.piecesCount ||
        row.piecesCount < 2
      ) {
        return { ok: false, error: "partial_invalid" };
      }
      const collectedCents = parseNonNegativeMoneyCents(collectedAmount);
      const priceCents = parseNonNegativeMoneyCents(row.productPrice);
      if (
        collectedCents === null ||
        (row.paymentType === "cod" && priceCents !== null && collectedCents > priceCents) ||
        (row.paymentType === "prepaid" && collectedCents !== BigInt(0))
      ) {
        return { ok: false, error: "partial_invalid" };
      }
      const delivered = await markPartialDelivered(row.id, location, {
        deliveredPieces,
        returnedPieces,
        collectedAmount: formatCents(collectedCents),
      });
      if (!delivered.ok) {
        return {
          ok: false,
          error: delivered.error === "invalid" ? "partial_invalid" : fromLogistics(delivered.error),
        };
      }
    } else {
      const delivered = await markDelivered(row.id, location);
      if (!delivered.ok) return { ok: false, error: fromLogistics(delivered.error) };
    }
    freshDelivery = true;
  }

  const posting =
    row.paymentType === "cod"
      ? await postCodDebit(row.id)
      : await postPrepaidCredit(row.id);

  // The order is delivered from here on, whatever the posting does.
  revalidateOrder(row.trackingCode);

  if (!posting.ok) {
    if (freshDelivery && posting.error !== "conflict") {
      after(() => alertDelivered(row.trackingCode, { notice: false }));
    }
    if (posting.error === "conflict") return { ok: false, error: "already_completed" };
    return { ok: false, error: "ledger_failed", delivered: true };
  }

  after(() => alertDelivered(row.trackingCode, { whatsapp: freshDelivery }));

  return {
    ok: true,
    trackingCode: row.trackingCode,
    paymentType: row.paymentType,
    posted: posting.posted,
    amount: posting.amount,
    balanceAfter: posting.balanceAfter,
  };
}
