/**
 * The four WhatsApp message templates. Pure functions: no I/O, no secrets
 * held here, so the webhook route and the order events render identically.
 */

export const WHATSAPP_TEMPLATES = [
  "merchant_order_created",
  "merchant_batch_picked_up",
  "customer_picked_up",
  "customer_out_for_delivery",
] as const;

export type WhatsAppTemplate = (typeof WHATSAPP_TEMPLATES)[number];

export type WhatsAppParams = {
  /** Template 1. Sent to the merchant when an order is created. */
  merchant_order_created: { merchant: string };
  /** Template 2. Sent to the merchant when a pickup driver confirms a batch. */
  merchant_batch_picked_up: { count: number };
  /** Template 3. Sent to the customer once the parcel is in the hub. */
  customer_picked_up: { code: string; companyName: string };
  /** Template 4. Sent to the customer when a prepaid parcel leaves the hub. */
  customer_out_for_delivery: { otp: string };
};

export const OTP_MASK = "••••";

const MAX_TEXT = 120;
const CODE = /^[A-Z0-9][A-Z0-9-]{3,31}$/;
const OTP = /^[0-9]{4}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One line, no control characters, bounded. Null when nothing is left. */
function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
  return text.length > 0 ? text : null;
}

/** Validates untrusted params for one template. Null means reject. */
export function parseTemplateParams<T extends WhatsAppTemplate>(
  template: T,
  raw: unknown,
): WhatsAppParams[T] | null {
  if (!isRecord(raw)) return null;

  switch (template) {
    case "merchant_order_created": {
      const merchant = cleanText(raw.merchant);
      return merchant ? ({ merchant } as WhatsAppParams[T]) : null;
    }
    case "merchant_batch_picked_up": {
      const count = raw.count;
      if (typeof count !== "number" || !Number.isInteger(count)) return null;
      if (count < 1 || count > 1000) return null;
      return { count } as WhatsAppParams[T];
    }
    case "customer_picked_up": {
      const code = typeof raw.code === "string" ? raw.code.trim().toUpperCase() : "";
      const companyName = cleanText(raw.companyName);
      if (!CODE.test(code) || !companyName) return null;
      return { code, companyName } as WhatsAppParams[T];
    }
    case "customer_out_for_delivery": {
      const otp = typeof raw.otp === "string" ? raw.otp : "";
      return OTP.test(otp) ? ({ otp } as WhatsAppParams[T]) : null;
    }
    default:
      return null;
  }
}

export function isWhatsAppTemplate(value: unknown): value is WhatsAppTemplate {
  return (
    typeof value === "string" &&
    (WHATSAPP_TEMPLATES as readonly string[]).includes(value)
  );
}

/**
 * Renders the Arabic message. `maskSecrets` swaps the OTP for dots; use it
 * for anything that ends up in a log.
 */
export function renderTemplate<T extends WhatsAppTemplate>(
  template: T,
  params: WhatsAppParams[T],
  options: { maskSecrets?: boolean } = {},
): string {
  switch (template) {
    case "merchant_order_created": {
      const { merchant } = params as WhatsAppParams["merchant_order_created"];
      return `أهلاً ${merchant} 👋 استلمنا طلبك بنجاح. مندوبنا سيتواصل معك.`;
    }
    case "merchant_batch_picked_up": {
      const { count } = params as WhatsAppParams["merchant_batch_picked_up"];
      return `استلم مندوبنا اليوم ${count} شحنة من عنوانك. برجاء التأكيد 👀`;
    }
    case "customer_picked_up": {
      const { code, companyName } = params as WhatsAppParams["customer_picked_up"];
      return `استلمنا شحنتك رقم ${code} من ${companyName} وهي الآن في مخازننا 🤩.`;
    }
    case "customer_out_for_delivery": {
      const { otp } = params as WhatsAppParams["customer_out_for_delivery"];
      const shown = options.maskSecrets ? OTP_MASK : otp;
      return `شحنتك في الطريق إليك! الرقم السري (OTP) للاستلام: ${shown}.`;
    }
    default:
      throw new Error("unknown WhatsApp template");
  }
}
