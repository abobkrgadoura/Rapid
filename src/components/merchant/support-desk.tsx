"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { createSupportTicket } from "@/actions/support";
import { useLocale } from "@/components/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toastError, toastSuccess } from "@/components/ui/toast";
import type { Messages } from "@/lib/i18n/messages";
import { TIME_ZONE } from "@/lib/locale/sudan";
import type { SupportStatus, SupportTicket } from "@/lib/support/tickets";
import { cn } from "@/lib/utils";

const fieldClass =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function statusLabel(copy: Messages["support"], status: SupportStatus): string {
  return copy.status[status];
}

export function MerchantSupportDesk({
  tickets,
  loadError,
}: {
  tickets: SupportTicket[];
  loadError: "migration" | "failed" | null;
}) {
  const { m, locale } = useLocale();
  const copy = m.support;
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const result = await createSupportTicket({ subject, description });
      if (!result.ok) {
        toastError(copy.errors[result.error]);
        return;
      }
      setSubject("");
      setDescription("");
      toastSuccess(copy.created);
      router.refresh();
    } catch {
      toastError(copy.errors.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
        <p className="text-muted-foreground text-sm">{copy.subtitle}</p>
      </header>

      {loadError ? (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-xl px-4 py-3 text-sm">
          {loadError === "migration" ? copy.errors.migration : copy.loadError}
        </p>
      ) : null}

      <form onSubmit={submit} className="bg-card flex flex-col gap-4 rounded-2xl border p-5 shadow-sm">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {copy.subject}
          <Input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={160}
            required
            className="h-10"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {copy.description}
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            maxLength={4000}
            required
            className={fieldClass}
          />
        </label>
        <Button type="submit" variant="brand" className="h-10 w-fit font-bold" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          {saving ? copy.submitting : copy.submit}
        </Button>
      </form>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{copy.yours}</h2>
        {tickets.length === 0 ? (
          <p className="text-muted-foreground bg-card rounded-2xl border px-4 py-10 text-center text-sm">
            {copy.empty}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {tickets.map((ticket) => (
              <li key={ticket.ticketId} className="bg-card flex flex-col gap-2 rounded-2xl border p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="font-semibold">{ticket.subject}</p>
                    <p dir="ltr" className="text-muted-foreground font-mono text-[0.7rem]">
                      {ticket.ticketId.slice(0, 8)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      ticket.status === "resolved"
                        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
                        : ticket.status === "in_progress"
                          ? "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100"
                          : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
                    )}
                  >
                    {statusLabel(copy, ticket.status)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{ticket.description}</p>
                <p className="text-muted-foreground text-xs">
                  {formatWhen(ticket.createdAt, locale)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
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
