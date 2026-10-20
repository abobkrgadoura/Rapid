"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Printer } from "lucide-react";

import { useLocale } from "@/components/i18n/locale-context";
import { Button, buttonVariants } from "@/components/ui/button";
import type { AwbFormat } from "@/lib/merchant/settings";
import { cn } from "@/lib/utils";

export function OrderAwbToolbar({
  orderId,
  format,
}: {
  orderId: string;
  format: AwbFormat;
}) {
  const { m, dir } = useLocale();
  const Icon = dir === "rtl" ? ArrowRight : ArrowLeft;
  const pageSize = format === "a6" ? "100mm 150mm" : "A4 portrait";
  const margin = format === "a6" ? "0" : "8mm";

  return (
    <div className="awb-screen-only flex flex-wrap items-center justify-between gap-3">
      <style>{`@media print { @page { size: ${pageSize}; margin: ${margin}; } }`}</style>
      <Link
        href={`/merchant/orders/${orderId}`}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit px-2")}
      >
        <Icon />
        {m.shell.orderDetail}
      </Link>
      <Button type="button" variant="brand" className="h-10 px-4 font-bold" onClick={() => window.print()}>
        <Printer />
        {m.orders.printAwb}
      </Button>
    </div>
  );
}
