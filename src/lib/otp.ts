import { randomInt } from "node:crypto";

import { DELIVERY_OTP_LENGTH } from "@/lib/otp-format";

/**
 * Prepaid handoff code. The plaintext is stored on orders.delivery_otp.
 * Authenticated roles cannot SELECT that column (column-level grants in
 * supabase/migrations/0003_phase5_driver_tracking.sql); issue and read
 * actions return it only to the merchant, the customer, or an admin.
 *
 * Server-only: generation needs node:crypto. Browser code imports the
 * length, limit, and format check from "@/lib/otp-format".
 */
export {
  DELIVERY_OTP_ATTEMPT_LIMIT,
  DELIVERY_OTP_LENGTH,
  isDeliveryOtp,
} from "@/lib/otp-format";

/** Unbiased 4-digit code, including leading zeros. */
export function generateDeliveryOtp(): string {
  return randomInt(0, 10 ** DELIVERY_OTP_LENGTH)
    .toString()
    .padStart(DELIVERY_OTP_LENGTH, "0");
}
