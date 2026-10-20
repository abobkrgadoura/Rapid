import type { OrderStatus } from "@/lib/orders/status";

/**
 * Customer journey on the public tracking page. The hub step has no timestamp
 * of its own; it is current only while the order status is at_hub.
 */
export const PUBLIC_STEP_KEYS = [
  "created",
  "picked_up",
  "at_hub",
  "out_for_delivery",
  "delivered",
] as const;

export type PublicStepKey = (typeof PUBLIC_STEP_KEYS)[number];
export type PublicStepState = "done" | "current" | "upcoming";

export type PublicTimelineInput = {
  status: OrderStatus;
  createdAt: string | null;
  pickedUpAt: string | null;
  inTransitAt: string | null;
  deliveredAt: string | null;
};

export type PublicTimelineStep = {
  key: PublicStepKey;
  label: string;
  state: PublicStepState;
  at: string | null;
};

const LABEL: Record<PublicStepKey, string> = {
  created: "تم إنشاء الطلب",
  picked_up: "تم الاستلام من التاجر",
  at_hub: "في مخزن الفرز",
  out_for_delivery: "خرجت للتوصيل مع المندوب",
  delivered: "تم التسليم بنجاح",
};

function reachedIndex(input: PublicTimelineInput): number {
  switch (input.status) {
    case "delivered":
      return 4;
    case "in_transit":
      return 3;
    case "at_hub":
      return 2;
    case "picked_up":
      return 1;
    case "cancelled":
    case "returned":
      if (input.deliveredAt) return 4;
      if (input.inTransitAt) return 3;
      if (input.pickedUpAt) return 1;
      return 0;
    default:
      return 0;
  }
}

export function buildPublicTimeline(input: PublicTimelineInput): PublicTimelineStep[] {
  const reached = reachedIndex(input);
  const finished =
    input.status === "delivered" ||
    input.status === "cancelled" ||
    input.status === "returned";
  const times: Record<PublicStepKey, string | null> = {
    created: input.createdAt,
    picked_up: input.pickedUpAt,
    at_hub: null,
    out_for_delivery: input.inTransitAt,
    delivered: input.deliveredAt,
  };

  return PUBLIC_STEP_KEYS.map((key, index) => {
    let state: PublicStepState;
    if (index < reached) state = "done";
    else if (index === reached) state = finished ? "done" : "current";
    else state = "upcoming";

    return {
      key,
      label: LABEL[key],
      state,
      at: state === "upcoming" ? null : times[key],
    };
  });
}
