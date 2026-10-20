/**
 * Client-safe half of the delivery OTP contract. src/lib/otp.ts imports
 * node:crypto to generate codes, so anything that runs in the browser
 * imports these from here instead.
 *
 * Keep the length and the attempt limit equal to the check constraint and
 * verify function in supabase/migrations/0002_phase4_ledger_security.sql.
 */
export const DELIVERY_OTP_LENGTH = 4;
export const DELIVERY_OTP_ATTEMPT_LIMIT = 5;

const DELIVERY_OTP_PATTERN = /^[0-9]{4}$/;

export function isDeliveryOtp(value: string): boolean {
  return DELIVERY_OTP_PATTERN.test(value);
}
