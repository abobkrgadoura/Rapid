"use client";

import { PackageOpen } from "lucide-react";
import { useMemo } from "react";

import { PickupMerchantCard } from "@/components/driver/pickup/pickup-merchant-card";
import { PickupTabs } from "@/components/driver/pickup/pickup-tabs";
import { useDriverPrefs } from "@/components/driver/preferences";
import { useDriverAlerts } from "@/components/driver/use-driver-alerts";
import type { DriverDashboard, PickupMerchant } from "@/lib/data/driver-dashboard";
import { TIME_ZONE } from "@/lib/locale/sudan";

/** Midnight at the start of today in Khartoum. Mirrors the server helper without importing it. */
function khartoumMidnight(now = new Date()): number {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${day}T00:00:00+02:00`).getTime();
}

/**
 * Open pickup parcels split into waiting and urgent.
 * A merchant is urgent when the oldest pending parcel was requested before today.
 * Picked-up-today is not on the dashboard payload, so "تم الاستلام" stays 0.
 */
function pickupCounts(merchants: PickupMerchant[]) {
  const start = khartoumMidnight();
  let waiting = 0;
  let urgent = 0;
  for (const merchant of merchants) {
    const requested = merchant.requestedAt ? new Date(merchant.requestedAt).getTime() : Number.NaN;
    const late = Number.isFinite(requested) && requested < start;
    if (late) urgent += merchant.pendingCount;
    else waiting += merchant.pendingCount;
  }
  return { today: waiting + urgent, waiting, urgent, completed: 0 };
}

/**
 * Pickup driver app (`staff_type = 'pickup_driver'`). Merchant pickups and the
 * driver's own shipments. It never receives delivery rows or customer details.
 */
export function PickupDriverHome({ data }: { data: DriverDashboard }) {
  const { t } = useDriverPrefs();
  const { pickups, alerts, pickupShipments, pickupShipmentsFailed } = data;
  const counts = pickupCounts(pickups);
  const dismissAlert = useDriverAlerts(alerts, null);

  const merchants = useMemo(() => {
    const groups = new Map<string, PickupMerchant[]>();
    for (const merchant of pickups) {
      const list = groups.get(merchant.zone) ?? [];
      list.push(merchant);
      groups.set(merchant.zone, list);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "ar"))
      .flatMap(([, list]) => list);
  }, [pickups]);

  const pickupList =
    merchants.length > 0 ? (
      merchants.map((merchant) => (
        <PickupMerchantCard key={merchant.merchantId} merchant={merchant} />
      ))
    ) : (
      <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-card px-4 py-8 text-center text-sm">
        <PackageOpen className="size-7" />
        {t.emptyPickups}
      </div>
    );

  return (
    <PickupTabs
      todayCount={counts.today}
      completedCount={counts.completed}
      waitingCount={counts.waiting}
      urgentCount={counts.urgent}
      merchants={merchants}
      shipments={pickupShipments}
      shipmentsFailed={pickupShipmentsFailed}
      alerts={alerts}
      onDismissAlert={dismissAlert}
      pickups={pickupList}
    />
  );
}
