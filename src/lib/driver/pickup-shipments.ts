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

/** Still waiting to be collected from the merchant. */
function isOpen(status: OrderStatus): boolean {
  return status === "pending" || status === "assigned";
}

/**
 * Maps a database status to the pickup driver's Arabic tab.
 *   pending, created today        -> new (جديدة)
 *   pending, created before today -> waiting (قيد الانتظار)
 *   assigned                      -> waiting
 *   picked_up, at_hub, in_transit,
 *   delivered, returned           -> picked (تم الاستلام): the driver's part is done
 *   cancelled                     -> cancelled (ملغاة)
 * `today` is a YYYY-MM-DD Khartoum day; when it is unknown a pending parcel
 * counts as waiting.
 */
export function shipmentTab(
  shipment: Pick<PickupShipment, "status" | "createdAt">,
  today: string | null,
): PickupShipmentTab {
  switch (shipment.status) {
    case "pending": {
      const day = khartoumDay(shipment.createdAt);
      return day !== null && today !== null && day === today ? "new" : "waiting";
    }
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

/** Urgent = still uncollected and requested before today (Khartoum). */
export function isUrgentShipment(
  shipment: Pick<PickupShipment, "status" | "createdAt">,
  today: string | null,
): boolean {
  if (!isOpen(shipment.status)) return false;
  const day = khartoumDay(shipment.createdAt);
  // YYYY-MM-DD strings sort chronologically.
  return day !== null && today !== null && day < today;
}

/**
 * The daily Shipments view keeps only parcels created or updated today
 * (Khartoum). Older picked-up or in-transit rows belong to history, not here.
 */
export function isShipmentToday(
  shipment: Pick<PickupShipment, "createdAt" | "updatedAt">,
  today: string | null,
): boolean {
  if (today === null) return false;
  return khartoumDay(shipment.createdAt) === today || khartoumDay(shipment.updatedAt) === today;
}

export function matchesShipmentFilter(
  shipment: PickupShipment,
  filter: TaskFilter,
  today: string | null,
): boolean {
  if (filter === "all") return true;
  if (filter === "urgent") return isUrgentShipment(shipment, today);
  return shipmentTab(shipment, today) === filter;
}
