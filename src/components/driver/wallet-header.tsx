import { ArrowDownLeft, ArrowUpRight, Scale, Wallet } from "lucide-react";

import { formatMoney } from "@/lib/format-money";
import { parseSignedMoneyCents } from "@/lib/money";
import type { DriverWallet } from "@/lib/data/driver-dashboard";

/**
 * Wallet sign convention (see .cursorrules): positive means the platform
 * owes the driver, negative means the driver owes the platform. The label
 * and colour follow the sign so the driver never has to read a minus.
 */
export function WalletHeader({ wallet }: { wallet: DriverWallet }) {
  const cents = parseSignedMoneyCents(wallet.balance) ?? BigInt(0);
  const zero = BigInt(0);
  const tone = cents > zero ? "credit" : cents < zero ? "debt" : "even";

  const styles = {
    credit:
      "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950",
    debt: "bg-rose-600 text-white dark:bg-rose-500 dark:text-rose-950",
    even: "bg-foreground text-background",
  } as const;

  const label = {
    credit: "Platform owes you",
    debt: "You owe the platform",
    even: "All settled",
  } as const;

  const Icon = tone === "credit" ? ArrowDownLeft : tone === "debt" ? ArrowUpRight : Scale;

  return (
    <section
      aria-label="Wallet balance"
      className={`flex flex-col gap-2 rounded-3xl px-5 py-6 shadow-md ${styles[tone]}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium opacity-90">
          <Wallet className="size-4" />
          Wallet balance
        </span>
        <span className="flex items-center gap-1 rounded-full bg-black/15 px-2.5 py-1 text-xs font-medium">
          <Icon className="size-3.5" />
          {label[tone]}
        </span>
      </div>
      <p className="text-4xl font-bold tracking-tight tabular-nums">
        {formatMoney(wallet.balance, wallet.currency)}
      </p>
    </section>
  );
}
