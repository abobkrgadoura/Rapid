import {
  renderTemplate,
  type WhatsAppParams,
  type WhatsAppTemplate,
} from "@/lib/whatsapp/templates";

/**
 * The single seam where a message leaves the app. Today it only logs; a real
 * WhatsApp Business provider call replaces the console line in `deliverWhatsApp`
 * and nothing else changes.
 *
 * Logs never carry a delivery OTP and never carry a full phone number: both
 * would sit in plain text in the host's log storage.
 */

export type WhatsAppDelivery = {
  template: WhatsAppTemplate;
  /** Recipient phone as stored on the profile or order; null when unknown. */
  to: string | null;
  /** The message exactly as the recipient would read it. Never logged as-is. */
  message: string;
  logged: boolean;
};

export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `***${digits.slice(-4)}`;
}

export function deliverWhatsApp<T extends WhatsAppTemplate>(
  template: T,
  params: WhatsAppParams[T],
  to: string | null,
): WhatsAppDelivery {
  const message = renderTemplate(template, params);

  console.info(
    "[whatsapp]",
    JSON.stringify({
      template,
      to: maskPhone(to),
      skipped: to ? undefined : "no recipient phone",
      message: renderTemplate(template, params, { maskSecrets: true }),
    }),
  );

  return { template, to, message, logged: true };
}
