"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";

import { useAdminPrefs } from "@/components/admin/admin-prefs";
import { saveFleetRules, savePricingSettings } from "@/actions/admin-settings";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toastError, toastSuccess } from "@/components/ui/toast";
import type { SettingsSnapshot } from "@/lib/admin/pricing";
import { ADMIN_ERROR_MESSAGES, type AdminErrorCode } from "@/lib/admin/types";
import { CURRENCY_AR, VEHICLE_TYPES, vehicleLabel } from "@/lib/locale/sudan";
import { pickupFeeForOrderCount } from "@/lib/pricing/fees";
import { cn } from "@/lib/utils";

type ZoneRow = {
  key: string;
  stateName: string;
  cityName: string;
  feeSdg: string;
  isActive: boolean;
};

function rowsFrom(snapshot: SettingsSnapshot): ZoneRow[] {
  return snapshot.pricing.zones.map((zone, index) => ({
    key: `${zone.stateName}-${zone.cityName}-${index}`,
    stateName: zone.stateName,
    cityName: zone.cityName,
    feeSdg: String(zone.feeSdg),
    isActive: zone.isActive,
  }));
}

function messageFor(error: AdminErrorCode, migration: boolean): string {
  if (error === "migration_pending" || (error === "invalid" && !migration)) {
    return "طبّق ملف 0008_phase11_5_sudan_kyc.sql أولاً حتى يمكن حفظ التسعير والعهدة.";
  }
  return ADMIN_ERROR_MESSAGES[error];
}

export function SettingsDesk({ snapshot }: { snapshot: SettingsSnapshot }) {
  const router = useRouter();
  const { copy } = useAdminPrefs();
  const settingsCopy = copy.settings;
  const [zones, setZones] = useState<ZoneRow[]>(() => rowsFrom(snapshot));
  const [pickupFee, setPickupFee] = useState(String(snapshot.pricing.pickupFeeSdg));
  const [freeFrom, setFreeFrom] = useState(String(snapshot.pricing.pickupFeeFreeFrom));
  const [maxCash, setMaxCash] = useState(String(snapshot.pricing.defaultMaxCashSdg));
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [savingPricing, setSavingPricing] = useState(false);
  const [savingFleet, setSavingFleet] = useState(false);

  const feeNumber = Number(pickupFee.replace(/[^\d]/g, "") || "0");
  const freeNumber = Number(freeFrom.replace(/[^\d]/g, "") || "0");
  const sampleLow = pickupFeeForOrderCount(Math.max(0, freeNumber - 1), feeNumber, freeNumber || 1);
  const sampleHigh = pickupFeeForOrderCount(freeNumber || 1, feeNumber, freeNumber || 1);

  function updateZone(key: string, patch: Partial<ZoneRow>) {
    setZones((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function savePricing() {
    if (savingPricing) return;
    setSavingPricing(true);
    setPricingError(null);
    try {
      const result = await savePricingSettings({
        pickupFeeSdg: pickupFee,
        freeFrom,
        zones: zones.map((zone) => ({
          stateName: zone.stateName,
          cityName: zone.cityName,
          feeSdg: zone.feeSdg,
          isActive: zone.isActive,
        })),
      });
      if (!result.ok) {
        const text = messageFor(result.error, snapshot.migrationApplied);
        setPricingError(text);
        toastError("تعذّر حفظ التسعير", text);
        return;
      }
      toastSuccess("تم حفظ التسعير", "مصفوفة المناطق وقاعدة الاستلام محدّثتان.");
      router.refresh();
    } catch {
      setPricingError(ADMIN_ERROR_MESSAGES.failed);
    } finally {
      setSavingPricing(false);
    }
  }

  async function saveFleet() {
    if (savingFleet) return;
    setSavingFleet(true);
    setFleetError(null);
    try {
      const result = await saveFleetRules({ defaultMaxCashSdg: maxCash });
      if (!result.ok) {
        const text = messageFor(result.error, snapshot.migrationApplied);
        setFleetError(text);
        toastError("تعذّر حفظ قواعد الأسطول", text);
        return;
      }
      toastSuccess("تم حفظ قواعد الأسطول", "سقف العهدة الافتراضي للمناديب الجدد محدّث.");
      router.refresh();
    } catch {
      setFleetError(ADMIN_ERROR_MESSAGES.failed);
    } finally {
      setSavingFleet(false);
    }
  }

  return (
    <Tabs defaultValue="pricing" className="gap-6">
      {snapshot.migrationApplied ? null : (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0" />
          <p className="leading-relaxed">
            الأرقام المعروضة هي إعداد الإطلاق للسودان. الحفظ يعمل بعد تطبيق{" "}
            <span dir="ltr" className="font-mono font-semibold">
              0008_phase11_5_sudan_kyc.sql
            </span>
            .
          </p>
        </div>
      )}

      <TabsList className="h-auto w-full flex-wrap justify-start">
        <TabsTrigger value="pricing" className="px-4 py-2">
          {settingsCopy.pricingTab}
        </TabsTrigger>
        <TabsTrigger value="fleet" className="px-4 py-2">
          {settingsCopy.fleetTab}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="pricing" className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{settingsCopy.zonesTitle}</CardTitle>
            <CardDescription>
              سعر الشحن لكل ولاية ومدينة بالجنيه السوداني. مثال الإطلاق: الخرطوم 3000 {CURRENCY_AR}،
              بورتسودان 5000 {CURRENCY_AR}. إذا ظهر اسم المدينة في عنوان العميل يُستخدم سعرها.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="text-muted-foreground hidden grid-cols-[1.3fr_1fr_8rem_auto_auto] gap-3 px-1 text-xs font-medium sm:grid">
              <span>الولاية</span>
              <span>المدينة</span>
              <span>السعر ({CURRENCY_AR})</span>
              <span>مفعّلة</span>
              <span className="sr-only">حذف</span>
            </div>
            {zones.map((zone) => (
              <div
                key={zone.key}
                className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[1.3fr_1fr_8rem_auto_auto] sm:items-center sm:border-0 sm:p-0"
              >
                <Input
                  value={zone.stateName}
                  onChange={(event) => updateZone(zone.key, { stateName: event.target.value })}
                  aria-label="الولاية"
                  placeholder="ولاية الخرطوم"
                  className="h-10"
                />
                <Input
                  value={zone.cityName}
                  onChange={(event) => updateZone(zone.key, { cityName: event.target.value })}
                  aria-label="المدينة"
                  placeholder="أم درمان"
                  className="h-10"
                />
                <Input
                  value={zone.feeSdg}
                  onChange={(event) => updateZone(zone.key, { feeSdg: event.target.value })}
                  aria-label="سعر الشحن"
                  inputMode="numeric"
                  dir="ltr"
                  className="h-10 text-start"
                />
                <Switch
                  checked={zone.isActive}
                  onCheckedChange={(next) => updateZone(zone.key, { isActive: next })}
                  aria-label={`تفعيل ${zone.cityName || zone.stateName}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={settingsCopy.deleteZone}
                  onClick={() => setZones((current) => current.filter((row) => row.key !== zone.key))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="w-fit gap-2"
              onClick={() =>
                setZones((current) => [
                  ...current,
                  {
                    key: `new-${current.length}-${Date.now()}`,
                    stateName: "",
                    cityName: "",
                    feeSdg: "0",
                    isActive: true,
                  },
                ])
              }
            >
              <Plus />
              {settingsCopy.addZone}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{settingsCopy.pickupTitle}</CardTitle>
            <CardDescription>
              إذا كان لدى التاجر أقل من الحد شحنات غير ملغاة، تُضاف رسوم الاستلام. عند بلوغ الحد
              أو تجاوزه تصبح الرسوم صفرًا.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium">
              رسوم الاستلام ({CURRENCY_AR})
              <Input
                value={pickupFee}
                onChange={(event) => setPickupFee(event.target.value)}
                inputMode="numeric"
                dir="ltr"
                className="h-10 text-start"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              الاستلام مجاني ابتداءً من
              <Input
                value={freeFrom}
                onChange={(event) => setFreeFrom(event.target.value)}
                inputMode="numeric"
                dir="ltr"
                className="h-10 text-start"
              />
            </label>
            <p className="bg-muted text-muted-foreground rounded-xl px-4 py-3 text-sm leading-relaxed sm:col-span-2">
              مثال: تاجر لديه {Math.max(0, (freeNumber || 1) - 1)} شحنات يدفع{" "}
              <span className="text-foreground font-semibold tabular-nums" dir="ltr">
                {sampleLow.toLocaleString("en-GB")} {CURRENCY_AR}
              </span>
              . تاجر لديه {freeNumber || 0} شحنات أو أكثر يدفع{" "}
              <span className="text-foreground font-semibold tabular-nums" dir="ltr">
                {sampleHigh.toLocaleString("en-GB")} {CURRENCY_AR}
              </span>
              .
            </p>
          </CardContent>
          <CardFooter className="flex flex-wrap items-center gap-3 border-t">
            <Button type="button" variant="brand" disabled={savingPricing} onClick={savePricing}>
              {savingPricing ? <Loader2 className="animate-spin" /> : null}
              {settingsCopy.savePricing}
            </Button>
            {pricingError ? (
              <p role="alert" className="text-destructive text-sm">
                {pricingError}
              </p>
            ) : null}
          </CardFooter>
        </Card>
      </TabsContent>

      <TabsContent value="fleet">
        <Card>
          <CardHeader>
            <CardTitle>{settingsCopy.ceilingTitle}</CardTitle>
            <CardDescription>
              المبلغ الافتراضي الذي يُقترح عند إضافة مندوب. إذا تجاوزت العهدة الحالية هذا السقف
              يُمنع المندوب من استلام شحنات الدفع عند الاستلام الجديدة.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex max-w-sm flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm font-medium">
              السقف الافتراضي ({CURRENCY_AR})
              <Input
                value={maxCash}
                onChange={(event) => setMaxCash(event.target.value)}
                inputMode="numeric"
                dir="ltr"
                className="h-10 text-start"
              />
            </label>
            <div>
              <p className="text-sm font-medium">أنواع المركبات المعتمدة</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {VEHICLE_TYPES.map((type) => (
                  <li
                    key={type}
                    className={cn(
                      "bg-muted rounded-full px-3 py-1 text-sm",
                    )}
                  >
                    {vehicleLabel(type)}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap items-center gap-3 border-t">
            <Button type="button" variant="brand" disabled={savingFleet} onClick={saveFleet}>
              {savingFleet ? <Loader2 className="animate-spin" /> : null}
              {settingsCopy.saveFleet}
            </Button>
            {fleetError ? (
              <p role="alert" className="text-destructive text-sm">
                {fleetError}
              </p>
            ) : null}
          </CardFooter>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
