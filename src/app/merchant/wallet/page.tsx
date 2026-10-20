import type { Metadata } from "next";

import { WalletDashboard } from "@/components/merchant/wallet-dashboard";
import { requireRole } from "@/lib/auth/session";
import { loadMerchantWallet } from "@/lib/data/finance";

export const metadata: Metadata = {
  title: "المحفظة",
};

export const instant = false;

export default async function MerchantWalletPage() {
  await requireRole("merchant");
  const wallet = await loadMerchantWallet();

  if (!wallet.ok) {
    return (
      <p role="alert" className="text-destructive text-sm">
        تعذّر تحميل المحفظة. حدّث الصفحة بعد قليل.
      </p>
    );
  }

  return <WalletDashboard view={wallet.data} />;
}
