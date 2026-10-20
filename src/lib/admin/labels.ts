import type { OrderStatus } from "@/lib/orders/status";

/**
 * Arabic copy and groupings shared by the admin Control Tower screens.
 * Pure data: safe to import from server and client components.
 */

export const STAFF_TYPES = [
  "delivery_driver",
  "pickup_driver",
  "hub_operator",
] as const;

export type StaffType = (typeof STAFF_TYPES)[number];

export function isStaffType(value: unknown): value is StaffType {
  return (
    typeof value === "string" && (STAFF_TYPES as readonly string[]).includes(value)
  );
}

export const STAFF_TYPE_LABEL: Record<StaffType, string> = {
  delivery_driver: "مندوب توصيل",
  pickup_driver: "مندوب استلام",
  hub_operator: "مسؤول مخزن",
};

/** Longer wording used on the add / edit form. */
export const STAFF_TYPE_OPTION_LABEL: Record<StaffType, string> = {
  delivery_driver: "مندوب توصيل",
  pickup_driver: "مندوب استلام",
  hub_operator: "مسؤول مخزن وفرز",
};

/** Drivers created before migration 0007 have no type and may work either leg. */
export const STAFF_TYPE_GENERIC = "مندوب (عام)";

export function staffTypeLabel(type: StaffType | null): string {
  return type === null ? STAFF_TYPE_GENERIC : STAFF_TYPE_LABEL[type];
}

export type DispatchLeg = "pickup" | "delivery";

export const DISPATCH_LEG_LABEL: Record<DispatchLeg, string> = {
  pickup: "مندوب استلام",
  delivery: "مندوب توصيل",
};

/** Can a staff member of this type work the given leg? */
export function canWorkLeg(type: StaffType | null, leg: DispatchLeg): boolean {
  if (type === "hub_operator") return false;
  if (type === null) return true;
  return leg === "pickup" ? type === "pickup_driver" : type === "delivery_driver";
}

export const ORDER_STATUS_AR: Record<OrderStatus, string> = {
  pending: "بانتظار الاستلام",
  assigned: "بانتظار الاستلام",
  picked_up: "تم الاستلام من التاجر",
  at_hub: "في مخزن الفرز",
  in_transit: "خرجت للتوصيل",
  delivered: "تم التسليم",
  returned: "مرتجعة (RTO)",
  cancelled: "ملغاة",
};

export const ORDER_STATUS_TONE: Record<OrderStatus, string> = {
  pending: "bg-amber-100 text-amber-950 border-amber-200",
  assigned: "bg-amber-100 text-amber-950 border-amber-200",
  picked_up: "bg-blue-100 text-blue-950 border-blue-200",
  at_hub: "bg-indigo-100 text-indigo-950 border-indigo-200",
  in_transit: "bg-sky-100 text-sky-950 border-sky-200",
  delivered: "bg-emerald-100 text-emerald-950 border-emerald-200",
  returned: "bg-orange-100 text-orange-950 border-orange-200",
  cancelled: "bg-rose-100 text-rose-950 border-rose-200",
};

export type OrderTabId =
  | "all"
  | "new"
  | "received"
  | "transit"
  | "delivered"
  | "returns";

export const ORDER_TABS: ReadonlyArray<{
  id: OrderTabId;
  label: string;
  match: (status: OrderStatus) => boolean;
}> = [
  { id: "all", label: "الكل", match: () => true },
  {
    id: "new",
    label: "جديد / بانتظار الاستلام",
    match: (status) => status === "pending" || status === "assigned",
  },
  {
    id: "received",
    label: "تم الاستلام",
    match: (status) => status === "picked_up" || status === "at_hub",
  },
  { id: "transit", label: "في الطريق", match: (status) => status === "in_transit" },
  { id: "delivered", label: "تم التسليم", match: (status) => status === "delivered" },
  {
    id: "returns",
    label: "مرتجعات",
    match: (status) => status === "returned" || status === "cancelled",
  },
];

/**
 * Short code for a destination zone, so a sorter can shelve by it without
 * reading Arabic: one letter and two digits, stable for the same zone name.
 */
export function sortingCode(zone: string): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let hash = 0;
  for (const char of Array.from(zone.trim())) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  const letter = letters[hash % letters.length];
  const digits = String(Math.floor(hash / letters.length) % 100).padStart(2, "0");
  return `${letter}-${digits}`;
}
