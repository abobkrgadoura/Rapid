"use client";

import Link from "next/link";
import {
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  PackageOpen,
  RotateCcw,
  Route,
  ScanBarcode,
  ShieldAlert,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

import { useAdminPrefs } from "@/components/admin/admin-prefs";
import type { AdminMessages } from "@/lib/admin/messages";
import type { ControlTower } from "@/lib/data/admin-ops";
import { formatMoney } from "@/lib/format-money";
import { cn } from "@/lib/utils";

type TowerCopy = AdminMessages["tower"];

const KPI_TONE = {
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  hub: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100",
  transit: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
  delivered: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  returned: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100",
  cod: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100",
  suspicious: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100",
} as const;

function count(value: number): string {
  return value.toLocaleString("en-GB");
}

export function ControlTowerBoard({
  tower,
}: {
  tower: { ok: true; data: ControlTower } | { ok: false };
}) {
  const { copy, dir } = useAdminPrefs();
  const t = copy.tower;
  const data = tower.ok ? tower.data : null;
  const flow = flowSteps(t);
  const total = data ? flow.reduce((sum, step) => sum + data[step.key], 0) : 0;
  const Forward = dir === "rtl" ? ChevronLeft : ChevronRight;

  return (
    <>
      {tower.ok ? null : (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-xl px-4 py-3 text-sm">
          {copy.notices.tower}
        </p>
      )}

      <section aria-label={t.metrics} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {kpis(t).map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Link
              key={kpi.key}
              href={kpi.href}
              className="group bg-card focus-visible:ring-ring/50 relative flex flex-col gap-4 overflow-hidden rounded-2xl border p-5 shadow-sm outline-none transition-shadow hover:shadow-md focus-visible:ring-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-2">
                  <span className="text-muted-foreground text-sm font-medium">{kpi.label}</span>
                  <span dir="ltr" className="text-start text-3xl font-bold tracking-tight tabular-nums">
                    {data ? kpi.value(data) : "—"}
                  </span>
                </div>
                <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", kpi.tone)}>
                  <Icon className="size-5" />
                </div>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">{kpi.hint}</p>
              <span className="from-brand/0 via-brand/40 to-brand/0 absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-l opacity-0 transition-opacity group-hover:opacity-100 ltr:bg-gradient-to-r" />
            </Link>
          );
        })}
      </section>

      {data && total > 0 ? (
        <section className="bg-card flex flex-col gap-4 rounded-2xl border p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <PackageOpen className="text-brand size-4" />
            <h2 className="text-base font-semibold">{t.flowTitle}</h2>
            <span className="text-muted-foreground text-sm tabular-nums">({t.shipments(count(total))})</span>
          </div>
          <div
            className="bg-muted flex h-3 w-full overflow-hidden rounded-full"
            role="img"
            aria-label={t.flowTitle}
          >
            {flow.map((step) => {
              const value = data[step.key];
              if (value === 0) return null;
              return (
                <div
                  key={step.key}
                  className={step.bar}
                  style={{ width: `${(value / total) * 100}%` }}
                  title={`${step.label}: ${value}`}
                />
              );
            })}
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
            {flow.map((step) => (
              <li key={step.key} className="flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", step.bar)} />
                <span className="text-muted-foreground">{step.label}</span>
                <span className="font-semibold tabular-nums">{count(data[step.key])}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label={t.shortcuts} className="grid gap-4 md:grid-cols-3">
        {shortcuts(copy).map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="bg-ink-950 hover:bg-ink-900 focus-visible:ring-ring/50 group flex items-start gap-4 rounded-2xl p-5 text-white outline-none transition-colors focus-visible:ring-3"
            >
              <span className="bg-brand/25 text-gold flex size-10 shrink-0 items-center justify-center rounded-xl">
                <Icon className="size-5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-sm font-bold">{item.title}</span>
                <span className="text-xs leading-relaxed text-neutral-400">{item.text}</span>
              </span>
              <Forward
                className={cn(
                  "mt-1 size-4 shrink-0 text-neutral-500 transition-transform",
                  dir === "rtl" ? "group-hover:-translate-x-1" : "group-hover:translate-x-1",
                )}
              />
            </Link>
          );
        })}
      </section>
    </>
  );
}

function kpis(t: TowerCopy): ReadonlyArray<{
  key: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  tone: string;
  value: (data: ControlTower) => string;
  href: string;
}> {
  return [
    {
      key: "pending",
      label: t.pending,
      hint: t.pendingHint,
      icon: Clock,
      tone: KPI_TONE.pending,
      value: (data) => count(data.pendingPickup),
      href: "/admin/orders",
    },
    {
      key: "hub",
      label: t.hub,
      hint: t.hubHint,
      icon: Warehouse,
      tone: KPI_TONE.hub,
      value: (data) => count(data.atHub),
      href: "/admin/hub",
    },
    {
      key: "transit",
      label: t.transit,
      hint: t.transitHint,
      icon: Truck,
      tone: KPI_TONE.transit,
      value: (data) => count(data.outForDelivery),
      href: "/admin/orders",
    },
    {
      key: "delivered",
      label: t.delivered,
      hint: t.deliveredHint,
      icon: CheckCircle2,
      tone: KPI_TONE.delivered,
      value: (data) => count(data.delivered),
      href: "/admin/orders",
    },
    {
      key: "returned",
      label: t.returned,
      hint: t.returnedHint,
      icon: RotateCcw,
      tone: KPI_TONE.returned,
      value: (data) => count(data.returned),
      href: "/admin/orders",
    },
    {
      key: "cod",
      label: t.cod,
      hint: t.codHint,
      icon: Banknote,
      tone: KPI_TONE.cod,
      value: (data) => formatMoney(data.activeCod),
      href: "/admin/finance",
    },
    {
      key: "suspicious",
      label: t.suspicious,
      hint: t.suspiciousHint,
      icon: ShieldAlert,
      tone: KPI_TONE.suspicious,
      value: (data) => count(data.suspiciousAttempts),
      href: "/admin/orders",
    },
  ];
}

function flowSteps(t: TowerCopy) {
  return [
    { key: "pendingPickup" as const, bar: "bg-amber-400", label: t.flowPending },
    { key: "atHub" as const, bar: "bg-indigo-500", label: t.flowHub },
    { key: "outForDelivery" as const, bar: "bg-sky-500", label: t.flowTransit },
    { key: "delivered" as const, bar: "bg-emerald-500", label: t.flowDelivered },
    { key: "returned" as const, bar: "bg-orange-500", label: t.flowReturned },
  ];
}

function shortcuts(copy: AdminMessages) {
  return [
    {
      href: "/admin/hub",
      title: copy.shell.items.hub,
      text: copy.tower.shortcutHub,
      icon: ScanBarcode,
    },
    {
      href: "/admin/orders",
      title: copy.shell.items.orders,
      text: copy.tower.shortcutOrders,
      icon: Route,
    },
    {
      href: "/admin/staff",
      title: copy.shell.items.staff,
      text: copy.tower.shortcutStaff,
      icon: Users,
    },
  ];
}
