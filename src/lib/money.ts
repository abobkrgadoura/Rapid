/**
 * Wallet amounts are integer cents until they are formatted for Postgres numeric.
 *
 * Posted signs match public.transactions:
 * - COD debt is negative: -(product_price + platform_commission)
 * - Prepaid earning is positive: delivery_fee - platform_commission
 *
 * public.order_wallet_delta is the value that is actually posted. Preview
 * compares that result with these functions and refuses to return a figure
 * when the two disagree.
 */

const UNSIGNED_MONEY = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

/** numeric(14,2) upper bound: 999999999999.99 */
const MAX_MONEY_CENTS = BigInt("99999999999999");

export function parseNonNegativeMoneyCents(input: string): bigint | null {
  const trimmed = input.trim();
  if (!UNSIGNED_MONEY.test(trimmed)) return null;

  const [whole, fraction = ""] = trimmed.split(".");
  const cents = BigInt(whole) * HUNDRED + BigInt(fraction.padEnd(2, "0"));
  if (cents > MAX_MONEY_CENTS) return null;
  return cents;
}

export function parsePositiveMoneyCents(input: string): bigint | null {
  const cents = parseNonNegativeMoneyCents(input);
  if (cents === null || cents <= ZERO) return null;
  return cents;
}

export function parseSignedMoneyCents(input: string): bigint | null {
  const trimmed = input.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const cents = parseNonNegativeMoneyCents(unsigned);
  if (cents === null) return null;
  if (negative && cents > MAX_MONEY_CENTS) return null;
  return negative ? -cents : cents;
}

export function formatCents(cents: bigint): string {
  const negative = cents < ZERO;
  const absolute = negative ? -cents : cents;
  if (absolute > MAX_MONEY_CENTS) {
    throw new RangeError("Amount exceeds numeric(14,2).");
  }

  const whole = absolute / HUNDRED;
  const fraction = (absolute % HUNDRED).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

/** Driver wallet debit for a cash-on-delivery order. Zero when both parts are zero. */
export function codDebitCents(
  productPriceCents: bigint,
  platformCommissionCents: bigint,
): bigint {
  if (productPriceCents < ZERO || platformCommissionCents < ZERO) {
    throw new RangeError("COD amounts must be non-negative.");
  }

  const debit = -(productPriceCents + platformCommissionCents);
  if (-debit > MAX_MONEY_CENTS) {
    throw new RangeError("COD debit exceeds numeric(14,2).");
  }
  return debit;
}

/**
 * Driver wallet credit for a prepaid order.
 * The commission is withheld from the delivery fee. The schema rejects a
 * commission above that fee, and so does this function.
 */
export function prepaidCreditCents(
  deliveryFeeCents: bigint,
  platformCommissionCents: bigint,
): bigint {
  if (deliveryFeeCents < ZERO || platformCommissionCents < ZERO) {
    throw new RangeError("Prepaid amounts must be non-negative.");
  }
  if (platformCommissionCents > deliveryFeeCents) {
    throw new RangeError("Platform commission cannot exceed the delivery fee.");
  }

  return deliveryFeeCents - platformCommissionCents;
}
