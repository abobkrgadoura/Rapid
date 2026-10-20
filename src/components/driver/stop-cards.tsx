"use client";

import { ChevronLeft, MapPin, Store } from "lucide-react";

import { PickupScanner } from "@/components/driver/pickup-scanner";
import { useDriverPrefs } from "@/components/driver/preferences";
import type { PickupMerchant } from "@/lib/data/driver-dashboard";
import { navigationHref } from "@/lib/driver/navigation";
import { TIME_ZONE } from "@/lib/locale/sudan";

const taskTime = new Intl.DateTimeFormat("ar-SD-u-nu-latn", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h12",
});

const taskTimeEn = new Intl.DateTimeFormat("en-SD", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h12",
});

function formatTaskTime(iso: string | null, locale: "ar" | "en"): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return locale === "ar" ? taskTime.format(date) : taskTimeEn.format(date);
}

function placeLabel(merchant: PickupMerchant): string {
  const address = merchant.address.trim();
  const zone = merchant.zone.trim();
  if (!address) return zone || "—";
  if (!zone || zone === "منطقة غير محددة" || address.includes(zone)) return address;
  return `${zone} · ${address}`;
}

/**
 * Pickup driver view of one merchant. Company, zone, parcel count, and the
 * batch scanner. Nothing about the customers behind those parcels is passed
 * in, so none can be rendered. Call and navigate stay on the scanner dialog
 * this card opens.
 */
export function PickupMerchantCard({ merchant }: { merchant: PickupMerchant }) {
  const { t, locale, prefs } = useDriverPrefs();
  const { pendingCount } = merchant;
  const maps = navigationHref(prefs.navApp, {
    gpsUrl: merchant.gpsUrl,
    address: merchant.address,
    point: merchant.point,
  });
  const when = formatTaskTime(merchant.requestedAt, locale);

  return (
    <PickupScanner
      merchantId={merchant.merchantId}
      companyName={merchant.companyName}
      pendingCount={pendingCount}
      pickupFee={merchant.pickupFee}
      address={merchant.address}
      phone={merchant.phone}
      mapsHref={maps}
      triggerClassName="relative mb-3 flex w-full cursor-pointer touch-manipulation flex-col gap-3 rounded-2xl border border-zinc-100 bg-white p-4 text-start shadow-sm outline-none"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <span className="inline-flex shrink-0 rounded-xl bg-blue-50 p-2.5 text-[#082D52]">
            <Store size={20} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-base font-bold text-[#082D52]">{merchant.companyName}</span>
            <span className="flex min-w-0 items-center gap-1 text-sm text-gray-500">
              <MapPin size={14} className="shrink-0" aria-hidden />
              <span className="truncate">{placeLabel(merchant)}</span>
            </span>
          </span>
        </span>
        <ChevronLeft className="size-5 shrink-0 text-gray-400 ltr:rotate-180" aria-hidden />
      </span>

      <span className="text-sm font-medium text-gray-600">
        {t.parcelCount}: {pendingCount}
      </span>

      <span className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold text-[#0F62FF]">
          {t.pendingBadge}
        </span>
        {when ? (
          <time dateTime={merchant.requestedAt ?? undefined} className="text-xs text-gray-400">
            {when}
          </time>
        ) : null}
      </span>
    </PickupScanner>
  );
}
