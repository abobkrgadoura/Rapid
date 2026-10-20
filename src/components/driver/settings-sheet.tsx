"use client";

import { Settings } from "lucide-react";
import { useState } from "react";

import { useDriverPrefs } from "@/components/driver/preferences";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { NAV_APPS, type NavApp } from "@/lib/driver/navigation";
import type { DriverPreferences } from "@/lib/driver/preferences";
import { VEHICLE_TYPES, vehicleLabel, type VehicleType } from "@/lib/locale/sudan";
import { cn } from "@/lib/utils";

const VEHICLE_ORDER: VehicleType[] = ["موتوسيكل", "سيارة ملاكي", "سيارة فان"];

function Choice({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "pointer-events-auto h-11 min-h-11 cursor-pointer touch-manipulation rounded-2xl border px-3 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        pressed ? "border-brand bg-brand text-brand-foreground" : "bg-card",
      )}
    >
      {children}
    </button>
  );
}

export function DriverSettingsButton() {
  const { t, prefs, setPrefs, locale } = useDriverPrefs();
  const [open, setOpen] = useState(false);

  function patch(partial: Partial<DriverPreferences>) {
    setPrefs({ ...prefs, ...partial });
  }

  const navLabel: Record<NavApp, string> = {
    google_maps: t.google,
    waze: t.waze,
    apple_maps: t.apple,
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={() => setOpen(true)}
        className="h-11 min-h-11 gap-1.5 px-3"
      >
        <Settings className="size-4" />
        {t.settings}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.settingsTitle}</DialogTitle>
            <DialogDescription>{t.settingsHint}</DialogDescription>
          </DialogHeader>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t.language}</h3>
            <div className="grid grid-cols-2 gap-2">
              <Choice pressed={prefs.locale === "ar"} onClick={() => patch({ locale: "ar" })}>
                {t.arabic}
              </Choice>
              <Choice pressed={prefs.locale === "en"} onClick={() => patch({ locale: "en" })}>
                {t.english}
              </Choice>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t.navApp}</h3>
            <div className="grid gap-2">
              {NAV_APPS.map((app) => (
                <Choice
                  key={app}
                  pressed={prefs.navApp === app}
                  onClick={() => patch({ navApp: app })}
                >
                  {navLabel[app]}
                </Choice>
              ))}
            </div>
          </section>

          <label className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
            <span className="text-sm font-semibold">{t.darkMode}</span>
            <Switch
              checked={prefs.darkMode}
              onCheckedChange={(next) => patch({ darkMode: next })}
              aria-label={t.darkMode}
            />
          </label>

          <label className="flex items-start justify-between gap-3 rounded-2xl border px-4 py-3">
            <span className="flex flex-col gap-1">
              <span className="text-sm font-semibold">{t.alerts}</span>
              <span className="text-muted-foreground text-xs leading-snug">{t.alertsHint}</span>
            </span>
            <Switch
              checked={prefs.highAlert}
              onCheckedChange={(next) => patch({ highAlert: next })}
              aria-label={t.alerts}
            />
          </label>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t.vehicle}</h3>
            <p className="text-muted-foreground text-xs">{t.vehicleHint}</p>
            <div className="grid gap-2">
              {VEHICLE_ORDER.filter((type) =>
                (VEHICLE_TYPES as readonly string[]).includes(type),
              ).map((type) => (
                <Choice
                  key={type}
                  pressed={prefs.activeVehicle === type}
                  onClick={() => patch({ activeVehicle: type })}
                >
                  {vehicleLabel(type, locale)}
                </Choice>
              ))}
            </div>
          </section>
        </DialogContent>
      </Dialog>
    </>
  );
}
