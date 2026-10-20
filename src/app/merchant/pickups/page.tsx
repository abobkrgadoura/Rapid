import type { Metadata } from "next";

import { PickupsDashboard } from "@/components/merchant/pickups-dashboard";
import { loadMerchantPickups } from "@/lib/data/merchant-pickups";

export const metadata: Metadata = {
  title: "الاستلامات",
};

export const instant = false;

export default async function MerchantPickupsPage() {
  const result = await loadMerchantPickups();

  if (!result.ok) {
    return (
      <p role="alert" className="text-destructive text-sm">
        تعذر تحميل الاستلامات. حاول مرة أخرى بعد لحظات.
      </p>
    );
  }

  return <PickupsDashboard view={result.data} />;
}
