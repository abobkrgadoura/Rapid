"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Search, Truck, Undo2 } from "lucide-react";

import { useLocale } from "@/components/i18n/locale-context";
import { MerchantOrdersTable } from "@/components/merchant/merchant-orders-table";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MerchantOrderRow } from "@/lib/data/merchant-orders";
import type { OrderStatus } from "@/lib/orders/status";
import { cn } from "@/lib/utils";

const TAB_MATCH: ReadonlyArray<{
  id: "all" | "new" | "progress" | "transit" | "done" | "returns";
  match: (status: OrderStatus) => boolean;
}> = [
  { id: "all", match: () => true },
  { id: "new", match: (status) => status === "pending" },
  {
    id: "progress",
    match: (status) =>
      status === "assigned" || status === "picked_up" || status === "at_hub",
  },
  { id: "transit", match: (status) => status === "in_transit" },
  { id: "done", match: (status) => status === "delivered" },
  {
    id: "returns",
    match: (status) => status === "cancelled" || status === "returned",
  },
];

export function RecentOrdersHeading() {
  const { m } = useLocale();
  return <h2 className="text-lg font-semibold">{m.orders.recent}</h2>;
}

export function OrdersLoadError() {
  const { m } = useLocale();
  return (
    <p role="alert" className="text-destructive text-sm">
      {m.orders.loadError}
    </p>
  );
}

function customerKey(row: MerchantOrderRow): string {
  return (row.phone || row.customerName || row.id).trim();
}

function customerLabel(row: MerchantOrderRow, unnamed: string): string {
  if (row.customerName && row.phone) return `${row.customerName} · ${row.phone}`;
  return row.customerName || row.phone || unnamed;
}

export function MerchantOrdersBoard({ rows }: { rows: MerchantOrderRow[] }) {
  const { m } = useLocale();
  const copy = m.orders;
  const tabs = TAB_MATCH.map((item) => ({ ...item, label: copy.tabs[item.id] }));
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [customer, setCustomer] = useState("all");

  const customers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      const key = customerKey(row);
      if (!seen.has(key)) seen.set(key, customerLabel(row, copy.unnamed));
    }
    return Array.from(seen, ([value, label]) => ({ value, label }));
  }, [rows, copy.unnamed]);

  const active = tabs.find((item) => item.id === tab) ?? tabs[0];
  const needle = query.trim().toLowerCase();

  const filtered = rows.filter((row) => {
    if (!active.match(row.status)) return false;
    if (customer !== "all" && customerKey(row) !== customer) return false;
    if (needle && !row.trackingCode.toLowerCase().includes(needle)) return false;
    return true;
  });

  const customerCount = new Set(filtered.map(customerKey)).size;
  const customerItems = [
    { value: "all", label: copy.allCustomers },
    ...customers,
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
          <p className="text-muted-foreground text-sm">
            {filtered.length} {copy.shipment} · {customerCount}{" "}
            {customerCount === 1 ? copy.customer : copy.customers}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/merchant/orders/new"
            className={cn(buttonVariants({ variant: "brand", size: "lg" }), "h-10 px-4")}
          >
            <Truck />
            {copy.deliver}
          </Link>
          <Link
            href="/merchant/orders/new?intent=exchange"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-10 px-4")}
          >
            <ArrowLeftRight />
            {copy.exchange}
          </Link>
          <Link
            href="/merchant/orders/new?intent=return"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-10 px-4")}
          >
            <Undo2 />
            {copy.return}
          </Link>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start">
          {tabs.map((item) => {
            const count = rows.filter((row) => item.match(row.status)).length;
            return (
              <TabsTrigger key={item.id} value={item.id} className="px-3 py-1.5">
                {item.label}
                <span className="text-muted-foreground tabular-nums">{count}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute inset-y-0 start-3 my-auto size-4" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.searchPlaceholder}
            aria-label={copy.searchLabel}
            className="h-10 ps-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground shrink-0 text-sm">{copy.customerCount}</span>
          <Select
            items={customerItems}
            value={customer}
            onValueChange={(next) => setCustomer(next ?? "all")}
          >
            <SelectTrigger className="h-10 w-full min-w-48 sm:w-64" aria-label="تصفية بعدد العملاء">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {customerItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <MerchantOrdersTable
        rows={filtered}
        empty={
          rows.length === 0 ? copy.emptyNone : copy.emptyFilter
        }
      />
    </div>
  );
}
