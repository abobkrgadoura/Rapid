export const SUPPORT_STATUSES = ["open", "in_progress", "resolved"] as const;

export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export type SupportTicket = {
  ticketId: string;
  merchantId: string;
  merchantName: string;
  subject: string;
  description: string;
  status: SupportStatus;
  createdAt: string;
  updatedAt: string;
};

export type SupportError = "unauthorized" | "forbidden" | "invalid" | "failed" | "migration";

const TICKET_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSupportStatus(value: unknown): value is SupportStatus {
  return value === "open" || value === "in_progress" || value === "resolved";
}

export function isTicketId(value: string): boolean {
  return TICKET_UUID.test(value);
}

export function cleanTicketText(value: unknown, max: number, collapse: boolean): string | null {
  if (typeof value !== "string") return null;
  const text = collapse ? value.trim().replace(/\s+/g, " ") : value.trim();
  if (text.length < 1 || text.length > max) return null;
  return text;
}

export function missingSupportSchema(code: string | undefined): boolean {
  return code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205";
}
