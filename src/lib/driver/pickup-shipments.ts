import { TIME_ZONE } from "@/lib/locale/sudan";
import type { OrderStatus } from "@/lib/orders/status";

/**
 * Pure types and rules for the pickup driver's shipments list. Safe to import
 * from client components: no server code lives here.
 *
 * PRIVACY: a pickup driver collects from the merchant and never meets the
 * customer. This type has no recipient name, phone, dropoff address or dropoff
 * GPS field, so the UI cannot render one by mistake.
 */
export type PickupShipment = {
  id: string;
  trackingCode: string;
  status: OrderStatus;
  /** Null until a weight is recorded for the parcel. */
  weightKg: number | null;
  piecesCount: number;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp of the last change. Falls back to `createdAt` before migration 0018. */
  updatedAt: string;
  merchantId: string;
  merchantName: string;
  pickupAddress: string;
};

/**
 * One parcel still waiting at a merchant, from `pickup_pending_parcels()`.
 * Logistics only: no recipient name, phone or dropoff location.
 */
export type PickupPendingParcel = {
  id: string;
  trackingCode: string;
  weightKg: number | null;
  piecesCount: number;
  /** ISO timestamp. */
  createdAt: string;
};

/** The four states a pickup driver sees on a shipment card. */
export type PickupShipmentTab = "new" | "waiting" | "picked" | "cancelled";

/** Filter ids on the tasks screen, shared with the merchants list. */
export type TaskFilter = "all" | "urgent" | PickupShipmentTab;

export const SHIPMENT_TAB_LABEL: Record<PickupShipmentTab, string> = {
  new: "جديدة",
  waiting: "قيد الانتظار",
  picked: "تم الاستلام",
  cancelled: "ملغاة",
};

export const SHIPMENT_TAB_STYLE: Record<PickupShipmentTab, string> = {
  new: "bg-[#E8F1FF] text-[#0F62FF]",
  waiting: "bg-[#FFF1E6] text-orange-500",
  picked: "bg-[#E7F8EF] text-emerald-600",
  cancelled: "bg-[#FDECEC] text-red-500",
};

/** Calendar day (YYYY-MM-DD) of a timestamp in Khartoum, or null when it is not a date. */
export function khartoumDay(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Not collected from the merchant yet: `pending`, or `assigned` (a driver is
 * assigned but has not picked up; the hub also treats both as "not picked up").
 */
function isWaitingAtMerchant(status: OrderStatus): boolean {
  return status === "pending" || status === "assigned";
}

/** `pending` and requested (`createdAt`) today in Khartoum. */
function isRequestedToday(
  shipment: Pick<PickupShipment, "status" | "createdAt">,
  today: string | null,
): boolean {
  return (
    shipment.status === "pending" && today !== null && khartoumDay(shipment.createdAt) === today
  );
}

/** Narrows a dropdown value to a real badge id. "all" and "urgent" are not badges. */
export function isShipmentTab(value: string): value is PickupShipmentTab {
  return value === "new" || value === "waiting" || value === "picked" || value === "cancelled";
}

/**
 * Maps a database status to the pickup driver's Arabic badge.
 *   pending, requested today          -> new (جديدة)
 *   pending, requested before today   -> waiting (قيد الانتظار)
 *   assigned                          -> waiting: not collected yet
 *   picked_up, at_hub, in_transit,
 *   delivered, returned               -> picked (تم الاستلام): the driver's part is done
 *   cancelled                         -> cancelled (ملغاة)
 * Both "new" and "waiting" badges are uncollected parcels, and the "waiting"
 * filter matches both (see `matchesShipmentFilter`).
 */
export function shipmentTab(
  shipment: Pick<PickupShipment, "status" | "createdAt">,
  today: string | null,
): PickupShipmentTab {
  switch (shipment.status) {
    case "pending":
      return isRequestedToday(shipment, today) ? "new" : "waiting";
    case "assigned":
      return "waiting";
    case "cancelled":
      return "cancelled";
    case "picked_up":
    case "at_hub":
    case "in_transit":
    case "delivered":
    case "returned":
      return "picked";
  }
}

/** Urgent = not collected yet (pending or assigned) and requested before today (Khartoum). */
export function isUrgentShipment(
  shipment: Pick<PickupShipment, "status" | "createdAt">,
  today: string | null,
): boolean {
  if (!isWaitingAtMerchant(shipment.status)) return false;
  const day = khartoumDay(shipment.createdAt);
  // YYYY-MM-DD strings sort chronologically.
  return day !== null && today !== null && day < today;
}

/**
 * Whether a shipment belongs in the active Shipments list (قائمة الشحنات).
 *   pending, assigned                    -> always, whatever its date: the
 *                                           driver still has to collect it
 *   everything else (picked_up, at_hub,
 *   in_transit, ...)                     -> only when `updatedAt` (or `createdAt`
 *                                           when that is empty) is today in
 *                                           Khartoum. Older rows are history.
 */
export function isShipmentVisible(
  shipment: Pick<PickupShipment, "status" | "createdAt" | "updatedAt">,
  today: string | null,
): boolean {
  if (isWaitingAtMerchant(shipment.status)) return true;
  if (today === null) return false;
  return khartoumDay(shipment.updatedAt || shipment.createdAt) === today;
}

/**
 * Filter chip / status dropdown rule.
 *   all       every visible shipment
 *   urgent    not collected and requested before today
 *   new       pending and requested today (جديدة)
 *   waiting   not collected yet: pending or assigned (قيد الانتظار)
 *   picked    picked_up / at_hub / in_transit and the other post-pickup statuses (تم الاستلام)
 *   cancelled cancelled
 */
export function matchesShipmentFilter(
  shipment: PickupShipment,
  filter: TaskFilter,
  today: string | null,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "urgent":
      return isUrgentShipment(shipment, today);
    case "new":
      return isRequestedToday(shipment, today);
    case "waiting":
      return isWaitingAtMerchant(shipment.status);
    case "picked":
    case "cancelled":
      return shipmentTab(shipment, today) === filter;
  }
}
