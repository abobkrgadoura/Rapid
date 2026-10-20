import { CURRENCY_AR, CURRENCY_CODE } from "@/lib/locale/sudan";
import { formatCents, parseSignedMoneyCents } from "@/lib/money";

/** numeric(12,2), the precision stored on an order. */
export const ORDER_MONEY_MAX_CENTS = BigInt("999999999999");

/**
 * Postgres numeric sometimes arrives with trailing zeros past the scale.
 * Keep those only when the extra digits are zeros, then canonicalize.
 */
export function canonicalMoney(value: unknown): string | null {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? value.toFixed(2)
      : typeof value === "string"
        ? value.trim()
        : null;
  if (raw === null) return null;

  const direct = parseSignedMoneyCents(raw);
  if (direct !== null) return formatCents(direct);

  const match = raw.match(/^(-?)(0|[1-9]\d{0,11})(?:\.(\d+))?$/);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length <= 2 || !/^0*$/.test(fraction.slice(2))) return null;
  const scaled = `${sign}${whole}.${fraction.slice(0, 2).padEnd(2, "0")}`;
  const cents = parseSignedMoneyCents(scaled);
  if (cents === null) return null;
  return formatCents(cents);
}

/** SDG prints as ج.س. Any other 3-letter code is kept. Anything else falls back to ج.س. */
function currencyLabel(currency: string): string {
  if (currency === CURRENCY_CODE || currency === "SDG") return CURRENCY_AR;
  if (/^[A-Z]{3}$/.test(currency)) return currency;
  return CURRENCY_AR;
}

/**
 * Thousands separators, ج.س by default. Whole pounds drop the cents
 * (`45,000 ج.س`). A value that cannot be read becomes `0 ج.س`.
 */
export function formatMoney(canonical: string, currency = CURRENCY_CODE): string {
  const label = currencyLabel(currency);
  const cents = parseSignedMoneyCents(canonical);
  if (cents === null) {
    const repaired = canonicalMoney(canonical);
    if (repaired !== null && repaired !== canonical) return formatMoney(repaired, currency);
    return `0 ${label}`;
  }

  const negative = cents < BigInt(0);
  const absolute = formatCents(negative ? -cents : cents);
  const [whole, fraction] = absolute.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = fraction === "00" ? `${grouped} ${label}` : `${grouped}.${fraction} ${label}`;
  return negative ? `−${body}` : body;
}

export function sumMoney(values: string[]): string | null {
  let total = BigInt(0);
  for (const value of values) {
    const cents = parseSignedMoneyCents(value);
    if (cents === null) return null;
    total += cents;
  }

  try {
    return formatCents(total);
  } catch {
    return null;
  }
}
