"use client";

import { DeliveryBoard } from "@/components/driver/delivery/delivery-work";
import { DeliveryScanner } from "@/components/driver/delivery/delivery-scanner";
import { HubLoadScanner } from "@/components/driver/delivery/hub-load-scanner";
import { DriverTopBar } from "@/components/driver/driver-top-bar";
import { useDriverPrefs } from "@/components/driver/preferences";
import { useDriverAlerts } from "@/components/driver/use-driver-alerts";
import type { DriverDashboard } from "@/lib/data/driver-dashboard";
import { formatMoney } from "@/lib/format-money";
import { parseSignedMoneyCents } from "@/lib/money";

/**
 * Delivery driver app (`staff_type = 'delivery_driver'`): hub load, deliveries,
 * COD custody and the customer details needed for the final handoff.
 * Phase 22 replaces this screen with the redesigned delivery UI.
 */
export function DeliveryDriverHome({ data }: { data: DriverDashboard }) {
  const { t } = useDriverPrefs();
  const { wallet, shift, deliveries, alerts } = data;
  const dismissAlert = useDriverAlerts(alerts, deliveries.length);

  const cents = parseSignedMoneyCents(wallet.balance) ?? BigInt(0);
  const walletLabel =
    cents > BigInt(0) ? t.walletOwesYou : cents < BigInt(0) ? t.walletYouOwe : t.walletSettled;

  return (
    <div className="flex flex-1 flex-col">
      <section className="bg-[#082D52] pt-[env(safe-area-inset-top)] pb-6">
        <DriverTopBar alerts={alerts} onDismissAlert={dismissAlert} />
        <div className="mt-4 flex flex-col gap-1 px-4 text-center text-xs text-white/80">
          <p>
            {t.custody}: {formatMoney(shift.cashInHand, wallet.currency)}
            {" · "}
            {t.earnings}: {formatMoney(shift.earningsToday, wallet.currency)}
          </p>
          <p className="text-[11px] text-white/70">
            {shift.deliveredToday} × {formatMoney(shift.commissionPerDelivery, wallet.currency)}
            {" · "}
            {walletLabel} · {formatMoney(wallet.balance, wallet.currency)}
          </p>
        </div>
      </section>
      <div className="flex flex-1 flex-col gap-4 px-4 py-4 pb-40">
        <DeliveryBoard stops={deliveries} currency={wallet.currency} />
      </div>
      <div className="bg-card pointer-events-auto fixed inset-x-0 bottom-0 z-50 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(8,45,82,0.06)]">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-2">
          <HubLoadScanner />
          <DeliveryScanner currency={wallet.currency} />
        </div>
      </div>
    </div>
  );
}
