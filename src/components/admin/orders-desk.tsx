"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Send, X } from "lucide-react";

import { assignOrders } from "@/actions/admin";
import { useAdminPrefs } from "@/components/admin/admin-prefs";
import { OrderEditDialog } from "@/components/admin/order-edit-form";
import { OrderInspector } from "@/components/admin/order-inspector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastError, toastSuccess } from "@/components/ui/toast";
import {
  canWorkLeg,
  ORDER_STATUS_AR,
  ORDER_STATUS_TONE,
  ORDER_TABS,
  staffTypeLabel,
  type DispatchLeg,
  type OrderTabId,
} from "@/lib/admin/labels";
import {
  ADMIN_ERROR_MESSAGES,
  SKIP_REASON_MESSAGES,
  type DispatchOutcome,
} from "@/lib/admin/types";
import type { AdminOrderRow, AssignableDriver } from "@/lib/data/admin-ops";
import { formatMoney } from "@/lib/format-money";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 100;

/** Parcels in these states are finished; they cannot join a bulk assignment. */
function selectable(row: AdminOrderRow): boolean {
  return row.status !== "delivered" && row.status !== "returned" && row.status !== "cancelled";
}

export function OrdersDesk({
  orders,
  drivers,
}: {
  orders: AdminOrderRow[];
  drivers: AssignableDriver[];
}) {
  const router = useRouter();
  const { copy } = useAdminPrefs();
  const ordersCopy = copy.orders;
  const [refreshing, startRefresh] = useTransition();
  const [assigning, setAssigning] = useState(false);

  const [tab, setTab] = useState<OrderTabId>("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [picked, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [leg, setLeg] = useState<DispatchLeg>("delivery");
  const [driverId, setDriverId] = useState("");
  const [outcome, setOutcome] = useState<DispatchOutcome | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [editCode, setEditCode] = useState<string | null>(null);

  const activeTab = ORDER_TABS.find((item) => item.id === tab) ?? ORDER_TABS[0];
  const needle = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      orders.filter((row) => {
        if (!activeTab.match(row.status)) return false;
        if (!needle) return true;
        return [
          row.trackingCode,
          row.customerName,
          row.phone,
          row.merchantName,
          row.zone,
          row.driverName ?? "",
          row.pickupDriverName ?? "",
        ].some((value) => value.toLowerCase().includes(needle));
      }),
    [orders, activeTab, needle],
  );
  const visible = filtered.slice(0, limit);
  const visibleSelectable = visible.filter(selectable);

  // Ignore codes that were refreshed away or reached a finished state.
  const selected = useMemo<ReadonlySet<string>>(() => {
    const live = new Set(orders.filter(selectable).map((row) => row.trackingCode));
    return new Set([...picked].filter((code) => live.has(code)));
  }, [orders, picked]);

  const legDrivers = drivers.filter((driver) => canWorkLeg(driver.staffType, leg));
  const driverItems = legDrivers.map((driver) => ({ value: driver.id, label: driver.name }));
  const chosenDriver = legDrivers.find((driver) => driver.id === driverId) ?? null;

  const allVisibleSelected =
    visibleSelectable.length > 0 &&
    visibleSelectable.every((row) => selected.has(row.trackingCode));

  function toggle(code: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const row of visibleSelectable) next.delete(row.trackingCode);
      } else {
        for (const row of visibleSelectable) next.add(row.trackingCode);
      }
      return next;
    });
  }

  function changeLeg(next: DispatchLeg) {
    setLeg(next);
    setDriverId("");
  }

  async function assign() {
    if (!chosenDriver || selected.size === 0 || assigning) return;
    setAssigning(true);
    setOutcome(null);
    try {
      const result = await assignOrders([...selected], chosenDriver.id, leg);
      if (!result.ok) {
        toastError("تعذّر تعيين المندوب", ADMIN_ERROR_MESSAGES[result.error]);
        return;
      }

      const { outcome: done } = result;
      if (done.assigned.length > 0) {
        toastSuccess(
          `تم تعيين ${done.assigned.length} شحنة`,
          `المندوب: ${chosenDriver.name}`,
        );
      } else {
        toastError("لم يتم تعيين أي شحنة", "الشحنات المحددة لا تناسب هذه المرحلة.");
      }
      setOutcome(done.skipped.length > 0 ? done : null);
      setSelected(new Set(done.skipped.map((item) => item.code)));
      startRefresh(() => router.refresh());
    } catch {
      toastError("تعذّر تعيين المندوب", ADMIN_ERROR_MESSAGES.failed);
    } finally {
      setAssigning(false);
    }
  }

  const openRow = openCode ? (orders.find((row) => row.trackingCode === openCode) ?? null) : null;
  const editRow = editCode ? (orders.find((row) => row.trackingCode === editCode) ?? null) : null;

  return (
    <div className="flex flex-col gap-5">
      <div
        role="tablist"
        aria-label={ordersCopy.filter}
        className="flex flex-wrap gap-2"
      >
        {ORDER_TABS.map((item) => {
          const count = orders.filter((row) => item.match(row.status)).length;
          const active = item.id === tab;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setTab(item.id);
                setLimit(PAGE_SIZE);
              }}
              className={cn(
                "pointer-events-auto flex min-h-11 cursor-pointer touch-manipulation items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                active
                  ? "bg-ink-950 border-ink-950 text-white"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {ordersCopy.tabs[item.id]}
              <span
                className={cn(
                  "rounded-full px-2 text-xs tabular-nums",
                  active ? "bg-white/15" : "bg-muted",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute inset-y-0 start-3 my-auto size-4" />
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(PAGE_SIZE);
          }}
          placeholder={ordersCopy.searchPlaceholder}
          aria-label={ordersCopy.searchLabel}
          className="h-11 ps-9"
        />
      </div>

      {selected.size > 0 ? (
        <div
          role="region"
          aria-label={ordersCopy.assignRegion}
          className="bg-ink-950 sticky top-20 z-20 flex flex-col gap-3 rounded-2xl p-4 text-white shadow-xl"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-bold">{ordersCopy.selected(selected.size)}</span>
            <div className="flex rounded-lg bg-white/10 p-0.5" role="group" aria-label={ordersCopy.legLabel}>
              {(["delivery", "pickup"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={leg === item}
                  onClick={() => changeLeg(item)}
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/40",
                    leg === item ? "bg-white text-ink-950" : "text-neutral-300 hover:text-white",
                  )}
                >
                  {ordersCopy.legs[item]}
                </button>
              ))}
            </div>
            <div className="min-w-56 flex-1 sm:max-w-xs">
              <Select
                items={driverItems}
                value={driverId === "" ? null : driverId}
                onValueChange={(next) => setDriverId(next ?? "")}
              >
                <SelectTrigger
                  className="h-9 w-full border-white/20 bg-white/10 text-white dark:bg-white/10"
                  aria-label={ordersCopy.legs[leg]}
                >
                  <SelectValue
                    placeholder={ordersCopy.legs[leg]}
                  />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {legDrivers.map((driver) => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.name}
                      <span className="text-muted-foreground text-xs">
                        {staffTypeLabel(driver.staffType)}
                        {driver.hubZone ? ` · ${driver.hubZone}` : ""}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="brand"
              size="lg"
              className="h-9 gap-2 px-4 font-bold"
              disabled={!chosenDriver || assigning}
              onClick={assign}
            >
              {assigning ? <Loader2 className="animate-spin" /> : <Send />}
              {ordersCopy.assign}
            </Button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs text-neutral-400 underline-offset-4 outline-none hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-white/40"
            >
              {ordersCopy.clear}
            </button>
          </div>
          <p className="text-xs text-neutral-400">
            {leg === "delivery"
              ? "التوصيل: تخرج الشحنات الموجودة بالمخزن مع المندوب وتتحول إلى «خرجت للتوصيل»."
              : "الاستلام: تُحجز الشحنات الجديدة لمندوب الاستلام، ولا يراها غيره."}
          </p>
        </div>
      ) : null}

      {outcome ? (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
            <p className="font-semibold">
              تم تخطي {outcome.skipped.length} شحنة لأنها لا تناسب هذه المرحلة:
            </p>
            <ul className="flex flex-col gap-1 text-xs">
              {outcome.skipped.map((item) => (
                <li key={item.code} className="flex gap-2">
                  <span dir="ltr" className="font-mono font-semibold">
                    {item.code}
                  </span>
                  <span>{SKIP_REASON_MESSAGES[item.reason]}</span>
                </li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            aria-label={ordersCopy.hide}
            onClick={() => setOutcome(null)}
            className="rounded-md p-1 outline-none hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <div
        className={cn(
          "bg-card overflow-x-auto rounded-2xl border shadow-sm transition-opacity",
          refreshing && "opacity-60",
        )}
      >
        <table className="w-full min-w-[60rem] text-sm">
          <caption className="sr-only">الشحنات</caption>
          <thead>
            <tr className="bg-muted/50 text-muted-foreground border-b text-xs">
              <th className="w-12 px-4 py-3 text-start">
                <input
                  type="checkbox"
                  aria-label="تحديد كل الشحنات المعروضة"
                  checked={allVisibleSelected}
                  disabled={visibleSelectable.length === 0}
                  onChange={toggleAll}
                  className="accent-brand size-4 cursor-pointer"
                />
              </th>
              <th className="px-3 py-3 text-start font-medium">رقم التتبع</th>
              <th className="px-3 py-3 text-start font-medium">التاجر</th>
              <th className="px-3 py-3 text-start font-medium">العميل / المنطقة</th>
              <th className="px-3 py-3 text-start font-medium">الدفع</th>
              <th className="px-3 py-3 text-start font-medium">الحالة</th>
              <th className="px-3 py-3 text-start font-medium">المندوب</th>
              <th className="px-3 py-3 text-start font-medium">أُنشئت</th>
              <th className="w-24 px-3 py-3 text-start font-medium">
                <span className="sr-only">التفاصيل</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-muted-foreground h-28 text-center">
                  {orders.length === 0 ? "لا توجد شحنات بعد." : "لا توجد شحنات تطابق التصفية."}
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const canSelect = selectable(row);
                const checked = selected.has(row.trackingCode);
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "hover:bg-muted/40 border-b last:border-0 transition-colors",
                      checked && "bg-brand/5",
                    )}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`تحديد الشحنة ${row.trackingCode}`}
                        checked={checked}
                        disabled={!canSelect}
                        onChange={() => toggle(row.trackingCode)}
                        className="accent-brand size-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => setOpenCode(row.trackingCode)}
                        dir="ltr"
                        className="hover:text-brand text-start font-mono text-xs font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {row.trackingCode}
                      </button>
                    </td>
                    <td className="max-w-40 truncate px-3 py-3">{row.merchantName}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium">{row.customerName || "—"}</span>
                        <span className="text-muted-foreground text-xs">{row.zone}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {row.paymentType === "cod" ? (
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold">COD</span>
                          <span dir="ltr" className="text-start text-xs tabular-nums">
                            {formatMoney(row.cod)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs font-semibold text-emerald-700">مسبق الدفع</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
                          ORDER_STATUS_TONE[row.status],
                        )}
                      >
                        {ORDER_STATUS_AR[row.status]}
                      </span>
                      {row.suspicious ? (
                        <span className="mt-1 inline-flex rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-900">
                          محاولة مشبوهة
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <div className="flex flex-col gap-0.5">
                        <span>
                          <span className="text-muted-foreground">توصيل: </span>
                          {row.driverName ?? "—"}
                        </span>
                        <span>
                          <span className="text-muted-foreground">استلام: </span>
                          {row.pickupDriverName ?? "—"}
                        </span>
                      </div>
                    </td>
                    <td className="text-muted-foreground px-3 py-3 text-xs whitespace-nowrap">
                      {row.createdLabel}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setOpenCode(row.trackingCode)}
                        >
                          {ordersCopy.details}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditCode(row.trackingCode)}
                        >
                          {ordersCopy.edit}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 text-xs">
        <span>
          عرض {visible.length.toLocaleString("en-GB")} من{" "}
          {filtered.length.toLocaleString("en-GB")} شحنة
        </span>
        {filtered.length > visible.length ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
            {ordersCopy.loadMore}
          </Button>
        ) : null}
      </div>

      <OrderInspector
        row={openRow}
        open={openRow !== null}
        onOpenChange={(open) => {
          if (!open) setOpenCode(null);
        }}
        onChanged={() => startRefresh(() => router.refresh())}
        onEdit={() => {
          if (!openRow) return;
          setEditCode(openRow.trackingCode);
          setOpenCode(null);
        }}
      />
      <OrderEditDialog
        row={editRow}
        open={editRow !== null}
        onOpenChange={(open) => {
          if (!open) setEditCode(null);
        }}
        onChanged={() => startRefresh(() => router.refresh())}
      />
    </div>
  );
}
