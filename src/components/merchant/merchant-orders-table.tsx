"use client";

import { useState } from "react";

import { DataTable, type DataColumn } from "@/components/data-table";
import { useLocale } from "@/components/i18n/locale-context";
import {
  MerchantOrderEditDialog,
  type EditableMerchantOrder,
} from "@/components/merchant/merchant-order-edit-dialog";
import { OrderQuickActions } from "@/components/merchant/order-quick-actions";
import { Badge } from "@/components/ui/badge";
import type { MerchantOrderRow } from "@/lib/data/merchant-orders";
import { formatMoney } from "@/lib/format-money";
import { orderStatusClass, type OrderStatus } from "@/lib/orders/status";

const STATUS_AR: Record<OrderStatus, string> = {
  pending: "جديد",
  assigned: "مُسنَد",
  picked_up: "تم الاستلام",
  at_hub: "في الهب",
  in_transit: "متجه للعميل",
  delivered: "تم بنجاح",
  returned: "مرتجع",
  cancelled: "ملغي",
};

const columns: DataColumn<MerchantOrderRow>[] = [
  {
    id: "tracking",
    header: "رقم التتبع",
    cell: (row) => (
      <span dir="ltr" className="font-mono text-xs font-semibold group-hover:text-brand group-hover:underline">
        {row.trackingCode}
      </span>
    ),
  },
  {
    id: "recipient",
    header: "العميل",
    className: "max-w-40 whitespace-normal",
    cell: (row) => row.customerName || "—",
  },
  {
    id: "phone",
    header: "الهاتف",
    headClassName: "hidden md:table-cell",
    className: "hidden md:table-cell",
    cell: (row) => (
      <span className="flex flex-col gap-0.5">
        <span dir="ltr" className="text-end tabular-nums">
          {row.phone || "—"}
        </span>
        {row.secondaryPhone ? (
          <span dir="ltr" className="text-muted-foreground text-end text-xs tabular-nums">
            {row.secondaryPhone}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    id: "dropoff",
    header: "العنوان",
    className: "max-w-56 whitespace-normal",
    cell: (row) => row.dropoffAddress || "—",
  },
  {
    id: "payment",
    header: "الدفع",
    cell: (row) => (
      <Badge variant={row.paymentType === "cod" ? "secondary" : "outline"}>
        {row.paymentType === "cod" ? "عند الاستلام" : "مدفوع"}
      </Badge>
    ),
  },
  {
    id: "product",
    header: "المنتج",
    headClassName: "text-end",
    className: "text-end tabular-nums",
    cell: (row) => formatMoney(row.productPrice),
  },
  {
    id: "fee",
    header: "الرسوم",
    headClassName: "text-end",
    className: "text-end tabular-nums",
    cell: (row) => formatMoney(row.deliveryFee),
  },
  {
    id: "status",
    header: "الحالة",
    cell: (row) => (
      <Badge variant="outline" className={orderStatusClass(row.status)}>
        {STATUS_AR[row.status]}
      </Badge>
    ),
  },
  {
    id: "created",
    header: "التاريخ",
    className: "text-muted-foreground text-xs",
    cell: (row) => row.createdLabel,
  },
];

function editableOrder(row: MerchantOrderRow): EditableMerchantOrder {
  return {
    id: row.id,
    trackingCode: row.trackingCode,
    phone: row.phone,
    secondaryPhone: row.secondaryPhone,
    dropoffAddress: row.dropoffAddress,
    piecesCount: row.piecesCount,
    productPrice: row.productPrice,
    paymentType: row.paymentType,
  };
}

export function MerchantOrdersTable({
  rows,
  empty = "لا توجد طلبات بعد.",
}: {
  rows: MerchantOrderRow[];
  empty?: string;
}) {
  const { m } = useLocale();
  const [editing, setEditing] = useState<EditableMerchantOrder | null>(null);
  const tableColumns: DataColumn<MerchantOrderRow>[] = [
    ...columns,
    {
      id: "actions",
      header: m.orders.actions,
      interactive: true,
      headClassName: "text-end",
      className: "whitespace-nowrap text-end",
      cell: (row) => (
        <OrderQuickActions
          orderId={row.id}
          trackingCode={row.trackingCode}
          status={row.status}
          onEdit={row.status === "pending" ? () => setEditing(editableOrder(row)) : undefined}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        columns={tableColumns}
        rows={rows}
        rowKey={(row) => row.id}
        rowHref={(row) => `/merchant/orders/${row.id}`}
        rowLabel={(row) => `${m.orderDetail.open} ${row.trackingCode}`}
        empty={empty}
        caption="طلبات التاجر"
      />
      <MerchantOrderEditDialog
        order={editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      {rows.length === 100 ? (
        <p className="text-muted-foreground text-xs">
          آخر 100 طلب.
        </p>
      ) : null}
    </div>
  );
}
