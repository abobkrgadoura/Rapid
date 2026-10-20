"use client";

import { Banknote, PackageOpen, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { acknowledgeDriverAlert } from "@/actions/driver-pro";
import { DeliveryBoard } from "@/components/driver/delivery-work";
import { DriverTabs } from "@/components/driver/driver-tabs";
import { DeliveryScanner } from "@/components/driver/delivery-scanner";
import { HubLoadScanner } from "@/components/driver/hub-load-scanner";
import { PickupMerchantCard } from "@/components/driver/stop-cards";
import { useDriverPrefs } from "@/components/driver/preferences";
import type { DriverAlert, DriverDashboard, PickupMerchant } from "@/lib/data/driver-dashboard";
import { formatMoney } from "@/lib/format-money";
import { parseSignedMoneyCents } from "@/lib/money";

const SEEN_KEY = "rapid.driver.seenDeliveries";

export function DriverHome({ data }: { data: DriverDashboard }) {
  const router = useRouter();
  const { t, alert, prefs } = useDriverPrefs();
  const { wallet, shift, pickups, deliveries, alerts } = data;
  const pickupCount = pickups.reduce((sum, merchant) => sum + merchant.pendingCount, 0);
  const cents = parseSignedMoneyCents(wallet.balance) ?? BigInt(0);
  const walletLabel =
    cents > BigInt(0) ? t.walletOwesYou : cents < BigInt(0) ? t.walletYouOwe : t.walletSettled;

  const zones = useMemo(() => {
    const groups = new Map<string, PickupMerchant[]>();
    for (const merchant of pickups) {
      const list = groups.get(merchant.zone) ?? [];
      list.push(merchant);
      groups.set(merchant.zone, list);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "ar"));
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

  return (
    <div className="flex flex-col gap-6">
      {alerts.length > 0 ? (
        <div className="flex flex-col gap-2">
          {alerts.map((item) => (
            <DriverNotice
              key={item.id}
              item={item}
              title={item.kind === "retry_delivery" ? t.retryNotice : t.returnNotice}
              dismiss={t.dismiss}
              onDismiss={() => router.refresh()}
            />
          ))}
        </div>
      ) : null}
      <section className="grid grid-cols-2 gap-3">
        <article className="bg-rose-700 text-white flex flex-col gap-1 rounded-3xl px-4 py-4">
          <span className="flex items-center gap-1.5 text-xs font-medium opacity-90">
            <Banknote className="size-3.5" />
            {t.custody}
          </span>
          <p className="text-2xl font-bold tabular-nums">{formatMoney(shift.cashInHand, wallet.currency)}</p>
        </article>
        <article className="bg-emerald-700 text-white flex flex-col gap-1 rounded-3xl px-4 py-4">
          <span className="flex items-center gap-1.5 text-xs font-medium opacity-90">
            <Wallet className="size-3.5" />
            {t.earnings}
          </span>
          <p className="text-2xl font-bold tabular-nums">
            {formatMoney(shift.earningsToday, wallet.currency)}
          </p>
          <p className="text-[11px] leading-snug opacity-80">
            {shift.deliveredToday} × {formatMoney(shift.commissionPerDelivery, wallet.currency)}
          </p>
        </article>
      </section>
      <p className="text-muted-foreground text-center text-xs">{walletLabel} · {formatMoney(wallet.balance, wallet.currency)}</p>

      <DriverTabs
        initialTab={pickups.length === 0 && deliveries.length > 0 ? "deliveries" : "pickups"}
        pickupCount={pickupCount}
        deliveryCount={deliveries.length}
        pickupLabel={t.pickups}
        deliveryLabel={t.deliveries}
        pickedUpLabel={t.pickedUpNotice}
        fromLabel={t.from}
        hubLabel={t.takeToHub}
        dismissLabel={t.dismiss}
        pickups={
          zones.length > 0 ? (
            zones.map(([zone, merchants]) => (
              <section key={zone} className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">
                  {zone} — {merchants.length} {t.merchantsInZone}
                </h2>
                {merchants.map((merchant) => (
                  <PickupMerchantCard key={merchant.merchantId} merchant={merchant} />
                ))}
              </section>
            ))
          ) : (
            <EmptyState>{t.emptyPickups}</EmptyState>
          )
        }
        deliveries={
          deliveries.length > 0 ? (
            <DeliveryBoard stops={deliveries} currency={wallet.currency} />
          ) : (
            <EmptyState>{t.emptyDeliveries}</EmptyState>
          )
        }
        deliveryBar={
          <>
            <HubLoadScanner />
            <DeliveryScanner currency={wallet.currency} />
          </>
        }
      />
    </div>
  );
}

function DriverNotice({
  item,
  title,
  dismiss,
  onDismiss,
}: {
  item: DriverAlert;
  title: string;
  dismiss: string;
  onDismiss: () => void;
}) {
  const [pending, setPending] = useState(false);

  async function close() {
    if (pending) return;
    setPending(true);
    await acknowledgeDriverAlert(item.id);
    onDismiss();
  }

  return (
    <article className="flex items-start justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p>
        <span dir="ltr" className="font-mono text-xs font-bold">
          {item.trackingCode}
        </span>
        <span className="mt-1 block leading-snug">{title}</span>
      </p>
      <button
        type="button"
        onClick={() => void close()}
        disabled={pending}
        className="shrink-0 text-xs font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        {dismiss}
      </button>
    </article>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-3xl border border-dashed px-4 py-8 text-center text-sm">
      <PackageOpen className="size-7" />
      {children}
    </div>
  );
}
