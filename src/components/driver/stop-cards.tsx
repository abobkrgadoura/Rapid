"use client";

import { Navigation, Phone, Store } from "lucide-react";
import { cn } from "cn";

import { PickupScanner } from "@/components/driver/pickup-scanner";
import { useDriverPrefs } from "@/components/driver/preferences";
import { buttonVariants } from "@/components/ui/button";
import type { PickupMerchant } from "@/lib/data/driver-dashboard";
import { navigationHref } from "@/lib/driver/navigation";

function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

const linkButton = cn(
  buttonVariants({ variant: "outline" }),
  "h-12 flex-1 gap-2 rounded-2xl text-base",
);

/**
 * Pickup driver view of one merchant. Company, address, how many parcels are
 * waiting, Call, Navigate, and the batch scanner. Nothing about the customers
 * behind those parcels is passed to this component, so none can be rendered.
 */
export function PickupMerchantCard({ merchant }: { merchant: PickupMerchant }) {
  const { t, prefs } = useDriverPrefs();
  const { pendingCount } = merchant;
  const maps = navigationHref(prefs.navApp, {
    gpsUrl: merchant.gpsUrl,
    address: merchant.address,
    point: merchant.point,
  });

  return (
    <article className="bg-card flex flex-col gap-4 rounded-3xl border p-4 shadow-sm">
      <header className="flex items-start gap-3">
        <div className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-2xl">
          <Store className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg leading-snug font-semibold">{merchant.companyName}</p>
          <p className="text-muted-foreground text-sm leading-snug">
            {merchant.address || "—"}
          </p>
        </div>
        <div className="bg-muted flex shrink-0 flex-col items-center rounded-2xl px-3 py-1.5 text-center">
          <span className="text-xl leading-none font-semibold tabular-nums">
            {pendingCount}
          </span>
          <span className="text-muted-foreground text-[11px] leading-tight">
            {pendingCount === 1 ? t.parcel : t.parcels}
          </span>
        </div>
      </header>

      <div className="flex gap-3">
        {merchant.phone ? (
          <a href={telUrl(merchant.phone)} className={linkButton}>
            <Phone className="size-5" />
            {t.call}
          </a>
        ) : null}
        <a href={maps} target="_blank" rel="noopener noreferrer" className={linkButton}>
          <Navigation className="size-5" />
          {t.navigate}
        </a>
      </div>

      <PickupScanner
        merchantId={merchant.merchantId}
        companyName={merchant.companyName}
        pendingCount={pendingCount}
        pickupFee={merchant.pickupFee}
      />
    </article>
  );
}
