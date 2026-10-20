import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { isRecipientPhone } from "@/lib/orders/recipient";
import { deliverWhatsApp } from "@/lib/whatsapp/deliver";
import {
  isWhatsAppTemplate,
  parseTemplateParams,
  renderTemplate,
  WHATSAPP_TEMPLATES,
} from "@/lib/whatsapp/templates";

/**
 * WhatsApp webhook.
 *
 *   GET   Meta's subscription handshake (hub.mode / hub.verify_token /
 *         hub.challenge). Answers only when WHATSAPP_VERIFY_TOKEN is set and
 *         matches.
 *   POST  Renders and logs one of the four templates.
 *         Body: { "template": "<name>", "params": { ... }, "to": "+249..." }
 *         Auth: the shared secret in WHATSAPP_WEBHOOK_SECRET, sent as
 *         `x-webhook-secret: <secret>` or `Authorization: Bearer <secret>`.
 *
 * Deny by default: with no secret configured the route answers 503, and a
 * wrong or missing secret answers 401. Nothing here reads or writes the
 * database; order events render through the same code in
 * src/lib/whatsapp/notify.ts.
 *
 * Templates and params:
 *   merchant_order_created     { merchant }
 *   merchant_batch_picked_up   { count }
 *   customer_picked_up         { code, companyName }
 *   customer_out_for_delivery  { otp }   (prepaid orders only)
 *
 * The response and the log carry the message with the OTP masked.
 */

const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

function sameSecret(provided: string, expected: string): boolean {
  // Hash first so the comparison is constant-time whatever the lengths are.
  const left = createHash("sha256").update(provided).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: NO_STORE });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providedSecret(request: NextRequest): string | null {
  const header = request.headers.get("x-webhook-secret");
  if (header) return header;

  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function GET(request: NextRequest) {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!expected) return json({ error: "webhook not configured" }, 503);

  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge || !sameSecret(token, expected)) {
    return json({ error: "forbidden" }, 403);
  }

  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE },
  });
}

export async function POST(request: NextRequest) {
  const expected = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!expected) return json({ error: "webhook not configured" }, 503);

  const provided = providedSecret(request);
  if (!provided || !sameSecret(provided, expected)) {
    return json({ error: "unauthorized" }, 401);
  }

  const raw = await request.text();
  if (raw.length === 0 || new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ error: "invalid body" }, 400);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  if (!isRecord(body) || !isWhatsAppTemplate(body.template)) {
    return json({ error: "unknown template", templates: WHATSAPP_TEMPLATES }, 400);
  }

  const template = body.template;
  const params = parseTemplateParams(template, body.params);
  if (!params) return json({ error: "invalid params", template }, 400);

  const to =
    typeof body.to === "string" && isRecipientPhone(body.to) ? body.to.trim() : null;

  deliverWhatsApp(template, params, to);

  return json(
    {
      ok: true,
      template,
      queued: false,
      message: renderTemplate(template, params, { maskSecrets: true }),
    },
    200,
  );
}
