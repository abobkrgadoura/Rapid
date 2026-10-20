"use server";

import { revalidatePath } from "next/cache";

import { getAuthSession } from "@/lib/auth/session";
import {
  cleanTicketText,
  isSupportStatus,
  isTicketId,
  missingSupportSchema,
  type SupportError,
  type SupportStatus,
} from "@/lib/support/tickets";
import { createClient } from "@/utils/supabase/server";

export type SupportActionResult = { ok: true } | { ok: false; error: SupportError };

function classify(code: string | undefined): SupportError {
  if (missingSupportSchema(code)) return "migration";
  if (code === "42501" || code === "PGRST301") return "forbidden";
  if (code === "23514" || code === "P0001") return "invalid";
  return "failed";
}

function refresh() {
  revalidatePath("/merchant/support");
  revalidatePath("/admin/support");
}

/** Opens a ticket for the signed-in merchant. The merchant id comes from the session. */
export async function createSupportTicket(input: {
  subject: string;
  description: string;
}): Promise<SupportActionResult> {
  const session = await getAuthSession();
  if (session.status === "anonymous") return { ok: false, error: "unauthorized" };
  if (session.status !== "ready" || session.profile.role !== "merchant") {
    return { ok: false, error: "forbidden" };
  }

  const subject = cleanTicketText(input.subject, 160, true);
  const description = cleanTicketText(input.description, 4000, false);
  if (!subject || !description) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      merchant_id: session.profile.id,
      subject,
      description,
      status: "open",
    })
    .select("ticket_id")
    .maybeSingle();

  if (error || !data) {
    console.error("create support ticket", error?.code, error?.message);
    return { ok: false, error: classify(error?.code) };
  }

  refresh();
  return { ok: true };
}

/** Moves a ticket's status. Only an admin session is accepted. */
export async function updateSupportTicketStatus(input: {
  ticketId: string;
  status: SupportStatus;
}): Promise<SupportActionResult> {
  const session = await getAuthSession();
  if (session.status === "anonymous") return { ok: false, error: "unauthorized" };
  if (session.status !== "ready" || session.profile.role !== "admin") {
    return { ok: false, error: "forbidden" };
  }

  if (!isTicketId(input.ticketId) || !isSupportStatus(input.status)) {
    return { ok: false, error: "invalid" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("support_tickets")
    .update({ status: input.status })
    .eq("ticket_id", input.ticketId)
    .select("ticket_id");

  if (error || !data || data.length !== 1) {
    console.error("update support ticket", error?.code, error?.message);
    return { ok: false, error: error ? classify(error.code) : "failed" };
  }

  refresh();
  return { ok: true };
}
