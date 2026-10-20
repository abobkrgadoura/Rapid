"use client";

import Link from "next/link";
import { Pencil, Printer } from "lucide-react";

import { useLocale } from "@/components/i18n/locale-context";
import { Button, buttonVariants } from "@/components/ui/button";
import type { OrderStatus } from "@/lib/orders/status";
import { cn } from "@/lib/utils";

export function OrderQuickActions({
  orderId,
  trackingCode,
  status,
  onEdit,
  prominent = false,
}: {
  orderId: string;
  trackingCode: string;
  status: OrderStatus;
  onEdit?: () => void;
  /** Full labels. The orders table uses the compact icon-and-label buttons. */
  prominent?: boolean;
}) {
  const { m } = useLocale();
  const printLabel = m.orders.printAwb;
  const editLabel = m.orders.editOrder;
  const pending = status === "pending";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/merchant/orders/${orderId}/awb`}
        aria-label={`${printLabel} ${trackingCode}`}
        className={cn(
          buttonVariants({ variant: prominent ? "brand" : "outline", size: "sm" }),
          "h-8 px-2.5",
        )}
      >
        <Printer />
        <span className={prominent ? undefined : "hidden sm:inline"}>{printLabel}</span>
      </Link>
      {pending && onEdit ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-2.5"
          aria-label={`${editLabel} ${trackingCode}`}
          onClick={onEdit}
        >
          <Pencil />
          <span className={prominent ? undefined : "hidden sm:inline"}>{editLabel}</span>
        </Button>
      ) : null}
    </div>
  );
}
