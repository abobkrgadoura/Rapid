export const ORDER_STATUSES = [
  "pending",
  "assigned",
  "picked_up",
  "at_hub",
  "in_transit",
  "delivered",
  "returned",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_TYPES = ["cod", "prepaid"] as const;

export type PaymentType = (typeof PAYMENT_TYPES)[number];

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pending",
  assigned: "Assigned",
  picked_up: "Picked up",
  at_hub: "At hub",
  in_transit: "In transit",
  delivered: "Delivered",
  returned: "Returned",
  cancelled: "Cancelled",
};

const STATUS_CLASS: Record<OrderStatus, string> = {
  pending:
    "border-transparent bg-amber-100 text-amber-950 dark:bg-amber-400/15 dark:text-amber-200",
  assigned:
    "border-transparent bg-violet-100 text-violet-950 dark:bg-violet-400/15 dark:text-violet-200",
  picked_up:
    "border-transparent bg-blue-100 text-blue-950 dark:bg-blue-400/15 dark:text-blue-200",
  at_hub:
    "border-transparent bg-indigo-100 text-indigo-950 dark:bg-indigo-400/15 dark:text-indigo-200",
  in_transit:
    "border-transparent bg-sky-100 text-sky-950 dark:bg-sky-400/15 dark:text-sky-200",
  delivered:
    "border-transparent bg-emerald-100 text-emerald-950 dark:bg-emerald-400/15 dark:text-emerald-200",
  returned:
    "border-transparent bg-orange-100 text-orange-950 dark:bg-orange-400/15 dark:text-orange-200",
  cancelled:
    "border-transparent bg-rose-100 text-rose-950 dark:bg-rose-400/15 dark:text-rose-200",
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    (ORDER_STATUSES as readonly string[]).includes(value)
  );
}

export function isPaymentType(value: unknown): value is PaymentType {
  return (
    typeof value === "string" &&
    (PAYMENT_TYPES as readonly string[]).includes(value)
  );
}

export function orderStatusLabel(status: OrderStatus): string {
  return STATUS_LABEL[status];
}

export function orderStatusClass(status: OrderStatus): string {
  return STATUS_CLASS[status];
}

export function paymentTypeLabel(paymentType: PaymentType): string {
  return paymentType === "cod" ? "COD" : "Prepaid";
}
