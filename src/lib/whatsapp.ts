/**
 * Meta WhatsApp Cloud API.
 *
 * Server-only. Reads WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN.
 * Do not import this module from a Client Component.
 *
 * When either variable is missing, every send skips the network call and
 * logs a warning. Order status updates must keep succeeding in development.
 *
 * Approved template names used by the helpers:
 *   order_out_for_delivery  body: customer, tracking number, merchant, COD amount
 *   order_delivered         body: customer, tracking number
 * Language is `ar`. Create those templates in Meta before production sends.
 */

const GRAPH_VERSION = "v17.0";
const TEMPLATE_NAME = /^[a-z0-9_]{1,64}$/;
const LANGUAGE_CODE = /^[a-z]{2}(?:_[A-Z]{2})?$/;
const PHONE_NUMBER_ID = /^\d{1,32}$/;
const REQUEST_TIMEOUT_MS = 15_000;

export type WhatsAppSendError =
  | "missing_credentials"
  | "invalid_input"
  | "send_failed"
  | "network";

export type WhatsAppSendResult = {
  ok: boolean;
  error?: WhatsAppSendError;
  /** Meta message id when the Cloud API accepted the send. */
  messageId?: string;
};

/** One Cloud API template component. Passed through as the `components` array. */
export type WhatsAppTemplateComponent = {
  type: string;
  sub_type?: string;
  index?: string;
  parameters?: Array<Record<string, unknown>>;
};

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Meta expects a country code and no leading zero.
 * Sudan local (09xxxxxxxx / 01xxxxxxxx, 10 digits) becomes 249 plus nine digits.
 * Egypt mobile local (010 / 011 / 012 / 015, 11 digits) becomes 20 plus ten digits.
 * Numbers already stored as +249… or +20… keep their country code.
 */
function toRecipient(phone: string): string | null {
  const digits = digitsOnly(phone);
  if (digits.length < 8 || digits.length > 15) return null;
  if (/^0[19]\d{8}$/.test(digits)) return `249${digits.slice(1)}`;
  if (/^01[0125]\d{8}$/.test(digits)) return `20${digits.slice(1)}`;
  return digits;
}

function maskPhone(phone: string): string {
  const digits = digitsOnly(phone);
  if (digits.length < 4) return "****";
  return `***${digits.slice(-4)}`;
}

/** One line, no control characters. Null when nothing usable remains. */
export function cleanWhatsAppText(value: string): string | null {
  const text = value
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return text.length > 0 ? text : null;
}

function textParameter(value: string): { type: "text"; text: string } | null {
  const text = cleanWhatsAppText(value);
  if (!text) return null;
  return { type: "text", text };
}

function isComponent(value: object): value is WhatsAppTemplateComponent {
  if (!("type" in value)) return false;
  return typeof value.type === "string" && value.type.length > 0 && value.type.length <= 32;
}

function metaErrorMessage(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "unreadable response";
  const error = "error" in payload ? payload.error : null;
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return "request rejected";
  }
  const message = error.message;
  return typeof message === "string" ? message.slice(0, 300) : "request rejected";
}

function metaMessageId(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null || !("messages" in payload)) {
    return undefined;
  }
  const messages = payload.messages;
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  const first = messages[0];
  if (typeof first !== "object" || first === null || !("id" in first)) return undefined;
  return typeof first.id === "string" ? first.id : undefined;
}

/**
 * Sends one approved template through the Meta Cloud API.
 * `components` is the Cloud API template components array (body, header, buttons).
 * Never throws. Missing credentials skip the request.
 */
export async function sendWhatsAppTemplateMessage(
  phone: string,
  templateName: string,
  languageCode: string,
  components: readonly object[],
): Promise<WhatsAppSendResult> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !accessToken) {
    console.warn(
      "[whatsapp] WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not set. Skipping the Meta Cloud API request.",
    );
    return { ok: false, error: "missing_credentials" };
  }
  if (!PHONE_NUMBER_ID.test(phoneNumberId)) {
    console.warn(
      "[whatsapp] WHATSAPP_PHONE_NUMBER_ID is not a numeric id. Skipping the Meta Cloud API request.",
    );
    return { ok: false, error: "missing_credentials" };
  }

  const to = toRecipient(phone);
  if (!to || !TEMPLATE_NAME.test(templateName) || !LANGUAGE_CODE.test(languageCode)) {
    return { ok: false, error: "invalid_input" };
  }
  if (components.length > 10 || components.some((component) => !isComponent(component))) {
    return { ok: false, error: "invalid_input" };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  const logged = { template: templateName, to: maskPhone(to) };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const raw = await response.text();
    let payload: unknown = null;
    if (raw) {
      try {
        payload = JSON.parse(raw) as unknown;
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      console.error(
        "[whatsapp] Meta Cloud API rejected the template",
        JSON.stringify({
          ...logged,
          status: response.status,
          error: metaErrorMessage(payload),
        }),
      );
      return { ok: false, error: "send_failed" };
    }

    const messageId = metaMessageId(payload);
    console.info(
      "[whatsapp] Meta Cloud API accepted the template",
      JSON.stringify({ ...logged, status: response.status, messageId: messageId ?? null }),
    );
    return messageId ? { ok: true, messageId } : { ok: true };
  } catch (error) {
    console.error(
      "[whatsapp] Meta Cloud API request failed",
      JSON.stringify({
        ...logged,
        error: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return { ok: false, error: "network" };
  }
}

function bodyComponent(
  values: string[],
): { ok: true; components: WhatsAppTemplateComponent[] } | { ok: false } {
  const parameters: Array<{ type: "text"; text: string }> = [];
  for (const value of values) {
    const parameter = textParameter(value);
    if (!parameter) return { ok: false };
    parameters.push(parameter);
  }
  return { ok: true, components: [{ type: "body", parameters }] };
}

/**
 * Customer notice that the parcel left for delivery.
 * Template `order_out_for_delivery`, language `ar`.
 * Body order: customer name, tracking number, merchant name, COD amount.
 */
export async function sendOutForDeliveryWhatsApp(
  phone: string,
  customerName: string,
  trackingNumber: string,
  merchantName: string,
  codAmount: string | number,
): Promise<WhatsAppSendResult> {
  const amount =
    typeof codAmount === "number"
      ? Number.isFinite(codAmount) && codAmount >= 0 && codAmount <= 1_000_000_000
        ? String(Math.round(codAmount * 100) / 100)
        : null
      : cleanWhatsAppText(codAmount);
  if (!amount) return { ok: false, error: "invalid_input" };

  const body = bodyComponent([customerName, trackingNumber, merchantName, amount]);
  if (!body.ok) return { ok: false, error: "invalid_input" };

  return sendWhatsAppTemplateMessage(phone, "order_out_for_delivery", "ar", body.components);
}

/**
 * Customer notice that the parcel was delivered.
 * Template `order_delivered`, language `ar`.
 * Body order: customer name, tracking number.
 */
export async function sendDeliveredWhatsApp(
  phone: string,
  customerName: string,
  trackingNumber: string,
): Promise<WhatsAppSendResult> {
  const body = bodyComponent([customerName, trackingNumber]);
  if (!body.ok) return { ok: false, error: "invalid_input" };

  return sendWhatsAppTemplateMessage(phone, "order_delivered", "ar", body.components);
}
