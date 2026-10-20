"use client";

import { Bell, LogOut, Menu, Settings, X } from "lucide-react";
import { useState } from "react";

import { useDriverPrefs } from "@/components/driver/preferences";
import { DriverSettingsButton } from "@/components/driver/settings-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth/actions";
import type { DriverAlert } from "@/lib/data/driver-dashboard";

/** Shared by the pickup and delivery driver apps. */
export const iconButton =
  "pointer-events-auto relative z-10 flex size-11 min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center rounded-xl text-white outline-none";

export function DriverTopBar({
  alerts,
  onDismissAlert,
}: {
  alerts: DriverAlert[];
  onDismissAlert?: (id: string) => void | Promise<void>;
}) {
  const { t } = useDriverPrefs();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingAlert, setPendingAlert] = useState<string | null>(null);

  async function dismiss(id: string) {
    if (!onDismissAlert || pendingAlert) return;
    setPendingAlert(id);
    await onDismissAlert(id);
    setPendingAlert(null);
  }

  return (
    <div className="relative flex w-full items-center justify-between px-4 pt-6">
      <DropdownMenu>
        <DropdownMenuTrigger className={iconButton} aria-label={t.notifications}>
          <Bell className="size-6 text-white" />
          {alerts.length > 0 ? (
            <span className="absolute top-2 end-2 size-2.5 rounded-full bg-red-500" />
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 p-2">
          {alerts.length === 0 ? (
            <p className="text-muted-foreground px-2 py-3 text-center text-sm">{t.noAlerts}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {alerts.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950"
                >
                  <p className="min-w-0">
                    <span dir="ltr" className="font-mono text-xs font-bold">
                      {item.trackingCode}
                    </span>
                    <span className="mt-1 block leading-snug">
                      {item.kind === "retry_delivery" ? t.retryNotice : t.returnNotice}
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => void dismiss(item.id)}
                    disabled={pendingAlert === item.id}
                    aria-label={t.dismiss}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="pointer-events-none absolute inset-x-0 top-6 flex h-11 items-center justify-center">
        <img
          src="/logo-white.png"
          alt="Rapid"
          className="h-10 w-[10.75rem] object-cover object-center"
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger className={iconButton} aria-label={t.menu}>
          <Menu className="size-6 text-white" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem
            className="min-h-11 px-3 text-base"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="size-4" />
            {t.settings}
          </DropdownMenuItem>
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex min-h-11 w-full cursor-pointer items-center gap-1.5 rounded-md px-3 text-start text-base outline-none hover:bg-accent"
          >
            <LogOut className="size-4" />
            {t.signOut}
          </button>
        </DropdownMenuContent>
      </DropdownMenu>

      <DriverSettingsButton hideTrigger open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
