"use client";

import { PackageOpen } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

import { acknowledgeDriverAlert } from "@/actions/driver-pro";
import { DeliveryBoard } from "@/components/driver/delivery-work";
import { DriverTabs, DriverTopBar } from "@/components/driver/driver-tabs";
import { DeliveryScanner } from "@/components/driver/delivery-scanner";
import { HubLoadScanner } from "@/components/driver/hub-load-scanner";
import { PickupMerchantCard } from "@/components/driver/stop-cards";
import { useDriverPrefs } from "@/components/driver/preferences";
import type {
  DriverAlert,
  DriverDashboard,
  PickupMerchant,
} from "@/lib/data/driver-dashboard";
import { formatMoney } from "@/lib/format-money";
import { TIME_ZONE } from "@/lib/locale/sudan";
import { parseSignedMoneyCents } from "@/lib/money";

const SEEN_KEY = "rapid.driver.seenDeliveries";

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

export function DriverHome({ data }: { data: DriverDashboard }) {
  const router = useRouter();
  const { t, alert, prefs } = useDriverPrefs();
  const { wallet, shift, pickups, deliveries, alerts } = data;
  const counts = pickupCounts(pickups);

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

  useEffect(() => {
    if (!prefs.highAlert) return;
    const previous = sessionStorage.getItem(SEEN_KEY);
    const next = String(deliveries.length);
    if (previous === null) {
      if (deliveries.length > 0) alert();
    } else if (Number(previous) < deliveries.length) {
      alert();
    }
    sessionStorage.setItem(SEEN_KEY, next);
  }, [deliveries.length, prefs.highAlert, alert]);

  useEffect(() => {
    if (!prefs.highAlert || alerts.length === 0) return;
    const key = alerts.map((item) => item.id).join(",");
    if (sessionStorage.getItem("rapid.driver.alerted") === key) return;
    sessionStorage.setItem("rapid.driver.alerted", key);
    alert();
  }, [alerts, prefs.highAlert, alert]);

  async function dismissAlert(id: string) {
    await acknowledgeDriverAlert(id);
    router.refresh();
  }

  const pickupList =
    merchants.length > 0 ? (
      merchants.map((merchant) => (
        <PickupMerchantCard key={merchant.merchantId} merchant={merchant} />
      ))
    ) : (
      <EmptyState>{t.emptyPickups}</EmptyState>
    );

  if (pickups.length === 0 && deliveries.length > 0) {
    return (
      <DeliveryHome
        alerts={alerts}
        onDismissAlert={dismissAlert}
        currency={wallet.currency}
        cashInHand={shift.cashInHand}
        earningsToday={shift.earningsToday}
        deliveredToday={shift.deliveredToday}
        commission={shift.commissionPerDelivery}
        balance={wallet.balance}
        deliveries={deliveries}
      />
    );
  }

  return (
    <DriverTabs
      todayCount={counts.today}
      completedCount={counts.completed}
      waitingCount={counts.waiting}
      urgentCount={counts.urgent}
      merchants={merchants}
      alerts={alerts}
      onDismissAlert={dismissAlert}
      pickups={pickupList}
    />
  );
}

function DeliveryHome({
  alerts,
  onDismissAlert,
  currency,
  cashInHand,
  earningsToday,
  deliveredToday,
  commission,
  balance,
  deliveries,
}: {
  alerts: DriverAlert[];
  onDismissAlert: (id: string) => void;
  currency: string;
  cashInHand: string;
  earningsToday: string;
  deliveredToday: number;
  commission: string;
  balance: string;
  deliveries: DriverDashboard["deliveries"];
}) {
  const { t } = useDriverPrefs();
  const cents = parseSignedMoneyCents(balance) ?? BigInt(0);
  const walletLabel =
    cents > BigInt(0) ? t.walletOwesYou : cents < BigInt(0) ? t.walletYouOwe : t.walletSettled;

  return (
    <div className="flex flex-1 flex-col">
      <section className="bg-[#082D52] pt-[env(safe-area-inset-top)] pb-6">
        <DriverTopBar alerts={alerts} onDismissAlert={onDismissAlert} />
        <div className="mt-4 flex flex-col gap-1 px-4 text-center text-xs text-white/80">
          <p>
            {t.custody}: {formatMoney(cashInHand, currency)}
            {" · "}
            {t.earnings}: {formatMoney(earningsToday, currency)}
          </p>
          <p className="text-[11px] text-white/70">
            {deliveredToday} × {formatMoney(commission, currency)}
            {" · "}
            {walletLabel} · {formatMoney(balance, currency)}
          </p>
        </div>
      </section>
      <div className="flex flex-1 flex-col gap-4 px-4 py-4 pb-40">
        <DeliveryBoard stops={deliveries} currency={currency} />
      </div>
      <div className="bg-card pointer-events-auto fixed inset-x-0 bottom-0 z-50 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(8,45,82,0.06)]">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-2">
          <HubLoadScanner />
          <DeliveryScanner currency={currency} />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-card px-4 py-8 text-center text-sm">
      <PackageOpen className="size-7" />
      {children}
    </div>
  );
}
