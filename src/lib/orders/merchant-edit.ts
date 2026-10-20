import { ORDER_MONEY_MAX_CENTS } from "@/lib/format-money";
import { toLatinDigits } from "@/lib/merchant/settings";
import { formatCents, parseNonNegativeMoneyCents } from "@/lib/money";
import { normalizeRecipientPhone } from "@/lib/orders/recipient";
import type { PaymentType } from "@/lib/orders/status";

const RESERVED_LINE = /^(alt|ref|item|back):/i;

export type MerchantEditIssue = "phone" | "secondary" | "address" | "pieces" | "cod";

export type MerchantEditFields = {
  phone: string;
  secondaryPhone: string;
  dropoffAddress: string;
  piecesCount: string;
  codAmount: string;
};

export type ParsedMerchantEdit = {
  phone: string;
  secondaryPhone: string;
  dropoffAddress: string;
  piecesCount: number;
  /** Canonical pounds for a COD order. Null when the shipment is prepaid. */
  codAmount: string | null;
};

/**
 * Checks the five fields a merchant may change. The customer name is not
 * one of them. Prepaid orders do not accept a COD amount.
 */
export function inspectMerchantEdit(
  fields: MerchantEditFields,
  paymentType: PaymentType,
): { issues: MerchantEditIssue[]; parsed: ParsedMerchantEdit | null } {
  const issues: MerchantEditIssue[] = [];

  const phone = normalizeRecipientPhone(fields.phone);
  if (!phone) issues.push("phone");

  const secondaryRaw = fields.secondaryPhone.trim();
  const secondaryPhone = secondaryRaw ? normalizeRecipientPhone(secondaryRaw) : "";
  if (secondaryRaw && !secondaryPhone) issues.push("secondary");

  const dropoffAddress = fields.dropoffAddress.trim();
  const reserved = dropoffAddress
    .split("\n")
    .some((line) => RESERVED_LINE.test(line.trim()));
  if (dropoffAddress.length < 1 || dropoffAddress.length > 500 || reserved) {
    issues.push("address");
  }

  const piecesRaw = toLatinDigits(fields.piecesCount).trim();
  const piecesCount = /^([1-9]|[1-9]\d)$/.test(piecesRaw) ? Number(piecesRaw) : null;
  if (!piecesCount) issues.push("pieces");

  let codAmount: string | null = null;
  if (paymentType === "cod") {
    const raw = toLatinDigits(fields.codAmount).replace(/[^\d.]/g, "");
    const cents = parseNonNegativeMoneyCents(raw);
    if (cents === null || cents > ORDER_MONEY_MAX_CENTS) {
      issues.push("cod");
    } else {
      codAmount = formatCents(cents);
    }
  }

  if (issues.length > 0 || !phone || !piecesCount) {
    return { issues, parsed: null };
  }

  return {
    issues,
    parsed: {
      phone,
      secondaryPhone: secondaryPhone || "",
      dropoffAddress,
      piecesCount,
      codAmount,
    },
  };
}
