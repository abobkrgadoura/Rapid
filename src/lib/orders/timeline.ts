import type { OrderStatus } from "@/lib/orders/status";

/**
 * The customer-facing journey. It is deliberately shorter than the database
 * enum: pending and assigned both read as "Created", and in_transit reads
 * as "Out for delivery".
 */
export const TIMELINE_KEYS = [
  "created",
  "picked_up",
  "out_for_delivery",
  "delivered",
] as const;

export type TimelineKey = (typeof TIMELINE_KEYS)[number];
export type TimelineState = "done" | "current" | "upcoming";

export type TimelineInput = {
  status: OrderStatus;
  createdAt: string | null;
  pickedUpAt: string | null;
  inTransitAt: string | null;
  deliveredAt: string | null;
};

export type TimelineStep = {
  key: TimelineKey;
  label: string;
  description: string;
  state: TimelineState;
  /** ISO timestamp when the step happened and was recorded, else null. */
  at: string | null;
};

const LABEL: Record<TimelineKey, string> = {
  created: "Order created",
  picked_up: "Picked up",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
};

const DESCRIPTION: Record<TimelineKey, Record<TimelineState, string>> = {
  created: {
    done: "The merchant created your order.",
    current: "The merchant created your order. It is waiting to be picked up.",
    upcoming: "The merchant creates your order.",
  },
  picked_up: {
    done: "Your parcel was collected from the merchant and taken to our warehouse.",
    current: "Your parcel was collected and is at, or on its way to, our warehouse.",
    upcoming: "Your parcel is collected from the merchant and taken to our warehouse.",
  },
  out_for_delivery: {
    done: "The driver set out to deliver your parcel.",
    current: "Your driver is on the way to you.",
    upcoming: "The driver sets out to deliver your parcel.",
  },
  delivered: {
    done: "Your parcel was handed over.",
    current: "Your parcel is being handed over.",
    upcoming: "Your parcel is handed over to you.",
  },
};

/** Index of the furthest step the order has reached. */
function reachedIndex(input: TimelineInput): number {
  switch (input.status) {
    case "delivered":
      return 3;
    case "in_transit":
      return 2;
    case "picked_up":
    case "at_hub":
      return 1;
    case "cancelled":
    case "returned":
      // A cancelled order shows how far it got, judged by what was recorded.
      if (input.deliveredAt) return 3;
      if (input.inTransitAt) return 2;
      if (input.pickedUpAt) return 1;
      return 0;
    default:
      return 0;
  }
}

/**
 * Builds the four timeline steps. A delivered order has every step done.
 * A cancelled order keeps the steps it reached as done and has no current
 * step, so the page can show the cancellation instead of implying progress.
 */
export function buildTimeline(input: TimelineInput): TimelineStep[] {
  const reached = reachedIndex(input);
  const finished =
    input.status === "delivered" ||
    input.status === "cancelled" ||
    input.status === "returned";
  const times: Record<TimelineKey, string | null> = {
    created: input.createdAt,
    picked_up: input.pickedUpAt,
    out_for_delivery: input.inTransitAt,
    delivered: input.deliveredAt,
  };

  return TIMELINE_KEYS.map((key, index) => {
    let state: TimelineState;
    if (index < reached) state = "done";
    else if (index === reached) state = finished ? "done" : "current";
    else state = "upcoming";

    return {
      key,
      label: LABEL[key],
      description: DESCRIPTION[key][state],
      state,
      at: state === "upcoming" ? null : times[key],
    };
  });
}
