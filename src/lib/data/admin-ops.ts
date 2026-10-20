import type { SupabaseClient } from "@supabase/supabase-js";

import { isStaffType, sortingCode, type StaffType } from "@/lib/admin/labels";
import {
  CURRENCY_CODE,
  DEFAULT_MAX_CASH_SDG,
  TIME_ZONE,
  isKycStatus,
  isVehicleType,
  type KycStatus,
  type VehicleType,
} from "@/lib/locale/sudan";
import { getAuthSession } from "@/lib/auth/session";
import { canonicalMoney, sumMoney } from "@/lib/format-money";
import { parseSignedMoneyCents } from "@/lib/money";
import { safeMapsHref } from "@/lib/orders/gps-url";
import { publicAreaFromDropoff } from "@/lib/orders/public-area";
import { decodeRecipientDropoff } from "@/lib/orders/recipient";
import {
  isExceptionReason,
  readShipmentExtras,
  safeImageSrc,
  type ExceptionReason,
  type ShipmentExtras,
} from "@/lib/orders/shipment-details";
import {
  isOrderStatus,
  isPaymentType,
  type OrderStatus,
  type PaymentType,
} from "@/lib/orders/status";
import { createClient } from "@/utils/supabase/server";

/**
 * Read side of the admin Control Tower. Every loader checks the server
 * session for the admin role and then reads with the admin's own JWT, so RLS
 * stays the gate. Nothing here uses the service-role client.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Postgres "undefined column": migration 0007 has not been applied. */
const UNDEFINED_COLUMN = "42703";
/** Postgres "invalid input value for enum": `returned` does not exist yet. */
const INVALID_ENUM = "22P02";

const PAGE = 1000;
const MAX_PAGES = 50;
const ORDER_LIMIT = 500;

export type LoadResult<T> = { ok: true; data: T } | { ok: false };

export type ControlTower = {
  pendingPickup: number;
  atHub: number;
  outForDelivery: number;
  delivered: number;
  returned: number;
  activeCod: string;
  /** Attempts flagged for a 60-second burst or a GPS fix outside the dropoff. */
  suspiciousAttempts: number;
};

export type AdminOrderRow = {
  id: string;
  trackingCode: string;
  status: OrderStatus;
  paymentType: PaymentType;
  productPrice: string;
  deliveryFee: string;
  /** Cash the customer pays at the door; zero for prepaid. */
  cod: string;
  merchantName: string;
  customerName: string;
  phone: string;
  secondaryPhone: string;
  address: string;
  zone: string;
  sortCode: string;
  pickupAddress: string;
  pickupMapUrl: string | null;
  dropoffMapUrl: string | null;
  driverId: string | null;
  driverName: string | null;
  pickupDriverId: string | null;
  pickupDriverName: string | null;
  suspicious: boolean;
  createdLabel: string;
  pickedUpLabel: string | null;
  inTransitLabel: string | null;
  deliveredLabel: string | null;
  /** Delivered, or a ledger entry exists: the status can no longer be overridden. */
  locked: boolean;
  extras: ShipmentExtras | null;
};

/** An open delivery exception waiting for an admin decision. */
export type ExceptionOrder = {
  id: string;
  trackingCode: string;
  status: OrderStatus;
  driverId: string | null;
  driverName: string | null;
  reason: ExceptionReason | null;
  failedAttempts: number;
  attemptAt: string | null;
  attemptLabel: string | null;
  gpsVerified: boolean;
  distanceMeters: number | null;
  suspicious: boolean;
  whatsappProofUrl: string | null;
  callLogProofUrl: string | null;
  doorPhotoProofUrl: string | null;
  locked: boolean;
};

export type OrderLoad =
  | { ok: true; data: AdminOrderRow }
  | { ok: false; reason: "not_found" | "error" };

export type StaffRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  staffType: StaffType | null;
  hubZone: string | null;
  isActive: boolean;
  /** Pickups reserved or collected plus parcels out for delivery. */
  activeShipments: number;
  /** COD cash the driver holds for the platform: the negative wallet balance. */
  custody: string;
  balance: string;
  currency: string;
  vehicleType: VehicleType | null;
  /** Vehicle the driver selected for the current shift. */
  activeVehicle: VehicleType | null;
  emergencyPhone: string;
  kycStatus: KycStatus | null;
  /** SDG the driver is allowed to hold. */
  maxCashLimit: number;
  /** SDG currently in the driver's hands. */
  currentCashInHand: number;
};

export type StaffDirectory = {
  rows: StaffRow[];
  /** False until migration 0007 adds staff_type, is_active, and hub_zone. */
  migrationApplied: boolean;
  /** False until migration 0008 adds KYC and cash-custody columns. */
  kycApplied: boolean;
};

export type AssignableDriver = {
  id: string;
  name: string;
  staffType: StaffType | null;
  hubZone: string | null;
};

type Db = SupabaseClient;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID.test(value)) return null;
  return value.toLowerCase();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function textOrNull(value: unknown): string | null {
  const trimmed = text(value);
  return trimmed.length > 0 ? trimmed : null;
}

const timeFormat = new Intl.DateTimeFormat("ar-SD-u-nu-latn", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});

function timeLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : timeFormat.format(date);
}

function personName(row: Record<string, unknown>): string {
  return (
    textOrNull(row.company_name) ??
    textOrNull(row.full_name) ??
    textOrNull(row.email) ??
    "ط¨ط¯ظˆظ† ط§ط³ظ…"
  );
}

async function adminDb(): Promise<Db | null> {
  const session = await getAuthSession();
  if (session.status !== "ready" || session.profile.role !== "admin") return null;
  return await createClient();
}

async function countStatuses(db: Db, statuses: string[]): Promise<number | null> {
  const { count, error } = await db
    .from("orders_readable")
    .select("id", { count: "exact", head: true })
    .in("status", statuses);

  if (error?.code === INVALID_ENUM) {
    const known = statuses.filter((status) => status !== "returned");
    return known.length === 0 ? 0 : countStatuses(db, known);
  }
  if (error || count === null) {
    console.error("admin status count", error?.message);
    return null;
  }
  return count;
}

const ACTIVE_STATUSES = ["pending", "assigned", "picked_up", "at_hub", "in_transit"];

/** Sum of the cash still to be collected, paged past PostgREST's row cap. */
async function sumActiveCod(db: Db): Promise<string | null> {
  const amounts: string[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await db
      .from("orders_readable")
      .select("product_price")
      .eq("payment_type", "cod")
      .in("status", ACTIVE_STATUSES)
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);

    if (error || !Array.isArray(data)) {
      console.error("admin active cod", error?.message);
      return null;
    }

    for (const row of data) {
      const amount = isRecord(row) ? canonicalMoney(row.product_price) : null;
      if (amount === null) return null;
      amounts.push(amount);
    }

    if (data.length < PAGE) break;
  }

  return sumMoney(amounts);
}

async function countSuspicious(db: Db): Promise<number> {
  const result = await db
    .from("orders_readable")
    .select("id", { count: "exact", head: true })
    .eq("suspicious_attempt_flag", true);
  if (result.error) return 0;
  return result.count ?? 0;
}

export async function loadControlTower(): Promise<LoadResult<ControlTower>> {
  const db = await adminDb();
  if (!db) return { ok: false };

  const [pending, atHub, out, delivered, returned, cod, suspiciousAttempts] = await Promise.all([
    countStatuses(db, ["pending", "assigned"]),
    countStatuses(db, ["at_hub"]),
    countStatuses(db, ["in_transit"]),
    countStatuses(db, ["delivered"]),
    countStatuses(db, ["returned", "cancelled"]),
    sumActiveCod(db),
    countSuspicious(db),
  ]);

  if (
    pending === null ||
    atHub === null ||
    out === null ||
    delivered === null ||
    returned === null ||
    cod === null
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    data: {
      pendingPickup: pending,
      atHub,
      outForDelivery: out,
      delivered,
      returned,
      activeCod: cod,
      suspiciousAttempts,
    },
  };
}

const ORDER_COLUMNS =
  "id, tracking_code, merchant_id, driver_id, pickup_driver_id, status, payment_type, product_price, delivery_fee, pickup_address, dropoff_address, created_at, picked_up_at, in_transit_at, delivered_at, ledger_posted_at, pickup_gps_url, dropoff_gps_url";

const ORDER_COLUMNS_PHASE13 = `${ORDER_COLUMNS}, building_name, floor_number, apartment_number, landmark, is_work_address, parcel_size, pieces_count, product_description, product_image_url, allow_opening, delivery_notes, internal_notes, exception_reason, call_log_proof_url, whatsapp_proof_url, door_photo_proof_url, attempt_gps_lat, attempt_gps_lng, attempt_distance_meters, is_gps_verified, last_attempt_at, suspicious_attempt_flag, failed_attempts, is_partial_delivery, delivered_pieces_count, returned_pieces_count, partial_collected_amount`;

function toAdminOrder(
  row: Record<string, unknown>,
  names: Map<string, string>,
): AdminOrderRow | null {
  const id = uuid(row.id);
  const merchantId = uuid(row.merchant_id);
  const productPrice = canonicalMoney(row.product_price);
  const deliveryFee = canonicalMoney(row.delivery_fee);
  const created = timeLabel(row.created_at);
  if (
    !id ||
    !merchantId ||
    !productPrice ||
    !deliveryFee ||
    !created ||
    !text(row.tracking_code) ||
    typeof row.dropoff_address !== "string" ||
    typeof row.pickup_address !== "string" ||
    !isOrderStatus(row.status) ||
    !isPaymentType(row.payment_type)
  ) {
    return null;
  }

  const driverId = uuid(row.driver_id);
  const pickupDriverId = uuid(row.pickup_driver_id);
  const recipient = decodeRecipientDropoff(row.dropoff_address);
  const zone = publicAreaFromDropoff(row.dropoff_address);

  return {
    id,
    trackingCode: text(row.tracking_code),
    status: row.status,
    paymentType: row.payment_type,
    productPrice,
    deliveryFee,
    cod: row.payment_type === "cod" ? productPrice : "0.00",
    merchantName: names.get(merchantId) ?? "تاجر",
    customerName: recipient.customerName,
    phone: recipient.phone,
    secondaryPhone: recipient.secondaryPhone,
    address: recipient.dropoffAddress,
    zone,
    sortCode: sortingCode(zone),
    pickupAddress: row.pickup_address.trim(),
    pickupMapUrl: safeMapsHref(row.pickup_gps_url),
    dropoffMapUrl: safeMapsHref(row.dropoff_gps_url),
    driverId,
    driverName: driverId ? (names.get(driverId) ?? "مندوب") : null,
    pickupDriverId,
    pickupDriverName: pickupDriverId ? (names.get(pickupDriverId) ?? "مندوب") : null,
    suspicious: readShipmentExtras(row)?.attempt?.suspicious === true,
    createdLabel: created,
    pickedUpLabel: timeLabel(row.picked_up_at),
    inTransitLabel: timeLabel(row.in_transit_at),
    deliveredLabel: timeLabel(row.delivered_at),
    locked: row.status === "delivered" || row.ledger_posted_at !== null,
    extras: readShipmentExtras(row),
  };
}

async function profileNames(db: Db, ids: Set<string>): Promise<Map<string, string> | null> {
  const names = new Map<string, string>();
  if (ids.size === 0) return names;
  const profiles = await db
    .from("profiles")
    .select("id, full_name, company_name, email")
    .in("id", [...ids]);
  if (profiles.error || !Array.isArray(profiles.data)) {
    console.error("admin order names", profiles.error?.message);
    return null;
  }
  for (const row of profiles.data) {
    if (!isRecord(row)) continue;
    const id = uuid(row.id);
    if (id) names.set(id, personName(row));
  }
  return names;
}

export async function loadAdminOrders(): Promise<LoadResult<AdminOrderRow[]>> {
  const db = await adminDb();
  if (!db) return { ok: false };

  const phase = await db
    .from("orders_readable")
    .select(ORDER_COLUMNS_PHASE13)
    .order("created_at", { ascending: false })
    .limit(ORDER_LIMIT);

  const listed = missingColumn(phase.error?.code)
    ? await db
        .from("orders_readable")
        .select(ORDER_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(ORDER_LIMIT)
    : phase;

  const { data, error } = listed;

  if (error || !Array.isArray(data)) {
    console.error("admin orders", error?.message);
    return { ok: false };
  }

  const ids = new Set<string>();
  for (const row of data) {
    if (!isRecord(row)) continue;
    for (const key of ["merchant_id", "driver_id", "pickup_driver_id"] as const) {
      const id = uuid(row[key]);
      if (id) ids.add(id);
    }
  }

  const names = new Map<string, string>();
  if (ids.size > 0) {
    const profiles = await db
      .from("profiles")
      .select("id, full_name, company_name, email")
      .in("id", [...ids]);
    if (profiles.error || !Array.isArray(profiles.data)) {
      console.error("admin order names", profiles.error?.message);
      return { ok: false };
    }
    for (const row of profiles.data) {
      if (!isRecord(row)) continue;
      const id = uuid(row.id);
      if (id) names.set(id, personName(row));
    }
  }

  const rows: AdminOrderRow[] = [];
  for (const row of data) {
    if (!isRecord(row)) continue;
    const mapped = toAdminOrder(row, names);
    if (!mapped) {
      console.error("admin orders: skipped a row that did not match the schema");
      continue;
    }
    rows.push(mapped);
  }

  return { ok: true, data: rows };
}

const STAFF_COLUMNS: string = "id, full_name, email, phone, staff_type, hub_zone, is_active";
const STAFF_COLUMNS_KYC: string =
  `${STAFF_COLUMNS}, vehicle_type, emergency_phone, kyc_status, max_cash_limit, current_cash_in_hand`;
const STAFF_COLUMNS_SHIFT: string = `${STAFF_COLUMNS_KYC}, active_vehicle`;
const STAFF_COLUMNS_LEGACY: string = "id, full_name, email, phone";

function missingColumn(code: string | undefined): boolean {
  return code === UNDEFINED_COLUMN || code === "PGRST204";
}

function wholeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return fallback;
}

async function readDrivers(
  db: Db,
): Promise<{
  rows: Record<string, unknown>[];
  migrationApplied: boolean;
  kycApplied: boolean;
} | null> {
  let migrationApplied = true;
  let kycApplied = true;
  let result = await db
    .from("profiles")
    .select(STAFF_COLUMNS_SHIFT)
    .eq("role", "driver")
    .order("created_at", { ascending: true });

  if (missingColumn(result.error?.code)) {
    result = await db
      .from("profiles")
      .select(STAFF_COLUMNS_KYC)
      .eq("role", "driver")
      .order("created_at", { ascending: true });
  }

  if (missingColumn(result.error?.code)) {
    kycApplied = false;
    result = await db
      .from("profiles")
      .select(STAFF_COLUMNS)
      .eq("role", "driver")
      .order("created_at", { ascending: true });
  }

  if (missingColumn(result.error?.code)) {
    migrationApplied = false;
    result = await db
      .from("profiles")
      .select(STAFF_COLUMNS_LEGACY)
      .eq("role", "driver")
      .order("created_at", { ascending: true });
  }

  if (result.error || !Array.isArray(result.data)) {
    console.error("admin drivers", result.error?.message);
    return null;
  }

  const rows = (result.data as unknown[]).filter(isRecord);
  return { rows, migrationApplied, kycApplied };
}

export async function loadStaff(): Promise<LoadResult<StaffDirectory>> {
  const db = await adminDb();
  if (!db) return { ok: false };

  const drivers = await readDrivers(db);
  if (!drivers) return { ok: false };

  const [wallets, active] = await Promise.all([
    db.from("wallets").select("driver_id, balance, currency"),
    db
      .from("orders_readable")
      .select("driver_id, pickup_driver_id, status")
      .in("status", ["pending", "assigned", "picked_up", "in_transit"])
      .or("driver_id.not.is.null,pickup_driver_id.not.is.null")
      .limit(PAGE * 5),
  ]);

  if (
    wallets.error ||
    !Array.isArray(wallets.data) ||
    active.error ||
    !Array.isArray(active.data)
  ) {
    console.error("admin staff", wallets.error?.message, active.error?.message);
    return { ok: false };
  }

  const balances = new Map<string, { balance: string; currency: string }>();
  for (const row of wallets.data) {
    if (!isRecord(row)) continue;
    const driverId = uuid(row.driver_id);
    const balance = canonicalMoney(row.balance);
    if (!driverId || balance === null) continue;
    const currency =
      typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency)
        ? row.currency
        : CURRENCY_CODE;
    balances.set(driverId, { balance, currency });
  }

  const counts = new Map<string, number>();
  const bump = (id: string | null) => {
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  };
  for (const row of active.data) {
    if (!isRecord(row)) continue;
    const driverId = uuid(row.driver_id);
    const pickupId = uuid(row.pickup_driver_id);
    switch (row.status) {
      case "in_transit":
        bump(driverId);
        break;
      case "pending":
      case "picked_up":
        bump(pickupId);
        break;
      case "assigned":
        bump(driverId);
        if (pickupId !== driverId) bump(pickupId);
        break;
      default:
        break;
    }
  }

  const rows: StaffRow[] = [];
  for (const row of drivers.rows) {
    const id = uuid(row.id);
    if (!id) continue;
    const wallet = balances.get(id) ?? { balance: "0.00", currency: CURRENCY_CODE };
    const cents = parseSignedMoneyCents(wallet.balance) ?? BigInt(0);
    const custody = cents < BigInt(0) ? wallet.balance.replace("-", "") : "0.00";

    rows.push({
      id,
      fullName: text(row.full_name) || text(row.email) || "ط¨ط¯ظˆظ† ط§ط³ظ…",
      email: text(row.email),
      phone: text(row.phone),
      staffType: isStaffType(row.staff_type) ? row.staff_type : null,
      hubZone: textOrNull(row.hub_zone),
      isActive: row.is_active !== false,
      activeShipments: counts.get(id) ?? 0,
      custody,
      balance: wallet.balance,
      currency: wallet.currency,
      vehicleType: isVehicleType(row.vehicle_type) ? row.vehicle_type : null,
      activeVehicle: isVehicleType(row.active_vehicle) ? row.active_vehicle : null,
      emergencyPhone: text(row.emergency_phone),
      kycStatus: isKycStatus(row.kyc_status) ? row.kyc_status : null,
      maxCashLimit: wholeNumber(row.max_cash_limit, DEFAULT_MAX_CASH_SDG),
      currentCashInHand: wholeNumber(row.current_cash_in_hand, 0),
    });
  }

  return {
    ok: true,
    data: {
      rows,
      migrationApplied: drivers.migrationApplied,
      kycApplied: drivers.kycApplied,
    },
  };
}

/** Active drivers an admin may hand a parcel to. Suspended accounts never appear. */
export async function loadAssignableDrivers(): Promise<LoadResult<AssignableDriver[]>> {
  const db = await adminDb();
  if (!db) return { ok: false };

  const drivers = await readDrivers(db);
  if (!drivers) return { ok: false };

  const result: AssignableDriver[] = [];
  for (const row of drivers.rows) {
    const id = uuid(row.id);
    if (!id || row.is_active === false) continue;
    const staffType = isStaffType(row.staff_type) ? row.staff_type : null;
    if (staffType === "hub_operator") continue;
    result.push({
      id,
      name: text(row.full_name) || text(row.email) || "ط¨ط¯ظˆظ† ط§ط³ظ…",
      staffType,
      hubZone: textOrNull(row.hub_zone),
    });
  }

  result.sort((left, right) => left.name.localeCompare(right.name, "ar"));
  return { ok: true, data: result };
}

/** One order for the admin edit page. The id is the order uuid, never a role. */
export async function loadAdminOrder(id: string): Promise<OrderLoad> {
  if (!UUID.test(id)) return { ok: false, reason: "not_found" };
  const db = await adminDb();
  if (!db) return { ok: false, reason: "error" };

  const phase = await db
    .from("orders_readable")
    .select(ORDER_COLUMNS_PHASE13)
    .eq("id", id.toLowerCase())
    .maybeSingle();

  const listed = missingColumn(phase.error?.code)
    ? await db
        .from("orders_readable")
        .select(ORDER_COLUMNS)
        .eq("id", id.toLowerCase())
        .maybeSingle()
    : phase;

  if (listed.error) {
    console.error("admin order", listed.error.message);
    return { ok: false, reason: "error" };
  }
  if (!isRecord(listed.data)) return { ok: false, reason: "not_found" };

  const ids = new Set<string>();
  for (const key of ["merchant_id", "driver_id", "pickup_driver_id"] as const) {
    const profileId = uuid(listed.data[key]);
    if (profileId) ids.add(profileId);
  }
  const names = await profileNames(db, ids);
  if (!names) return { ok: false, reason: "error" };

  const mapped = toAdminOrder(listed.data, names);
  return mapped ? { ok: true, data: mapped } : { ok: false, reason: "error" };
}

const EXCEPTION_COLUMNS =
  "id, tracking_code, driver_id, status, ledger_posted_at, exception_reason, failed_attempts, last_attempt_at, is_gps_verified, attempt_distance_meters, whatsapp_proof_url, call_log_proof_url, door_photo_proof_url, suspicious_attempt_flag";

function nullableInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

/**
 * Orders an admin still has to judge: a reason is set, or a driver has
 * already failed at least once, and nobody has accepted or rejected it.
 */
export async function loadExceptionOrders(): Promise<LoadResult<ExceptionOrder[]>> {
  const db = await adminDb();
  if (!db) return { ok: false };

  const open = await db
    .from("orders_readable")
    .select(`${EXCEPTION_COLUMNS}, exception_reviewed_at`)
    .or("exception_reason.not.is.null,failed_attempts.gt.0")
    .is("exception_reviewed_at", null)
    .order("last_attempt_at", { ascending: false, nullsFirst: false })
    .limit(ORDER_LIMIT);

  const listed = missingColumn(open.error?.code)
    ? await db
        .from("orders_readable")
        .select(EXCEPTION_COLUMNS)
        .or("exception_reason.not.is.null,failed_attempts.gt.0")
        .order("last_attempt_at", { ascending: false, nullsFirst: false })
        .limit(ORDER_LIMIT)
    : open;

  if (listed.error || !Array.isArray(listed.data)) {
    console.error("admin exceptions", listed.error?.message);
    return { ok: false };
  }

  const ids = new Set<string>();
  for (const row of listed.data) {
    if (!isRecord(row)) continue;
    const driverId = uuid(row.driver_id);
    if (driverId) ids.add(driverId);
  }
  const names = await profileNames(db, ids);
  if (!names) return { ok: false };

  const rows: ExceptionOrder[] = [];
  for (const row of listed.data) {
    if (!isRecord(row)) continue;
    const id = uuid(row.id);
    const attempts = nullableInt(row.failed_attempts) ?? 0;
    const reason = isExceptionReason(row.exception_reason) ? row.exception_reason : null;
    if (
      !id ||
      !text(row.tracking_code) ||
      !isOrderStatus(row.status) ||
      (reason === null && attempts <= 0)
    ) {
      continue;
    }
    if ("exception_reviewed_at" in row && row.exception_reviewed_at != null) continue;

    const driverId = uuid(row.driver_id);
    const distance = nullableInt(row.attempt_distance_meters);
    rows.push({
      id,
      trackingCode: text(row.tracking_code),
      status: row.status,
      driverId,
      driverName: driverId ? (names.get(driverId) ?? "مندوب") : null,
      reason,
      failedAttempts: Math.max(0, attempts),
      attemptAt: typeof row.last_attempt_at === "string" ? row.last_attempt_at : null,
      attemptLabel: timeLabel(row.last_attempt_at),
      gpsVerified: row.is_gps_verified === true,
      distanceMeters: distance !== null && distance >= 0 ? distance : null,
      suspicious: row.suspicious_attempt_flag === true,
      whatsappProofUrl: safeImageSrc(row.whatsapp_proof_url),
      callLogProofUrl: safeImageSrc(row.call_log_proof_url),
      doorPhotoProofUrl: safeImageSrc(row.door_photo_proof_url),
      locked: row.status === "delivered" || row.status === "cancelled" || row.ledger_posted_at != null,
    });
  }

  return { ok: true, data: rows };
}
