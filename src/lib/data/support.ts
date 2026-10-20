import { cache } from "react";

import { getAuthSession } from "@/lib/auth/session";
import {
  isSupportStatus,
  missingSupportSchema,
  type SupportTicket,
} from "@/lib/support/tickets";
import { createClient } from "@/utils/supabase/server";

export type SupportLoad =
  | { ok: true; data: SupportTicket[] }
  | { ok: false; reason: "migration" | "failed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function merchantName(value: unknown): string {
  if (!isRecord(value)) return "";
  const company = text(value.company_name).trim();
  const fullName = text(value.full_name).trim();
  return company || fullName;
}

function rowToTicket(value: unknown, withMerchant: boolean): SupportTicket | null {
  if (!isRecord(value) || !isSupportStatus(value.status)) return null;
  if (typeof value.ticket_id !== "string" || typeof value.merchant_id !== "string") return null;
  const createdAt = text(value.created_at);
  const updatedAt = text(value.updated_at);
  if (!createdAt || !updatedAt) return null;
  return {
    ticketId: value.ticket_id,
    merchantId: value.merchant_id,
    merchantName: withMerchant ? merchantName(value.merchant) : "",
    subject: text(value.subject),
    description: text(value.description),
    status: value.status,
    createdAt,
    updatedAt,
  };
}

export const loadMerchantTickets = cache(async (): Promise<SupportLoad> => {
  const session = await getAuthSession();
  if (session.status !== "ready" || session.profile.role !== "merchant") {
    return { ok: false, reason: "failed" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("support_tickets")
    .select("ticket_id, merchant_id, subject, description, status, created_at, updated_at")
    .eq("merchant_id", session.profile.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("merchant support tickets", error.code, error.message);
    return { ok: false, reason: missingSupportSchema(error.code) ? "migration" : "failed" };
  }

  const tickets = (Array.isArray(data) ? data : [])
    .map((row) => rowToTicket(row, false))
    .filter((row): row is SupportTicket => row !== null);

  return { ok: true, data: tickets };
});

export const loadAdminTickets = cache(async (): Promise<SupportLoad> => {
  const session = await getAuthSession();
  if (session.status !== "ready" || session.profile.role !== "admin") {
    return { ok: false, reason: "failed" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("support_tickets")
    .select(
      "ticket_id, merchant_id, subject, description, status, created_at, updated_at, merchant:profiles!support_tickets_merchant_id_fkey(company_name, full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("admin support tickets", error.code, error.message);
    return { ok: false, reason: missingSupportSchema(error.code) ? "migration" : "failed" };
  }

  const tickets = (Array.isArray(data) ? data : [])
    .map((row) => rowToTicket(row, true))
    .filter((row): row is SupportTicket => row !== null);

  return { ok: true, data: tickets };
});
