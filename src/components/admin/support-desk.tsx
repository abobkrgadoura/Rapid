"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { updateSupportTicketStatus } from "@/actions/support";
import { useAdminPrefs } from "@/components/admin/admin-prefs";
import { Button } from "@/components/ui/button";
import { toastError, toastSuccess } from "@/components/ui/toast";
import type { AdminMessages } from "@/lib/admin/messages";
import { TIME_ZONE } from "@/lib/locale/sudan";
import type { SupportStatus, SupportTicket } from "@/lib/support/tickets";
import { isSupportStatus } from "@/lib/support/tickets";

type Filter = "active" | "all" | SupportStatus;

const FILTERS: readonly Filter[] = ["active", "open", "in_progress", "resolved", "all"];

function statusLabel(copy: AdminMessages["support"], status: SupportStatus): string {
  if (status === "open") return copy.open;
  if (status === "in_progress") return copy.inProgress;
  return copy.resolved;
}

function filterLabel(copy: AdminMessages["support"], filter: Filter): string {
  if (filter === "active") return copy.active;
  if (filter === "all") return copy.all;
  return statusLabel(copy, filter);
}

function matches(filter: Filter, status: SupportStatus): boolean {
  if (filter === "all") return true;
  if (filter === "active") return status !== "resolved";
  return status === filter;
}

export function AdminSupportDesk({ tickets }: { tickets: SupportTicket[] }) {
  const { copy, locale } = useAdminPrefs();
  const t = copy.support;
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("active");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const visible = tickets.filter((ticket) => matches(filter, ticket.status));

  async function changeStatus(ticketId: string, status: SupportStatus) {
    if (pendingId) return;
    setPendingId(ticketId);
    try {
      const result = await updateSupportTicketStatus({ ticketId, status });
      if (!result.ok) {
        toastError(t.saveFailed, copy.notices.support);
        return;
      }
      toastSuccess(t.saved);
      router.refresh();
    } catch {
      toastError(t.saveFailed);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={t.filter} className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <Button
            key={item}
            type="button"
            size="sm"
            variant={filter === item ? "brand" : "outline"}
            aria-pressed={filter === item}
            onClick={() => setFilter(item)}
          >
            {filterLabel(t, item)}
          </Button>
        ))}
      </div>

      <div className="bg-card overflow-x-auto rounded-2xl border shadow-sm">
        <table className="w-full min-w-[52rem] text-sm">
          <caption className="sr-only">{copy.pages.support.title}</caption>
          <thead>
            <tr className="bg-muted/50 text-muted-foreground border-b text-xs">
              <th className="px-4 py-3 text-start font-medium">{t.merchant}</th>
              <th className="px-3 py-3 text-start font-medium">{t.subject}</th>
              <th className="px-3 py-3 text-start font-medium">{t.status}</th>
              <th className="px-3 py-3 text-start font-medium">{t.updated}</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted-foreground h-28 text-center">
                  {t.empty}
                </td>
              </tr>
            ) : (
              visible.map((ticket) => (
                <tr key={ticket.ticketId} className="hover:bg-muted/40 border-b align-top last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{ticket.merchantName || "—"}</span>
                      <span dir="ltr" className="text-muted-foreground font-mono text-[0.7rem]">
                        {ticket.ticketId.slice(0, 8)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-medium">{ticket.subject}</p>
                    <p className="text-muted-foreground mt-1 max-w-xl text-xs leading-relaxed whitespace-pre-wrap">
                      {ticket.description}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <label className="flex items-center gap-2">
                      <span className="sr-only">{t.statusLabel}</span>
                      <select
                        value={ticket.status}
                        aria-label={t.statusLabel}
                        disabled={pendingId === ticket.ticketId}
                        onChange={(event) => {
                          const next = event.target.value;
                          if (isSupportStatus(next) && next !== ticket.status) {
                            void changeStatus(ticket.ticketId, next);
                          }
                        }}
                        className="border-input bg-background h-9 rounded-lg border px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <option value="open">{t.open}</option>
                        <option value="in_progress">{t.inProgress}</option>
                        <option value="resolved">{t.resolved}</option>
                      </select>
                      {pendingId === ticket.ticketId ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                    </label>
                  </td>
                  <td className="text-muted-foreground px-3 py-3 text-xs whitespace-nowrap">
                    {formatWhen(ticket.updatedAt, locale)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatWhen(iso: string, locale: "ar" | "en"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(locale === "ar" ? "ar-SD" : "en-GB", {
    timeZone: TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });
}
