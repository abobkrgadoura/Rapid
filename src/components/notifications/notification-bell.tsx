"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/utils/supabase/client";
import { cn } from "@/lib/utils";

export type NotificationBellLabels = {
  notifications: string;
  empty: string;
  markAllRead: string;
};

type NotificationType = "order" | "finance" | "system";

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  isRead: boolean;
  createdAt: string;
};

const TYPE_BORDER: Record<NotificationType, string> = {
  order: "border-brand",
  finance: "border-amber-500",
  system: "border-neutral-400",
};

function isType(value: unknown): value is NotificationType {
  return value === "order" || value === "finance" || value === "system";
}

function parseItem(value: unknown): NotificationItem | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string") return null;
  if (typeof row.message !== "string" || typeof row.created_at !== "string") return null;
  if (typeof row.is_read !== "boolean" || !isType(row.type)) return null;
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    type: row.type,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

function formatWhen(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SD" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function NotificationBell({
  labels,
  locale,
  tone = "light",
}: {
  labels: NotificationBellLabels;
  locale: string;
  /** `dark` matches the charcoal admin header. */
  tone?: "light" | "dark";
}) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    let supabase;
    try {
      supabase = createClient();
    } catch {
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    const [listResult, countResult] = await Promise.all([
      supabase
        .from("notifications")
        .select("id, title, message, type, is_read, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_read", false),
    ]);

    if (listResult.error || !listResult.data) return;

    const next = listResult.data
      .map((row) => parseItem(row))
      .filter((row): row is NotificationItem => row !== null);
    setItems(next);
    setUnread(countResult.error ? next.filter((row) => !row.isRead).length : (countResult.count ?? 0));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function markAllRead() {
    startTransition(async () => {
      let supabase;
      try {
        supabase = createClient();
      } catch {
        return;
      }
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) return;

      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", userId)
        .eq("is_read", false);
      if (error) return;

      setItems((current) => current.map((item) => ({ ...item, isRead: true })));
      setUnread(0);
    });
  }

  const badge = unread > 9 ? "9+" : String(unread);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) void load();
      }}
    >
      <DropdownMenuTrigger
        aria-label={unread > 0 ? `${labels.notifications} (${unread})` : labels.notifications}
        className={cn(
          "pointer-events-auto relative inline-flex size-11 min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center rounded-full outline-none focus-visible:ring-3",
          tone === "dark"
            ? "border border-white/10 text-neutral-200 hover:bg-white/10 focus-visible:ring-white/30"
            : "border-border bg-background hover:bg-muted border focus-visible:ring-ring/50",
        )}
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[0.65rem] font-bold leading-none text-white">
            {badge}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <span className="text-sm font-semibold">{labels.notifications}</span>
          {unread > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={pending}
              onClick={markAllRead}
            >
              {labels.markAllRead}
            </Button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-8 text-center text-sm">
            <Bell className="size-6 opacity-40" />
            {labels.empty}
          </div>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {items.map((item) => (
              <li
                key={item.id}
                className={cn(
                  "border-s-2 px-3 py-2",
                  item.isRead ? "border-transparent" : TYPE_BORDER[item.type],
                )}
              >
                <p className={cn("text-sm", item.isRead ? "font-medium" : "font-semibold")}>
                  {item.title}
                </p>
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{item.message}</p>
                <p className="text-muted-foreground mt-1 text-[0.7rem]">
                  {formatWhen(item.createdAt, locale)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
