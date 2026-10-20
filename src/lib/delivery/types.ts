import type { OrderStatus, PaymentType } from "@/lib/orders/status";

/**
 * Shapes shared between the delivery server actions and the scanner modal.
 * Kept out of the "use server" files, which may only export async functions.
 */

export type DeliveryErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_code"
  | "not_found"
  | "not_picked_up"
  | "not_deliverable"
  | "already_completed"
  | "otp_required"
  | "otp_invalid"
  | "otp_locked"
  | "otp_unavailable"
  | "invalid_location"
  | "partial_invalid"
  | "ledger_failed"
  | "failed";

export type DeliveryOrder = {
  orderId: string;
  trackingCode: string;
  paymentType: PaymentType;
  status: OrderStatus;
  customerName: string;
  phone: string;
  dropoffAddress: string;
  /** Canonical decimal string, e.g. "120.00". */
  productPrice: string;
  /** Signed wallet movement Postgres will post: COD negative, prepaid positive. */
  walletAmount: string;
  /** Prepaid and not yet handed over: the customer's 4-digit code is required. */
  requiresOtp: boolean;
  /** Already delivered but the wallet entry has not posted. Retry the posting. */
  resume: boolean;
  /** Piece count on the parcel. Partial handoff is offered when this is above 1. */
  piecesCount: number;
  merchantName: string;
};

export type LookupDeliveryResult =
  | { ok: true; order: DeliveryOrder }
  | { ok: false; error: DeliveryErrorCode };

export type ConfirmDeliveryResult =
  | {
      ok: true;
      trackingCode: string;
      paymentType: PaymentType;
      /** False when the net movement was zero and no transaction row was needed. */
      posted: boolean;
      amount: string;
      balanceAfter: string;
    }
  | {
      ok: false;
      error: DeliveryErrorCode;
      /** Present for otp_invalid so the form can show what is left. */
      attemptsRemaining?: number;
      /** True when the order is delivered and only the wallet posting failed. */
      delivered?: boolean;
    };

export const DELIVERY_ERROR_MESSAGES: Record<DeliveryErrorCode, string> = {
  unauthorized: "Your session expired. Sign in again.",
  forbidden: "You can't act on this order.",
  invalid_code: "That doesn't look like a tracking code. Check it and try again.",
  not_found: "No order with that code is out for delivery with you.",
  not_picked_up: "Load this parcel from the hub first, then scan it again at the door.",
  not_deliverable: "This order can't be delivered in its current state.",
  already_completed: "This delivery is already complete.",
  otp_required: "Enter the 4-digit code the customer received.",
  otp_invalid: "That code is wrong.",
  otp_locked:
    "Too many wrong codes. Ask the merchant to issue a new code, then try again.",
  otp_unavailable:
    "No delivery code has been issued for this order. Ask the merchant to issue one.",
  invalid_location: "We couldn't read a valid location. Try again.",
  partial_invalid: "Check the pieces kept, the pieces coming back, and the cash collected.",
  ledger_failed:
    "The order is marked delivered but your wallet entry didn't post. Scan the code again to retry.",
  failed: "Something went wrong. Try again.",
};
