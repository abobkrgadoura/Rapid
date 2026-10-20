"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SessionProfile } from "@/lib/auth/profile";
import { getAuthSession } from "@/lib/auth/session";
import {
  codDebitCents,
  formatCents,
  parseNonNegativeMoneyCents,
  parsePositiveMoneyCents,
  parseSignedMoneyCents,
  prepaidCreditCents,
} from "@/lib/money";
import { generateDeliveryOtp, isDeliveryOtp } from "@/lib/otp";
import { createClient } from "@/utils/supabase/server";

/**
 * Delivery money movement and prepaid OTP. Pickup, hub receipt, and loading
 * a parcel for delivery live in src/actions/hub.ts.
 *
 * The signed-in profile is read from the server session. Client arguments
 * identify the row, never the caller's role. Amounts for COD and prepaid
 * are computed inside Postgres from the order row and posted with the
 * transactions insert in the same function. These actions reject a posting
 * whose shape does not match that contract.
 *
 * orders.delivery_otp is not selectable by authenticated clients. Do not
 * add it to a .select() list.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const WALLET_TYPES = [
  "cod_debt",
  "prepaid_earning",
  "settlement",
  "payout",
] as const;

export type LogisticsErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid"
  | "conflict"
  | "locked"
  | "insufficient"
  | "otp_required"
  | "failed";

export type LogisticsResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: LogisticsErrorCode };

export type WalletTransactionType = (typeof WALLET_TYPES)[number];

export type LedgerPost = {
  posted: boolean;
  transactionId: string | null;
  walletId: string;
  orderId: string | null;
  type: WalletTransactionType | null;
  amount: string;
  balanceAfter: string;
};

export type DeliveryPreview = {
  orderId: string;
  paymentType: "cod" | "prepaid";
  type: "cod_debt" | "prepaid_earning";
  amount: string;
};

export type IssuedOtp = {
  orderId: string;
  code: string;
};

export type OtpVerification = {
  valid: boolean;
  attemptsRemaining: number;
};

type ReadyClient = {
  supabase: SupabaseClient;
  profile: SessionProfile;
};

function canonicalUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWalletType(value: unknown): value is WalletTransactionType {
  return (
    typeof value === "string" &&
    (WALLET_TYPES as readonly string[]).includes(value)
  );
}

function mapRpcError(error: { message?: string }): LogisticsErrorCode {
  const match = error.message?.match(/rapid:[a-z0-9_]+/);
  switch (match?.[0]) {
    case "rapid:unauthorized":
      return "unauthorized";
    case "rapid:forbidden":
      return "forbidden";
    case "rapid:invalid":
      return "invalid";
    case "rapid:conflict":
      return "conflict";
    case "rapid:locked":
      return "locked";
    case "rapid:insufficient":
      return "insufficient";
    case "rapid:otp_required":
      return "otp_required";
    default:
      return "failed";
  }
}

async function readyClient(): Promise<
  LogisticsResult<never> | { ok: true; client: ReadyClient }
> {
  const session = await getAuthSession();
  if (session.status === "anonymous") {
    return { ok: false, error: "unauthorized" };
  }
  if (session.status !== "ready") {
    return { ok: false, error: "forbidden" };
  }

  return {
    ok: true,
    client: {
      supabase: await createClient(),
      profile: session.profile,
    },
  };
}

async function callRpc(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown } | { error: LogisticsErrorCode }> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const code = mapRpcError(error);
    if (code === "failed") {
      console.error("logistics rpc failed", fn, error.code, error.message);
    }
    return { error: code };
  }
  return { data };
}

function canonicalMoney(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cents = parseSignedMoneyCents(value);
  if (cents === null) return null;
  return formatCents(cents);
}

function parseLedgerPost(value: unknown): LedgerPost | null {
  if (!isRecord(value) || typeof value.posted !== "boolean") return null;
  const walletId = canonicalUuid(value.wallet_id);
  if (walletId === null) return null;

  const amount = canonicalMoney(value.amount);
  const balanceAfter = canonicalMoney(value.balance_after);
  if (amount === null || balanceAfter === null) return null;

  const orderId = value.order_id === null ? null : canonicalUuid(value.order_id);
  if (value.order_id !== null && orderId === null) return null;

  const transactionId =
    value.transaction_id === null ? null : canonicalUuid(value.transaction_id);
  if (value.transaction_id !== null && transactionId === null) return null;

  if (value.type !== null && !isWalletType(value.type)) return null;
  const type = value.type === null ? null : value.type;

  if (value.posted) {
    if (transactionId === null || type === null) return null;
  } else if (transactionId !== null || type !== null) {
    return null;
  }

  return {
    posted: value.posted,
    transactionId,
    walletId,
    orderId,
    type,
    amount,
    balanceAfter,
  };
}

function deliveryPostingMatches(
  paymentType: "cod" | "prepaid",
  posting: LedgerPost,
): boolean {
  if (posting.orderId === null) return false;
  const cents = parseSignedMoneyCents(posting.amount);
  if (cents === null) return false;

  if (!posting.posted) {
    return (
      cents === BigInt(0) && posting.type === null && posting.transactionId === null
    );
  }

  if (paymentType === "cod") {
    return posting.type === "cod_debt" && cents < BigInt(0);
  }
  return posting.type === "prepaid_earning" && cents > BigInt(0);
}

async function postDelivery(
  orderId: string,
  paymentType: "cod" | "prepaid",
): Promise<LogisticsResult<LedgerPost>> {
  const id = canonicalUuid(orderId);
  if (id === null) return { ok: false, error: "invalid" };

  const ready = await readyClient();
  if (!ready.ok) return ready;
  if (ready.client.profile.role !== "admin" && ready.client.profile.role !== "driver") {
    return { ok: false, error: "forbidden" };
  }

  const result = await callRpc(ready.client.supabase, "post_delivery_ledger", {
    p_order_id: id,
    p_payment_type: paymentType,
  });
  if ("error" in result) return { ok: false, error: result.error };

  const posting = parseLedgerPost(result.data);
  if (!posting || posting.orderId !== id || !deliveryPostingMatches(paymentType, posting)) {
    console.error("logistics delivery posting did not match the wallet contract");
    return { ok: false, error: "failed" };
  }

  return { ok: true, ...posting };
}

/**
 * Signed wallet preview. Postgres computes the delta; this rejects the
 * result when it disagrees with the COD / prepaid formulas in src/lib/money.ts.
 */
export async function previewDeliveryLedger(
  orderId: string,
): Promise<LogisticsResult<DeliveryPreview>> {
  const id = canonicalUuid(orderId);
  if (id === null) return { ok: false, error: "invalid" };

  const ready = await readyClient();
  if (!ready.ok) return ready;

  const result = await callRpc(ready.client.supabase, "preview_delivery_ledger", {
    p_order_id: id,
  });
  if ("error" in result) return { ok: false, error: result.error };
  if (!isRecord(result.data)) return { ok: false, error: "failed" };

  const paymentType = result.data.payment_type;
  if (paymentType !== "cod" && paymentType !== "prepaid") {
    return { ok: false, error: "failed" };
  }
  const type = paymentType === "cod" ? "cod_debt" : "prepaid_earning";
  if (result.data.type !== type) {
    return { ok: false, error: "failed" };
  }
  if (canonicalUuid(result.data.order_id) !== id) return { ok: false, error: "failed" };

  const productPrice = result.data.product_price;
  const deliveryFee = result.data.delivery_fee;
  const platformCommission = result.data.platform_commission;
  const amount = canonicalMoney(result.data.amount);
  if (
    typeof productPrice !== "string" ||
    typeof deliveryFee !== "string" ||
    typeof platformCommission !== "string" ||
    amount === null
  ) {
    return { ok: false, error: "failed" };
  }

  const productCents = parseNonNegativeMoneyCents(productPrice);
  const feeCents = parseNonNegativeMoneyCents(deliveryFee);
  const commissionCents = parseNonNegativeMoneyCents(platformCommission);
  if (productCents === null || feeCents === null || commissionCents === null) {
    return { ok: false, error: "failed" };
  }

  let expected: string;
  try {
    expected = formatCents(
      paymentType === "cod"
        ? codDebitCents(productCents, commissionCents)
        : prepaidCreditCents(feeCents, commissionCents),
    );
  } catch {
    return { ok: false, error: "failed" };
  }

  if (expected !== amount) {
    console.error("delivery ledger formula disagreed with Postgres");
    return { ok: false, error: "failed" };
  }

  return {
    ok: true,
    orderId: id,
    paymentType,
    type,
    amount,
  };
}

/** COD: debit product price + platform commission. The order must be delivered. */
export async function postCodDebit(
  orderId: string,
): Promise<LogisticsResult<LedgerPost>> {
  return postDelivery(orderId, "cod");
}

/**
 * Prepaid: credit delivery fee − platform commission.
 * The assigned driver must already have verified the delivery OTP.
 */
export async function postPrepaidCredit(
  orderId: string,
): Promise<LogisticsResult<LedgerPost>> {
  return postDelivery(orderId, "prepaid");
}

/** Driver GPS fix reported at handoff. */
export type DeliveryLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
};

export type DeliveryTransition = {
  orderId: string;
  status: "delivered";
};

function parseTransition(
  value: unknown,
  orderId: string,
  expected: DeliveryTransition["status"],
): DeliveryTransition | null {
  if (!isRecord(value)) return null;
  if (canonicalUuid(value.order_id) !== orderId) return null;
  if (value.status !== expected) return null;
  return { orderId, status: expected };
}

/**
 * Assigned (delivery) driver or admin. The order must be in_transit, which
 * only startDeliveryFromHub (src/actions/hub.ts) produces. Marks it delivered
 * and stores the GPS fix.
 * Moves no money: call postCodDebit / postPrepaidCredit afterwards. A prepaid
 * order is rejected with `otp_required` until verifyPrepaidOtp has succeeded.
 * Repeating the call on an unposted delivered order is a no-op, so a failed
 * ledger post can be retried.
 */
export async function markDelivered(
  orderId: string,
  location: DeliveryLocation,
): Promise<LogisticsResult<DeliveryTransition>> {
  const id = canonicalUuid(orderId);
  if (id === null) return { ok: false, error: "invalid" };

  if (
    !isRecord(location) ||
    typeof location.latitude !== "number" ||
    typeof location.longitude !== "number" ||
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude) ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    return { ok: false, error: "invalid" };
  }

  let accuracy: number | null = null;
  if (location.accuracyMeters !== undefined && location.accuracyMeters !== null) {
    if (
      typeof location.accuracyMeters !== "number" ||
      !Number.isFinite(location.accuracyMeters) ||
      location.accuracyMeters < 0 ||
      location.accuracyMeters > 9_999_999
    ) {
      return { ok: false, error: "invalid" };
    }
    accuracy = location.accuracyMeters;
  }

  const ready = await readyClient();
  if (!ready.ok) return ready;
  if (ready.client.profile.role !== "admin" && ready.client.profile.role !== "driver") {
    return { ok: false, error: "forbidden" };
  }

  const result = await callRpc(ready.client.supabase, "complete_delivery", {
    p_order_id: id,
    p_latitude: location.latitude,
    p_longitude: location.longitude,
    p_accuracy_meters: accuracy,
  });
  if ("error" in result) return { ok: false, error: result.error };

  const transition = parseTransition(result.data, id, "delivered");
  if (!transition) return { ok: false, error: "failed" };
  return { ok: true, ...transition };
}

export type PartialHandoff = {
  deliveredPieces: number;
  returnedPieces: number;
  /** Canonical non-negative money. Zero on a prepaid partial. */
  collectedAmount: string;
};

/**
 * Assigned driver. Records a partial handoff and marks the order delivered
 * in one database call, then the caller posts the ledger. COD cash is the
 * collected amount, which must not exceed the product price.
 */
export async function markPartialDelivered(
  orderId: string,
  location: DeliveryLocation,
  partial: PartialHandoff,
): Promise<LogisticsResult<DeliveryTransition>> {
  const id = canonicalUuid(orderId);
  if (id === null) return { ok: false, error: "invalid" };

  if (
    !Number.isInteger(partial.deliveredPieces) ||
    !Number.isInteger(partial.returnedPieces) ||
    partial.deliveredPieces < 1 ||
    partial.returnedPieces < 1
  ) {
    return { ok: false, error: "invalid" };
  }

  const collected = parseNonNegativeMoneyCents(partial.collectedAmount);
  if (collected === null) return { ok: false, error: "invalid" };

  if (
    !isRecord(location) ||
    typeof location.latitude !== "number" ||
    typeof location.longitude !== "number" ||
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude) ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    return { ok: false, error: "invalid" };
  }

  let accuracy: number | null = null;
  if (location.accuracyMeters !== undefined && location.accuracyMeters !== null) {
    if (
      typeof location.accuracyMeters !== "number" ||
      !Number.isFinite(location.accuracyMeters) ||
      location.accuracyMeters < 0 ||
      location.accuracyMeters > 9_999_999
    ) {
      return { ok: false, error: "invalid" };
    }
    accuracy = location.accuracyMeters;
  }

  const ready = await readyClient();
  if (!ready.ok) return ready;
  if (ready.client.profile.role !== "admin" && ready.client.profile.role !== "driver") {
    return { ok: false, error: "forbidden" };
  }

  const result = await callRpc(ready.client.supabase, "complete_partial_delivery", {
    p_order_id: id,
    p_latitude: location.latitude,
    p_longitude: location.longitude,
    p_accuracy_meters: accuracy,
    p_delivered: partial.deliveredPieces,
    p_returned: partial.returnedPieces,
    p_collected: formatCents(collected),
  });
  if ("error" in result) return { ok: false, error: result.error };

  const transition = parseTransition(result.data, id, "delivered");
  if (!transition) return { ok: false, error: "failed" };
  return { ok: true, ...transition };
}

async function postCashMovement(
  fn: "record_driver_settlement" | "record_driver_payout",
  driverId: string,
  amount: string,
  orderId: string | null | undefined,
  type: "settlement" | "payout",
): Promise<LogisticsResult<LedgerPost>> {
  const id = canonicalUuid(driverId);
  if (id === null) return { ok: false, error: "invalid" };

  const cents = parsePositiveMoneyCents(amount);
  if (cents === null) return { ok: false, error: "invalid" };

  let linkedOrder: string | null = null;
  if (orderId !== undefined && orderId !== null) {
    linkedOrder = canonicalUuid(orderId);
    if (linkedOrder === null) return { ok: false, error: "invalid" };
  }

  const ready = await readyClient();
  if (!ready.ok) return ready;
  if (ready.client.profile.role !== "admin") {
    return { ok: false, error: "forbidden" };
  }

  const result = await callRpc(ready.client.supabase, fn, {
    p_driver_id: id,
    p_amount: formatCents(cents),
    p_order_id: linkedOrder,
  });
  if ("error" in result) return { ok: false, error: result.error };

  const posting = parseLedgerPost(result.data);
  const postedCents = posting ? parseSignedMoneyCents(posting.amount) : null;
  const signOk =
    postedCents !== null &&
    (type === "settlement" ? postedCents > BigInt(0) : postedCents < BigInt(0));

  if (
    !posting ||
    !posting.posted ||
    posting.type !== type ||
    !signOk ||
    posting.orderId !== linkedOrder
  ) {
    console.error("logistics cash movement did not match the wallet contract");
    return { ok: false, error: "failed" };
  }

  return { ok: true, ...posting };
}

/**
 * Admin records cash the driver handed the platform.
 * The amount is a positive magnitude and is stored as a positive settlement.
 * It cannot exceed the driver's debt.
 */
export async function postDriverSettlement(
  driverId: string,
  amount: string,
  orderId?: string | null,
): Promise<LogisticsResult<LedgerPost>> {
  return postCashMovement(
    "record_driver_settlement",
    driverId,
    amount,
    orderId,
    "settlement",
  );
}

/**
 * Admin pays the driver. The amount is a positive magnitude and is stored
 * as a negative payout. It cannot exceed the balance the platform owes.
 */
export async function postDriverPayout(
  driverId: string,
  amount: string,
  orderId?: string | null,
): Promise<LogisticsResult<LedgerPost>> {
  return postCashMovement("record_driver_payout", driverId, amount, orderId, "payout");
}

/** Merchant or admin. Stores a new 4-digit code on a prepaid order and returns it once. */
export async function issuePrepaidOtp(
  orderId: string,
): Promise<LogisticsResult<IssuedOtp>> {
  const id = canonicalUuid(orderId);
  if (id === null) return { ok: false, error: "invalid" };

  const ready = await readyClient();
  if (!ready.ok) return ready;
  if (
    ready.client.profile.role !== "admin" &&
    ready.client.profile.role !== "merchant"
  ) {
    return { ok: false, error: "forbidden" };
  }

  const code = generateDeliveryOtp();
  const result = await callRpc(ready.client.supabase, "issue_delivery_otp", {
    p_order_id: id,
    p_code: code,
  });
  if ("error" in result) return { ok: false, error: result.error };
  if (result.data !== code || !isDeliveryOtp(code)) {
    return { ok: false, error: "failed" };
  }

  return { ok: true, orderId: id, code };
}

/** Assigned driver or admin. Five failures lock the code until it is reissued. */
export async function verifyPrepaidOtp(
  orderId: string,
  code: string,
): Promise<LogisticsResult<OtpVerification>> {
  const id = canonicalUuid(orderId);
  if (id === null || !isDeliveryOtp(code)) {
    return { ok: false, error: "invalid" };
  }

  const ready = await readyClient();
  if (!ready.ok) return ready;
  if (ready.client.profile.role !== "admin" && ready.client.profile.role !== "driver") {
    return { ok: false, error: "forbidden" };
  }

  const result = await callRpc(ready.client.supabase, "verify_delivery_otp", {
    p_order_id: id,
    p_code: code,
  });
  if ("error" in result) return { ok: false, error: result.error };
  if (!isRecord(result.data) || typeof result.data.valid !== "boolean") {
    return { ok: false, error: "failed" };
  }

  const attemptsRemaining = result.data.attempts_remaining;
  if (
    typeof attemptsRemaining !== "number" ||
    !Number.isInteger(attemptsRemaining) ||
    attemptsRemaining < 0 ||
    attemptsRemaining > 5
  ) {
    return { ok: false, error: "failed" };
  }

  return { ok: true, valid: result.data.valid, attemptsRemaining };
}

/** Merchant, customer, or admin. Drivers do not receive the code. */
export async function readPrepaidOtp(
  orderId: string,
): Promise<LogisticsResult<IssuedOtp>> {
  const id = canonicalUuid(orderId);
  if (id === null) return { ok: false, error: "invalid" };

  const ready = await readyClient();
  if (!ready.ok) return ready;

  const role = ready.client.profile.role;
  if (role !== "admin" && role !== "merchant" && role !== "customer") {
    return { ok: false, error: "forbidden" };
  }

  const result = await callRpc(ready.client.supabase, "read_delivery_otp", {
    p_order_id: id,
  });
  if ("error" in result) return { ok: false, error: result.error };
  if (typeof result.data !== "string" || !isDeliveryOtp(result.data)) {
    return { ok: false, error: "failed" };
  }

  return { ok: true, orderId: id, code: result.data };
}
