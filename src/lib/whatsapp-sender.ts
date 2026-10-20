/**
 * Thin wrapper around `src/lib/whatsapp.ts` for the original body-parameter
 * helper. The Cloud API call, credential skip, and Meta response logs live there.
 */

import {
  cleanWhatsAppText,
  sendWhatsAppTemplateMessage,
  type WhatsAppSendError,
  type WhatsAppSendResult,
} from "@/lib/whatsapp";

const TEMPLATE_NAME = /^[a-z0-9_]{1,64}$/;

/** Body placeholders for the Meta template `customer_out_for_delivery`. */
const OUT_FOR_DELIVERY_TEMPLATE = "customer_out_for_delivery";

export type { WhatsAppSendError, WhatsAppSendResult };

/**
 * Sends one approved template message through the Meta Cloud API.
 * `params` fill the template body placeholders, in order. Language is `ar`.
 */
export async function sendWhatsAppMessage(
  phone: string,
  templateName: string,
  params: string[],
): Promise<WhatsAppSendResult> {
  if (!TEMPLATE_NAME.test(templateName) || params.length > 10) {
    return { ok: false, error: "invalid_input" };
  }

  const parameters: { type: "text"; text: string }[] = [];
  for (const param of params) {
    const text = cleanWhatsAppText(param);
    if (!text) return { ok: false, error: "invalid_input" };
    parameters.push({ type: "text", text });
  }

  return sendWhatsAppTemplateMessage(
    phone,
    templateName,
    "ar",
    parameters.length > 0 ? [{ type: "body", parameters }] : [],
  );
}

function formatAmount(amount: number): string | null {
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) return null;
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/**
 * Tells the customer a shipment left for delivery.
 * Template body order: order id, merchant name, amount.
 */
export async function notifyCustomerOutForDelivery(
  orderId: string,
  phone: string,
  merchantName: string,
  amount: number,
): Promise<WhatsAppSendResult> {
  const id = cleanWhatsAppText(orderId);
  const merchant = cleanWhatsAppText(merchantName);
  const amountText = formatAmount(amount);
  if (!id || !merchant || !amountText) {
    return { ok: false, error: "invalid_input" };
  }

  return sendWhatsAppMessage(phone, OUT_FOR_DELIVERY_TEMPLATE, [
    id,
    merchant,
    amountText,
  ]);
}
