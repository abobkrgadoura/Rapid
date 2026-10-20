import { getAuthSession } from "@/lib/auth/session";
import { coordsFromMapsUrl, zoneFromText } from "@/lib/driver/geo";
import { isDriverLocale } from "@/lib/driver/messages";
import { isNavApp } from "@/lib/driver/navigation";
import type { PickupPendingParcel, PickupShipment } from "@/lib/driver/pickup-shipments";
import {
  DEFAULT_DRIVER_PREFERENCES,
  type DriverPreferences,
} from "@/lib/driver/preferences";
import type { DriverSurface } from "@/lib/driver/surface";
import { canonicalMoney } from "@/lib/format-money";
import { isVehicleType, TIME_ZONE, type VehicleType } from "@/lib/locale/sudan";
import type { GeoPoint } from "@/lib/math";
import { formatCents, parseNonNegativeMoneyCents } from "@/lib/money";
import { safeMapsHref } from "@/lib/orders/gps-url";
import { decodeRecipientDropoff } from "@/lib/orders/recipient";
import {
  isOrderStatus,
  isPaymentType,
  type OrderStatus,
  type PaymentType,
} from "@/lib/orders/status";
import { createClient } from "@/utils/supabase/server";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UNDEFINED_COLUMN = "42703";

export type DriverWallet = {
  /** Signed. Positive: the platform owes the driver. Negative: the driver owes the platform. */
  balance: string;
  currency: string;
};

/**
 * One merchant with parcels waiting for pickup. This is everything a pickup
 * driver is allowed to know. There is deliberately no customer field.
 */
export type PickupMerchant = {
  merchantId: string;
  companyName: string;
  phone: string | null;
  address: string;
  gpsUrl: string | null;
  point: GeoPoint | null;
  zone: string;
  pendingCount: number;
  /** Canonical SDG string, or null when the fee column is not on the RPC yet. */
  pickupFee: string | null;
  /** Oldest pending parcel, when `pickup_merchant_groups` returns it. */
  requestedAt: string | null;
  /** The real pending parcels for this merchant. Empty until migration 0018 is applied. */
  parcels: PickupPendingParcel[];
};

/** A parcel this driver loaded from the hub. Customer details are theirs to see. */
export type DriverStop = {
  id: string;
  trackingCode: string;
  status: OrderStatus;
  paymentType: PaymentType;
  productPrice: string;
  deliveryFee: string;
  customerName: string;
  phone: string;
  merchantName: string;
  dropoffAddress: string;
  zone: string;
  landmark: string;
  piecesCount: number;
  dropoffGpsUrl: string | null;
  point: GeoPoint | null;
  walletPending: boolean;
};

export type DriverShift = {
  /** Physical COD in the driver's pocket, in SDG. */
  cashInHand: string;
  /** Delivered today in Khartoum × commission_per_delivery. */
  earningsToday: string;
  deliveredToday: number;
  commissionPerDelivery: string;
};

export type DriverAlert = {
  id: string;
  trackingCode: string;
  kind: "retry_delivery" | "return_to_hub";
  message: string;
};

export type DriverDashboard = {
  wallet: DriverWallet;
  shift: DriverShift;
  preferences: DriverPreferences;
  pickups: PickupMerchant[];
  deliveries: DriverStop[];
  alerts: DriverAlert[];
  /** Pickup driver's own shipments. Always empty on the delivery surface. */
  pickupShipments: PickupShipment[];
  /** True when the shipments list could not be loaded (for example 0017 not applied). */
  pickupShipmentsFailed: boolean;
};

export type LoadResult<T> = { ok: true; data: T } | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function missingColumn(code: string | undefined): boolean {
  return code === UNDEFINED_COLUMN || code === "PGRST204";
}

function whole(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return fallback;
}

function moneyFromWhole(value: unknown): string {
  const amount = whole(value, 0);
  return `${amount}.00`;
}

/** Midnight at the start of today in Khartoum, as an ISO timestamp. */
export function khartoumDayStart(now = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `${day}T00:00:00+02:00`;
}

function readPreferences(row: Record<string, unknown> | null): DriverPreferences {
  if (!row) return DEFAULT_DRIVER_PREFERENCES;
  const vehicle = isVehicleType(row.active_vehicle)
    ? row.active_vehicle
    : isVehicleType(row.vehicle_type)
      ? row.vehicle_type
      : null;
  return {
    locale: isDriverLocale(row.driver_locale) ? row.driver_locale : "ar",
    navApp: isNavApp(row.preferred_nav_app) ? row.preferred_nav_app : "google_maps",
    darkMode: row.driver_dark_mode === true,
    highAlert: row.high_alert_sound !== false,
    activeVehicle: vehicle,
  };
}

function parsePickupMerchant(row: unknown): PickupMerchant | null {
  if (!isRecord(row)) return null;
  if (typeof row.merchant_id !== "string" || !UUID.test(row.merchant_id)) return null;
  if (typeof row.company_name !== "string" || !row.company_name.trim()) return null;
  if (typeof row.pickup_address !== "string") return null;

  const count =
    typeof row.pending_count === "number"
      ? row.pending_count
      : typeof row.pending_count === "string"
        ? Number(row.pending_count)
        : NaN;
  if (!Number.isInteger(count) || count < 1) return null;

  const phone =
    typeof row.phone === "string" && row.phone.trim() ? row.phone.trim() : null;
  const gpsUrl = safeMapsHref(row.pickup_gps_url);
  const address = row.pickup_address.trim();
  const fee =
    row.pickup_fee === undefined || row.pickup_fee === null
      ? null
      : canonicalMoney(row.pickup_fee);

  return {
    merchantId: row.merchant_id.toLowerCase(),
    companyName: row.company_name.trim(),
    phone,
    address,
    gpsUrl,
    point: coordsFromMapsUrl(gpsUrl),
    zone: zoneFromText(address),
    pendingCount: count,
    pickupFee: fee,
    requestedAt: timestampOrNull(row.earliest_created_at),
    parcels: [],
  };
}

function timestampOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseStop(
  row: unknown,
  merchants: ReadonlyMap<string, string>,
): DriverStop | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string" || !UUID.test(row.id)) return null;
  if (typeof row.tracking_code !== "string" || !row.tracking_code.trim()) return null;
  if (typeof row.dropoff_address !== "string") return null;
  if (!isPaymentType(row.payment_type) || !isOrderStatus(row.status)) return null;

  const productPrice = canonicalMoney(row.product_price);
  const deliveryFee = canonicalMoney(row.delivery_fee);
  if (!productPrice || !deliveryFee) return null;

  const recipient = decodeRecipientDropoff(row.dropoff_address);
  const gpsUrl = safeMapsHref(row.dropoff_gps_url);
  const merchantId = typeof row.merchant_id === "string" ? row.merchant_id.toLowerCase() : "";
  const landmark = typeof row.landmark === "string" ? row.landmark.trim() : "";
  const pieces = whole(row.pieces_count, 1);

  return {
    id: row.id.toLowerCase(),
    trackingCode: row.tracking_code,
    status: row.status,
    paymentType: row.payment_type,
    productPrice,
    deliveryFee,
    customerName: recipient.customerName,
    phone: recipient.phone,
    merchantName: merchants.get(merchantId) || "المتجر",
    dropoffAddress: recipient.dropoffAddress,
    zone: zoneFromText(recipient.dropoffAddress || row.dropoff_address),
    landmark,
    piecesCount: pieces >= 1 && pieces <= 99 ? pieces : 1,
    dropoffGpsUrl: gpsUrl,
    point: coordsFromMapsUrl(gpsUrl),
    walletPending: row.status === "delivered" && row.ledger_posted_at == null,
  };
}

function weightOrNull(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Reads one `pickup_driver_shipments()` row. Only the fields listed here are
 * ever copied, so even a future RPC change cannot leak a recipient field.
 */
function parsePickupShipment(row: unknown): PickupShipment | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string" || !UUID.test(row.id)) return null;
  if (typeof row.tracking_code !== "string" || !row.tracking_code.trim()) return null;
  if (!isOrderStatus(row.status)) return null;
  if (typeof row.merchant_id !== "string" || !UUID.test(row.merchant_id)) return null;
  const createdAt = timestampOrNull(row.created_at);
  if (createdAt === null) return null;

  const pieces = whole(row.pieces_count, 1);
  const merchantName =
    typeof row.company_name === "string" && row.company_name.trim()
      ? row.company_name.trim()
      : "المتجر";

  return {
    id: row.id.toLowerCase(),
    trackingCode: row.tracking_code.trim(),
    status: row.status,
    weightKg: weightOrNull(row.weight_kg),
    piecesCount: pieces >= 1 && pieces <= 99 ? pieces : 1,
    createdAt,
    updatedAt: timestampOrNull(row.updated_at) ?? createdAt,
    merchantId: row.merchant_id.toLowerCase(),
    merchantName,
    pickupAddress: typeof row.pickup_address === "string" ? row.pickup_address.trim() : "",
  };
}

/** Reads one `pickup_pending_parcels()` row into its merchant id and parcel. */
function parsePendingParcel(row: unknown): { merchantId: string; parcel: PickupPendingParcel } | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string" || !UUID.test(row.id)) return null;
  if (typeof row.tracking_code !== "string" || !row.tracking_code.trim()) return null;
  if (typeof row.merchant_id !== "string" || !UUID.test(row.merchant_id)) return null;
  const createdAt = timestampOrNull(row.created_at);
  if (createdAt === null) return null;
  const pieces = whole(row.pieces_count, 1);
  return {
    merchantId: row.merchant_id.toLowerCase(),
    parcel: {
      id: row.id.toLowerCase(),
      trackingCode: row.tracking_code.trim().toUpperCase(),
      weightKg: weightOrNull(row.weight_kg),
      piecesCount: pieces >= 1 && pieces <= 99 ? pieces : 1,
      createdAt,
    },
  };
}

/**
 * Shipments assigned to this pickup driver (`orders.pickup_driver_id`), newest
 * first, with the merchant's company name and pickup address.
 *
 * Goes through the `pickup_driver_shipments()` RPC (migration 0017). A pickup
 * driver has no `orders` RLS policy, so selecting from the table with their JWT
 * returns nothing, and a policy would expose recipient columns. The RPC filters
 * on `pickup_driver_id = auth.uid()` itself and returns logistics fields only:
 * id, tracking code, status, weight, pieces, created_at, merchant name and
 * pickup address. Recipient name, phone, dropoff address and dropoff GPS are
 * never selected.
 *
 * `pickupDriverId` must be the signed-in driver. Anything else is refused.
 */
export async function getPickupDriverShipments(
  pickupDriverId: string,
): Promise<LoadResult<PickupShipment[]>> {
  const session = await getAuthSession();
  if (
    session.status !== "ready" ||
    session.profile.role !== "driver" ||
    session.profile.id !== pickupDriverId ||
    (session.profile.staffType !== null && session.profile.staffType !== "pickup_driver")
  ) {
    return { ok: false };
  }

  const supabase = await createClient();
  const result = await supabase.rpc("pickup_driver_shipments");
  if (result.error || !Array.isArray(result.data)) {
    console.error("pickup driver shipments", result.error?.message);
    return { ok: false };
  }

  const shipments: PickupShipment[] = [];
  for (const row of result.data) {
    const shipment = parsePickupShipment(row);
    if (!shipment) return { ok: false };
    shipments.push(shipment);
  }
  return { ok: true, data: shipments };
}

const PROFILE_FULL =
  "current_cash_in_hand, commission_per_delivery, preferred_nav_app, driver_dark_mode, high_alert_sound, active_vehicle, driver_locale, vehicle_type";
const PROFILE_PHASE13 =
  "current_cash_in_hand, commission_per_delivery, preferred_nav_app, driver_dark_mode, high_alert_sound, vehicle_type";
const PROFILE_CASH = "current_cash_in_hand, vehicle_type";

const STOP_FULL =
  "id, tracking_code, status, payment_type, product_price, delivery_fee, dropoff_address, dropoff_gps_url, ledger_posted_at, created_at, merchant_id, pieces_count, landmark";
const STOP_BASE =
  "id, tracking_code, status, payment_type, product_price, delivery_fee, dropoff_address, dropoff_gps_url, ledger_posted_at, created_at, merchant_id";

async function readProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  driverId: string,
): Promise<Record<string, unknown> | null> {
  const attempts = [PROFILE_FULL, PROFILE_PHASE13, PROFILE_CASH];
  for (const columns of attempts) {
    const result = await supabase.from("profiles").select(columns).eq("id", driverId).maybeSingle();
    if (!result.error && isRecord(result.data)) return result.data;
    if (!missingColumn(result.error?.code)) return null;
  }
  return null;
}

/** Stands in for a query the driver's surface never runs. */
const NO_ROWS = Promise.resolve({
  data: [] as unknown[],
  error: null,
  count: null,
  status: 200,
  statusText: "OK",
});

/**
 * Wallet, merchants waiting for pickup, and the driver's own deliveries.
 * Everything is read with the driver's own JWT.
 *
 * `surface` limits what is fetched, so a pickup driver's payload never holds
 * delivery rows (customer details) and a delivery driver's never holds pickup
 * groups or pickup shipments. `legacy` (no staff_type) loads both, as before.
 */
export async function loadDriverDashboard(
  surface: DriverSurface = "legacy",
): Promise<LoadResult<DriverDashboard>> {
  const session = await getAuthSession();
  if (
    session.status !== "ready" ||
    session.profile.role !== "driver" ||
    surface === "unsupported"
  ) {
    return { ok: false };
  }

  const wantPickups = surface === "pickup" || surface === "legacy";
  const wantDeliveries = surface === "delivery" || surface === "legacy";

  const supabase = await createClient();
  const [
    wallet,
    groups,
    orders,
    profile,
    merchants,
    delivered,
    alertsResult,
    shipmentsResult,
    parcelsResult,
  ] = await Promise.all([
    supabase
      .from("wallets")
      .select("balance, currency")
      .eq("driver_id", session.profile.id)
      .maybeSingle(),
    wantPickups ? supabase.rpc("pickup_merchant_groups") : NO_ROWS,
    wantDeliveries
      ? supabase
          .from("orders_readable")
          .select(STOP_FULL)
          .eq("driver_id", session.profile.id)
          .or("status.eq.in_transit,and(status.eq.delivered,ledger_posted_at.is.null)")
          .order("created_at", { ascending: true })
          .limit(200)
      : NO_ROWS,
    readProfile(supabase, session.profile.id),
    supabase.rpc("driver_assigned_merchants"),
    supabase
      .from("orders_readable")
      .select("id", { count: "exact", head: true })
      .eq("driver_id", session.profile.id)
      .eq("status", "delivered")
      .gte("delivered_at", khartoumDayStart()),
    supabase
      .from("driver_alerts")
      .select("id, tracking_code, kind, message")
      .eq("driver_id", session.profile.id)
      .is("seen_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
    wantPickups
      ? getPickupDriverShipments(session.profile.id)
      : Promise.resolve<LoadResult<PickupShipment[]>>({ ok: true, data: [] }),
    wantPickups ? supabase.rpc("pickup_pending_parcels") : NO_ROWS,
  ]);

  const listed = wantDeliveries && missingColumn(orders.error?.code)
    ? await supabase
        .from("orders_readable")
        .select(STOP_BASE)
        .eq("driver_id", session.profile.id)
        .or("status.eq.in_transit,and(status.eq.delivered,ledger_posted_at.is.null)")
        .order("created_at", { ascending: true })
        .limit(200)
    : orders;

  if (wallet.error || groups.error || listed.error) {
    console.error(
      "driver dashboard",
      wallet.error?.message,
      groups.error?.message,
      listed.error?.message,
    );
    return { ok: false };
  }
  if (!isRecord(wallet.data) || !Array.isArray(groups.data) || !Array.isArray(listed.data)) {
    return { ok: false };
  }

  const balance = canonicalMoney(wallet.data.balance);
  const currency =
    typeof wallet.data.currency === "string" && /^[A-Z]{3}$/.test(wallet.data.currency)
      ? wallet.data.currency
      : null;
  if (balance === null || currency === null) return { ok: false };

  const names = new Map<string, string>();
  if (!merchants.error && Array.isArray(merchants.data)) {
    for (const row of merchants.data) {
      if (!isRecord(row)) continue;
      if (typeof row.merchant_id !== "string" || !UUID.test(row.merchant_id)) continue;
      if (typeof row.company_name !== "string" || !row.company_name.trim()) continue;
      names.set(row.merchant_id.toLowerCase(), row.company_name.trim());
    }
  }

  // Real parcels per merchant. A missing RPC (0018 not applied) or a bad row
  // only leaves the scanner without a parcel list; it never blocks the dashboard.
  const parcelsByMerchant = new Map<string, PickupPendingParcel[]>();
  if (!parcelsResult.error && Array.isArray(parcelsResult.data)) {
    for (const row of parcelsResult.data) {
      const parsed = parsePendingParcel(row);
      if (!parsed) continue;
      const list = parcelsByMerchant.get(parsed.merchantId) ?? [];
      list.push(parsed.parcel);
      parcelsByMerchant.set(parsed.merchantId, list);
    }
  } else if (parcelsResult.error) {
    console.error("pickup pending parcels", parcelsResult.error.message);
  }

  const pickups: PickupMerchant[] = [];
  for (const row of groups.data) {
    const merchant = parsePickupMerchant(row);
    if (!merchant) return { ok: false };
    merchant.parcels = parcelsByMerchant.get(merchant.merchantId) ?? [];
    pickups.push(merchant);
  }

  const deliveries: DriverStop[] = [];
  for (const row of listed.data) {
    const stop = parseStop(row, names);
    if (!stop) return { ok: false };
    deliveries.push(stop);
  }

  const preferences = readPreferences(profile);
  const commission = canonicalMoney(profile?.commission_per_delivery) ?? "1000.00";
  const deliveredToday = delivered.error ? 0 : (delivered.count ?? 0);
  const rate = parseNonNegativeMoneyCents(commission) ?? BigInt(100000);
  let earningsToday = "0.00";
  try {
    earningsToday = formatCents(rate * BigInt(Math.max(0, deliveredToday)));
  } catch {
    earningsToday = "0.00";
  }

  return {
    ok: true,
    data: {
      wallet: { balance, currency },
      shift: {
        cashInHand: moneyFromWhole(profile?.current_cash_in_hand),
        earningsToday,
        deliveredToday: Math.max(0, deliveredToday),
        commissionPerDelivery: commission,
      },
      preferences,
      pickups,
      deliveries,
      alerts: readAlerts(alertsResult),
      pickupShipments: shipmentsResult.ok ? shipmentsResult.data : [],
      pickupShipmentsFailed: !shipmentsResult.ok,
    },
  };
}

function readAlerts(result: { data: unknown; error: { code?: string; message?: string } | null }): DriverAlert[] {
  if (result.error || !Array.isArray(result.data)) return [];
  const alerts: DriverAlert[] = [];
  for (const row of result.data) {
    if (!isRecord(row)) continue;
    if (typeof row.id !== "string" || !UUID.test(row.id)) continue;
    if (typeof row.tracking_code !== "string" || !row.tracking_code.trim()) continue;
    if (row.kind !== "retry_delivery" && row.kind !== "return_to_hub") continue;
    alerts.push({
      id: row.id.toLowerCase(),
      trackingCode: row.tracking_code.trim(),
      kind: row.kind,
      message: typeof row.message === "string" ? row.message : "",
    });
  }
  return alerts;
}

export async function loadDriverPreferences(): Promise<DriverPreferences> {
  const session = await getAuthSession();
  if (session.status !== "ready" || session.profile.role !== "driver") {
    return DEFAULT_DRIVER_PREFERENCES;
  }
  const supabase = await createClient();
  const profile = await readProfile(supabase, session.profile.id);
  return readPreferences(profile);
}

export type { VehicleType };
