/**
 * Shapes and messages shared between the hub server actions and the scanner
 * UIs. Kept out of the "use server" file, which may only export async
 * functions.
 */

export type HubErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_code"
  | "empty_batch"
  | "not_found"
  | "wrong_merchant"
  | "not_pending"
  | "not_picked_up"
  | "not_at_hub"
  | "taken"
  | "same_driver"
  | "failed";

export type HubResult<T> = ({ ok: true } & T) | { ok: false; error: HubErrorCode };

export const HUB_ERROR_MESSAGES: Record<HubErrorCode, string> = {
  unauthorized: "Your session expired. Sign in again.",
  forbidden: "Your account can't do this.",
  invalid_code: "That doesn't look like a tracking code. Check it and try again.",
  empty_batch: "Scan at least one parcel first.",
  not_found: "No parcel with that code.",
  wrong_merchant: "That parcel belongs to a different merchant.",
  not_pending: "That parcel was already collected or is no longer waiting for pickup.",
  not_picked_up: "A pickup driver hasn't collected that parcel yet.",
  not_at_hub: "That parcel hasn't been received at the hub yet.",
  taken: "Another driver already loaded that parcel.",
  same_driver:
    "You collected this parcel from the merchant, so another driver must deliver it.",
  failed: "Something went wrong. Try again.",
};

export type PickupScan = { trackingCode: string };

export type BatchPickupDone = { count: number; trackingCodes: string[] };

export type HubReceipt = {
  trackingCode: string;
  /** True when the parcel was already at the hub; nothing changed. */
  alreadyReceived: boolean;
};

export type HubLoad = {
  trackingCode: string;
  /** True when this driver had already loaded the parcel; nothing changed. */
  alreadyLoaded: boolean;
};
