"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { receiveOrderAtHub } from "@/actions/hub";
import { isStaffType, sortingCode, type DispatchLeg } from "@/lib/admin/labels";
import {
  adminClient,
  adminRpc,
  canonicalUuid,
  isMigrationPending,
  isRecord,
} from "@/lib/admin/rpc";
import {
  ADMIN_ERROR_MESSAGES,
  HUB_ERROR_AR,
  type AdminErrorCode,
  type AdminResult,
  type DispatchOutcome,
  type InboundScan,
  type OutboundScan,
  type ScanInfo,
  type ScanResult,
  type SkipReason,
  type StaffCreated,
  type StaffEditInput,
  type StaffInput,
  type StaffReleased,
  type StaffUpdated,
} from "@/lib/admin/types";
import {
  isKycStatus,
  isVehicleType,
  type KycStatus,
  type VehicleType,
} from "@/lib/locale/sudan";
import { canonicalMoney } from "@/lib/format-money";
import { publicAreaFromDropoff } from "@/lib/orders/public-area";
import { formatAuthPhone, phoneLookupValues } from "@/lib/auth/identifier";
import { decodeRecipientDropoff, normalizeSudanPhone } from "@/lib/orders/recipient";
import { driverBlockedFromCod, shipmentBatchHasCod } from "@/lib/pricing/custody";
import { isOrderStatus, isPaymentType } from "@/lib/orders/status";
import { normalizeTrackingCode } from "@/lib/orders/tracking";
import { alertOutForDelivery } from "@/lib/orders/status-alerts";
import { notifyOutForDelivery } from "@/lib/whatsapp/notify";
import { createServiceClient } from "@/utils/supabase/service";

/**
 * Admin Control Tower writes.
 *
 * The caller is the signed-in admin according to the server session, and every
 * Postgres function re-checks `is_admin()` itself (supabase/migrations/
 * 0007_phase11_staff_management.sql). Arguments only select rows. The one use
 * of the service-role client is creating the auth user for a new staff member:
 * the admin session has already authorized that, and the client never
 * receives anything the service role read.
 */

const BATCH_LIMIT = 200;
const SKIP_REASONS: readonly SkipReason[] = [
  "not_found",
  "not_pending",
  "not_at_hub",
  "same_driver",
  "invalid",
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function refresh() {
  revalidatePath("/admin");
  revalidatePath("/admin/hub");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/exceptions");
  revalidatePath("/admin/staff");
  revalidatePath("/admin/finance");
  revalidatePath("/driver");
  revalidatePath("/merchant");
}

function fail(error: AdminErrorCode): { ok: false; error: AdminErrorCode } {
  return { ok: false, error };
}

function scanFail(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

/** Skip reasons from the dispatch RPC, as the error a single scan shows. */
function skipMessage(reason: SkipReason): string {
  switch (reason) {
    case "not_found":
      return ADMIN_ERROR_MESSAGES.not_found;
    case "not_pending":
      return ADMIN_ERROR_MESSAGES.not_pending;
    case "not_at_hub":
      return ADMIN_ERROR_MESSAGES.not_at_hub;
    case "same_driver":
      return ADMIN_ERROR_MESSAGES.same_driver;
    default:
      return ADMIN_ERROR_MESSAGES.invalid;
  }
}

function parseOutcome(value: unknown): DispatchOutcome | null {
  if (!isRecord(value)) return null;
  const strings = (raw: unknown): string[] | null =>
    Array.isArray(raw) && raw.every((item) => typeof item === "string")
      ? (raw as string[])
      : null;

  const assigned = strings(value.assigned);
  const newlyOut = strings(value.newly_out_for_delivery);
  if (!assigned || !newlyOut || !Array.isArray(value.skipped)) return null;

  const skipped: DispatchOutcome["skipped"] = [];
  for (const item of value.skipped) {
    if (!isRecord(item) || typeof item.code !== "string") return null;
    const reason = SKIP_REASONS.find((known) => known === item.reason);
    if (!reason) return null;
    skipped.push({ code: item.code, reason });
  }

  return { assigned, newlyOut, skipped };
}

/** What the scanner shows after a parcel is handled. Admin JWT, RLS applies. */
async function loadScanInfo(
  supabase: SupabaseClient,
  code: string,
): Promise<ScanInfo | null> {
  const { data, error } = await supabase
    .from("orders_readable")
    .select("tracking_code, merchant_id, driver_id, payment_type, product_price, dropoff_address")
    .eq("tracking_code", code)
    .maybeSingle();
  if (error || !isRecord(data)) return null;

  const merchantId = canonicalUuid(data.merchant_id);
  const driverId = canonicalUuid(data.driver_id);
  const price = canonicalMoney(data.product_price);
  if (
    !merchantId ||
    price === null ||
    typeof data.dropoff_address !== "string" ||
    !isPaymentType(data.payment_type)
  ) {
    return null;
  }

  const ids = driverId ? [merchantId, driverId] : [merchantId];
  const profiles = await supabase
    .from("profiles")
    .select("id, full_name, company_name, email")
    .in("id", ids);

  const names = new Map<string, string>();
  if (!profiles.error && Array.isArray(profiles.data)) {
    for (const row of profiles.data) {
      if (!isRecord(row)) continue;
      const id = canonicalUuid(row.id);
      const pick = (value: unknown) =>
        typeof value === "string" && value.trim() ? value.trim() : null;
      const name = pick(row.company_name) ?? pick(row.full_name) ?? pick(row.email);
      if (id && name) names.set(id, name);
    }
  }

  const zone = publicAreaFromDropoff(data.dropoff_address);
  return {
    trackingCode: code,
    zone,
    sortCode: sortingCode(zone),
    merchantName: names.get(merchantId) ?? "تاجر",
    paymentType: data.payment_type,
    cod: data.payment_type === "cod" ? price : null,
    customerName: decodeRecipientDropoff(data.dropoff_address).customerName,
    driverName: driverId ? (names.get(driverId) ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Hub scanner
// ---------------------------------------------------------------------------

/** Inbound scan: picked_up -> at_hub. Safe to scan twice. Returns the sorting info. */
export async function scanInbound(trackingCode: string): Promise<ScanResult<InboundScan>> {
  const code = typeof trackingCode === "string" ? normalizeTrackingCode(trackingCode) : null;
  if (code === null) return scanFail(HUB_ERROR_AR.invalid_code);

  const ready = await adminClient();
  if (!ready.ok) return scanFail(ADMIN_ERROR_MESSAGES[ready.error]);

  const received = await receiveOrderAtHub(code);
  if (!received.ok) return scanFail(HUB_ERROR_AR[received.error]);

  const info = await loadScanInfo(ready.client.supabase, code);
  return { ok: true, info, alreadyReceived: received.alreadyReceived };
}

/**
 * Outbound scan: hands an at_hub parcel to the chosen active delivery driver
 * and moves it to in_transit. A parcel already out with a different driver is
 * refused here (the orders desk is where an admin deliberately reassigns).
 */
export async function scanOutbound(
  trackingCode: string,
  driverId: string,
): Promise<ScanResult<OutboundScan>> {
  const code = typeof trackingCode === "string" ? normalizeTrackingCode(trackingCode) : null;
  if (code === null) return scanFail(HUB_ERROR_AR.invalid_code);
  const driver = canonicalUuid(driverId);
  if (driver === null) return scanFail(ADMIN_ERROR_MESSAGES.invalid);

  const ready = await adminClient();
  if (!ready.ok) return scanFail(ADMIN_ERROR_MESSAGES[ready.error]);
  const { supabase } = ready.client;

  const existing = await supabase
    .from("orders_readable")
    .select("status, driver_id, payment_type")
    .eq("tracking_code", code)
    .maybeSingle();
  if (existing.error) {
    console.error("admin outbound lookup", existing.error.message);
    return scanFail(ADMIN_ERROR_MESSAGES.failed);
  }
  if (!isRecord(existing.data)) return scanFail(ADMIN_ERROR_MESSAGES.not_found);
  if (
    existing.data.status === "in_transit" &&
    canonicalUuid(existing.data.driver_id) !== driver
  ) {
    return scanFail(ADMIN_ERROR_MESSAGES.taken);
  }
  if (
    existing.data.payment_type === "cod" &&
    (await driverBlockedFromCod(supabase, driver))
  ) {
    return scanFail(ADMIN_ERROR_MESSAGES.cash_limit);
  }

  const result = await adminRpc(supabase, "admin_dispatch_orders", {
    p_tracking_codes: [code],
    p_driver_id: driver,
    p_leg: "delivery" satisfies DispatchLeg,
  });
  if ("error" in result) return scanFail(ADMIN_ERROR_MESSAGES[result.error]);

  const outcome = parseOutcome(result.data);
  if (!outcome) return scanFail(ADMIN_ERROR_MESSAGES.failed);
  const skipped = outcome.skipped.find((item) => item.code === code);
  if (skipped) return scanFail(skipMessage(skipped.reason));
  if (!outcome.assigned.includes(code)) return scanFail(ADMIN_ERROR_MESSAGES.failed);

  refresh();
  revalidatePath(`/track/${code}`);
  const newlyOut = outcome.newlyOut.includes(code);
  if (newlyOut) {
    after(async () => {
      await notifyOutForDelivery(code);
      await alertOutForDelivery(code);
    });
  }

  const info = await loadScanInfo(supabase, code);
  return { ok: true, info, alreadyLoaded: !newlyOut };
}

// ---------------------------------------------------------------------------
// Dispatching and overrides
// ---------------------------------------------------------------------------

/**
 * Bulk assignment of selected parcels to one active driver.
 * `pickup` reserves pending parcels for a pickup driver; `delivery` sends
 * at_hub parcels out with a delivery driver. Parcels that do not fit the leg
 * are skipped and reported, never forced.
 */
export async function assignOrders(
  trackingCodes: string[],
  driverId: string,
  leg: DispatchLeg,
): Promise<AdminResult<{ outcome: DispatchOutcome }>> {
  if (leg !== "pickup" && leg !== "delivery") return fail("invalid");
  const driver = canonicalUuid(driverId);
  if (driver === null) return fail("invalid");
  if (
    !Array.isArray(trackingCodes) ||
    trackingCodes.length < 1 ||
    trackingCodes.length > BATCH_LIMIT
  ) {
    return fail("invalid");
  }

  const codes = new Set<string>();
  for (const raw of trackingCodes) {
    const code = typeof raw === "string" ? normalizeTrackingCode(raw) : null;
    if (code === null) return fail("invalid");
    codes.add(code);
  }

  const ready = await adminClient();
  if (!ready.ok) return fail(ready.error);

  if (
    leg === "delivery" &&
    (await shipmentBatchHasCod(ready.client.supabase, [...codes])) &&
    (await driverBlockedFromCod(ready.client.supabase, driver))
  ) {
    return fail("cash_limit");
  }

  const result = await adminRpc(ready.client.supabase, "admin_dispatch_orders", {
    p_tracking_codes: [...codes],
    p_driver_id: driver,
    p_leg: leg,
  });
  if ("error" in result) return fail(result.error);

  const outcome = parseOutcome(result.data);
  if (!outcome) return fail("failed");

  refresh();
  if (leg === "delivery" && outcome.newlyOut.length > 0) {
    const out = outcome.newlyOut;
    after(async () => {
      for (const code of out) {
        await notifyOutForDelivery(code);
        await alertOutForDelivery(code);
      }
    });
  }

  return { ok: true, outcome };
}

export type OverrideStatus =
  | "pending"
  | "picked_up"
  | "at_hub"
  | "in_transit"
  | "returned"
  | "cancelled";

export type OverrideUnassign = "delivery" | "pickup" | "both";

const OVERRIDE_STATUSES: readonly string[] = [
  "pending",
  "picked_up",
  "at_hub",
  "in_transit",
  "returned",
  "cancelled",
];

/**
 * Admin status override: move a parcel to another position (including RTO)
 * and/or release its drivers. Delivered parcels and parcels with a ledger
 * entry are refused by Postgres.
 */
export async function overrideOrder(
  trackingCode: string,
  status: OverrideStatus | null,
  unassign: OverrideUnassign | null,
): Promise<AdminResult<{ status: string; changed: boolean }>> {
  const code = typeof trackingCode === "string" ? normalizeTrackingCode(trackingCode) : null;
  if (code === null) return fail("invalid");
  if (status !== null && !OVERRIDE_STATUSES.includes(status)) return fail("invalid");
  if (unassign !== null && !["delivery", "pickup", "both"].includes(unassign)) {
    return fail("invalid");
  }
  if (status === null && unassign === null) return fail("invalid");

  const ready = await adminClient();
  if (!ready.ok) return fail(ready.error);

  const prior = await ready.client.supabase
    .from("orders_readable")
    .select("status")
    .eq("tracking_code", code)
    .maybeSingle();
  const priorStatus =
    !prior.error && isRecord(prior.data) && typeof prior.data.status === "string"
      ? prior.data.status
      : null;

  const result = await adminRpc(ready.client.supabase, "admin_override_order", {
    p_tracking_code: code,
    p_status: status,
    p_unassign: unassign,
  });
  if ("error" in result) return fail(result.error);

  const data = result.data;
  if (
    !isRecord(data) ||
    data.tracking_code !== code ||
    typeof data.status !== "string" ||
    !isOrderStatus(data.status) ||
    typeof data.changed !== "boolean"
  ) {
    return fail("failed");
  }

  refresh();
  revalidatePath(`/track/${code}`);
  if (data.changed && data.status === "in_transit" && priorStatus && priorStatus !== "in_transit") {
    after(() => alertOutForDelivery(code));
  }
  return { ok: true, status: data.status, changed: data.changed };
}

// ---------------------------------------------------------------------------
// Staff and fleet
// ---------------------------------------------------------------------------

type CleanStaff = {
  fullName: string;
  phone: string;
  hubZone: string;
  staffType: "delivery_driver" | "pickup_driver" | "hub_operator";
  fieldDriver: boolean;
  vehicleType: VehicleType | null;
  emergencyPhone: string | null;
  kycStatus: KycStatus | null;
  maxCashLimit: number | null;
};

function parseCashLimit(value: unknown): number | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits || digits.length > 9) return null;
  const amount = Number(digits);
  if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000) return null;
  return amount;
}

function cleanStaff(input: StaffEditInput): CleanStaff | AdminErrorCode {
  if (!isRecord(input)) return "invalid";
  const fullName = typeof input.fullName === "string" ? input.fullName.trim() : "";
  const phone = typeof input.phone === "string" ? formatAuthPhone(input.phone) : null;
  const hubZone = typeof input.hubZone === "string" ? input.hubZone.trim() : "";

  if (fullName.length < 2 || fullName.length > 80) return "invalid_name";
  if (!phone) return "invalid_phone";
  if (hubZone.length < 2 || hubZone.length > 80) return "invalid_zone";
  if (!isStaffType(input.staffType)) return "invalid_staff_type";

  const fieldDriver =
    input.staffType === "delivery_driver" || input.staffType === "pickup_driver";
  if (!fieldDriver) {
    return {
      fullName,
      phone,
      hubZone,
      staffType: input.staffType,
      fieldDriver: false,
      vehicleType: null,
      emergencyPhone: null,
      kycStatus: null,
      maxCashLimit: null,
    };
  }

  if (!isVehicleType(input.vehicleType)) return "invalid_vehicle";
  const emergency =
    typeof input.emergencyPhone === "string" ? normalizeSudanPhone(input.emergencyPhone) : null;
  if (!emergency) return "invalid_emergency_phone";
  if (!isKycStatus(input.kycStatus)) return "invalid_kyc";
  const maxCashLimit = parseCashLimit(input.maxCashLimit);
  if (maxCashLimit === null) return "invalid_cash_limit";

  return {
    fullName,
    phone,
    hubZone,
    staffType: input.staffType,
    fieldDriver: true,
    vehicleType: input.vehicleType,
    emergencyPhone: emergency,
    kycStatus: input.kycStatus,
    maxCashLimit,
  };
}

function driverProfilePatch(clean: CleanStaff): Record<string, unknown> {
  const base = {
    full_name: clean.fullName,
    phone: clean.phone,
    staff_type: clean.staffType,
    hub_zone: clean.hubZone,
  };
  if (!clean.fieldDriver) return base;
  return {
    ...base,
    country_code: "SD",
    vehicle_type: clean.vehicleType,
    emergency_phone: clean.emergencyPhone,
    kyc_status: clean.kycStatus,
    max_cash_limit: clean.maxCashLimit,
  };
}

/**
 * Writes the driver profile. When 0008 is not applied yet, the name, phone,
 * zone, and type still save, and kycSaved is false.
 */
async function writeDriverProfile(
  supabase: SupabaseClient,
  staffId: string,
  clean: CleanStaff,
): Promise<AdminResult<{ kycSaved: boolean }>> {
  const base = {
    full_name: clean.fullName,
    phone: clean.phone,
    staff_type: clean.staffType,
    hub_zone: clean.hubZone,
  };
  const extended = driverProfilePatch(clean);
  const first = await supabase
    .from("profiles")
    .update(extended)
    .eq("id", staffId)
    .eq("role", "driver")
    .select("id");

  if (!first.error && Array.isArray(first.data) && first.data.length === 1) {
    return { ok: true, kycSaved: true };
  }
  if (first.error && !isMigrationPending(first.error)) {
    console.error("admin staff profile", first.error.code, first.error.message);
    return fail("failed");
  }
  if (!first.error) return fail("not_found");

  const second = await supabase
    .from("profiles")
    .update(base)
    .eq("id", staffId)
    .eq("role", "driver")
    .select("id");

  if (second.error) {
    if (isMigrationPending(second.error)) return fail("migration_pending");
    console.error("admin staff profile fallback", second.error.code, second.error.message);
    return fail("failed");
  }
  if (!Array.isArray(second.data) || second.data.length !== 1) return fail("not_found");
  return { ok: true, kycSaved: !clean.fieldDriver };
}

function staffAuthError(
  error: { code?: string; message: string } | null,
  hasEmail: boolean,
): AdminErrorCode {
  const code = error?.code ?? "";
  const message = error?.message.toLowerCase() ?? "";
  if (code === "phone_provider_disabled") return "phone_auth_disabled";
  if (code === "weak_password") return "weak_password";
  const phoneCollision =
    code === "phone_exists" ||
    (message.includes("phone") &&
      (message.includes("already") || message.includes("exists") || message.includes("registered")));
  if (phoneCollision) return "phone_taken";
  if (code === "email_exists" || (hasEmail && message.includes("already"))) return "email_taken";
  if (message.includes("already")) return hasEmail ? "email_taken" : "phone_taken";
  return "failed";
}

/**
 * Add a delivery driver, pickup driver, or hub operator.
 *
 * The login is the phone number. Email is optional and, when present, is a
 * second way to sign in. With SUPABASE_SERVICE_ROLE_KEY set, the auth user
 * (phone already confirmed, so no SMS is sent) and the driver profile are
 * created at once. Without it the action links a person who already
 * registered with this phone or email. Merchant and admin accounts are never
 * touched.
 */
export async function createStaff(
  input: StaffInput,
): Promise<AdminResult<StaffCreated>> {
  if (!isRecord(input)) return fail("invalid");
  const clean = cleanStaff(input);
  if (typeof clean === "string") return fail(clean);

  const emailRaw = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (emailRaw.length > 254 || (emailRaw.length > 0 && !EMAIL.test(emailRaw))) {
    return fail("invalid_email");
  }
  const email = emailRaw.length > 0 ? emailRaw : null;

  const password = typeof input.password === "string" ? input.password : "";

  const ready = await adminClient();
  if (!ready.ok) return fail(ready.error);
  const { supabase } = ready.client;

  const service = createServiceClient();

  if (!service) {
    const byPhone = await supabase
      .from("profiles")
      .select("id, role")
      .in("phone", phoneLookupValues(clean.phone))
      .limit(2);
    if (byPhone.error) {
      console.error("admin link staff phone", byPhone.error.code, byPhone.error.message);
      return fail("failed");
    }
    const phoneRows = Array.isArray(byPhone.data) ? byPhone.data.filter(isRecord) : [];
    if (phoneRows.length > 1) return fail("phone_taken");

    let found = phoneRows[0] ?? null;
    let matched: "phone" | "email" = "phone";
    if (!found && email) {
      const byEmail = await supabase
        .from("profiles")
        .select("id, role")
        .eq("email", email)
        .maybeSingle();
      if (byEmail.error || !isRecord(byEmail.data)) return fail("service_key_missing");
      found = byEmail.data;
      matched = "email";
    }
    if (!found) return fail("service_key_missing");

    const id = canonicalUuid(found.id);
    if (!id || (found.role !== "customer" && found.role !== "driver")) {
      return fail(matched === "email" ? "email_taken" : "phone_taken");
    }

    const linkedBase = {
      role: "driver" as const,
      full_name: clean.fullName,
      phone: clean.phone,
      staff_type: clean.staffType,
      hub_zone: clean.hubZone,
    };
    let kycSaved = true;
    let linked = await supabase
      .from("profiles")
      .update({ ...linkedBase, ...driverProfilePatch(clean) })
      .eq("id", id)
      .select("id");
    if (linked.error && isMigrationPending(linked.error)) {
      kycSaved = !clean.fieldDriver;
      linked = await supabase.from("profiles").update(linkedBase).eq("id", id).select("id");
    }
    if (linked.error) {
      if (isMigrationPending(linked.error)) return fail("migration_pending");
      console.error("admin link staff", linked.error.code, linked.error.message);
      return fail("failed");
    }
    if (!Array.isArray(linked.data) || linked.data.length !== 1) return fail("failed");

    refresh();
    return { ok: true, staffId: id, mode: "linked", kycSaved };
  }

  if (password.length < 8 || password.length > 72) return fail("weak_password");

  const created = await service.auth.admin.createUser({
    phone: clean.phone,
    password,
    phone_confirm: true,
    ...(email ? { email, email_confirm: true as const } : {}),
    user_metadata: {
      role: "driver",
      full_name: clean.fullName,
      phone: clean.phone,
    },
  });

  if (created.error || !created.data.user) {
    const code = staffAuthError(created.error, email !== null);
    if (code === "failed") {
      console.error("admin create staff auth user", created.error?.code, created.error?.message);
    }
    return fail(code);
  }

  const staffId = created.data.user.id;
  const updated = await writeDriverProfile(supabase, staffId, clean);

  if (!updated.ok) {
    // No half-made account: remove the login so the phone can be used again.
    const rollback = await service.auth.admin.deleteUser(staffId);
    if (rollback.error) {
      console.error("admin create staff rollback", rollback.error.message);
    }
    return fail(updated.error);
  }

  refresh();
  return { ok: true, staffId, mode: "created", kycSaved: updated.kycSaved };
}

/** Edit name, phone, zone, and type of a staff member. Email and password stay as they are. */
export async function updateStaff(
  staffId: string,
  input: StaffEditInput,
): Promise<AdminResult<StaffUpdated>> {
  const id = canonicalUuid(staffId);
  if (id === null) return fail("invalid");
  const clean = cleanStaff(input);
  if (typeof clean === "string") return fail(clean);

  const ready = await adminClient();
  if (!ready.ok) return fail(ready.error);

  const updated = await writeDriverProfile(ready.client.supabase, id, clean);
  if (!updated.ok) return updated;

  refresh();
  return { ok: true, staffId: id, kycSaved: updated.kycSaved };
}

function parseReleased(value: unknown, id: string): StaffReleased | null {
  if (!isRecord(value) || canonicalUuid(value.staff_id) !== id) return null;
  const count = (raw: unknown) =>
    typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : null;
  const delivery = count(value.released_delivery);
  const pickup = count(value.released_pickup);
  const repooled = count(value.repooled_pickup);
  if (delivery === null || pickup === null || repooled === null) return null;
  return { releasedDelivery: delivery, releasedPickup: pickup, repooledPickup: repooled };
}

/**
 * Suspend a staff member: is_active = false, every unfinished parcel returns
 * to the dispatch pool, and the account stops resolving to any role. Orders,
 * wallet, and ledger rows are untouched.
 */
export async function deactivateStaff(
  staffId: string,
): Promise<AdminResult<StaffReleased>> {
  const id = canonicalUuid(staffId);
  if (id === null) return fail("invalid");

  const ready = await adminClient();
  if (!ready.ok) return fail(ready.error);

  const result = await adminRpc(ready.client.supabase, "admin_deactivate_staff", {
    p_staff_id: id,
  });
  if ("error" in result) return fail(result.error);

  const released = parseReleased(result.data, id);
  if (!released) return fail("failed");

  refresh();
  return { ok: true, ...released };
}

/** Turn a suspended account back on. Parcels released earlier stay in the pool. */
export async function reactivateStaff(
  staffId: string,
): Promise<AdminResult<{ staffId: string }>> {
  const id = canonicalUuid(staffId);
  if (id === null) return fail("invalid");

  const ready = await adminClient();
  if (!ready.ok) return fail(ready.error);

  const updated = await ready.client.supabase
    .from("profiles")
    .update({ is_active: true })
    .eq("id", id)
    .eq("role", "driver")
    .select("id");

  if (updated.error) {
    if (isMigrationPending(updated.error)) return fail("migration_pending");
    console.error("admin reactivate staff", updated.error.code, updated.error.message);
    return fail("failed");
  }
  if (!Array.isArray(updated.data) || updated.data.length !== 1) return fail("not_found");

  refresh();
  return { ok: true, staffId: id };
}

/**
 * Permanently delete a staff member. Postgres refuses (has_history) when they
 * have delivered parcels or any ledger history; deactivate those instead.
 */
export async function deleteStaff(
  staffId: string,
): Promise<AdminResult<StaffReleased>> {
  const id = canonicalUuid(staffId);
  if (id === null) return fail("invalid");

  const ready = await adminClient();
  if (!ready.ok) return fail(ready.error);

  const result = await adminRpc(ready.client.supabase, "admin_delete_staff", {
    p_staff_id: id,
  });
  if ("error" in result) return fail(result.error);

  const released = parseReleased(result.data, id);
  if (!released) return fail("failed");

  refresh();
  return { ok: true, ...released };
}
