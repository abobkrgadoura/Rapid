"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Package,
  PackageCheck,
  PackagePlus,
  Truck,
  UserRound,
  Warehouse,
} from "lucide-react";

import { useLocale } from "@/components/i18n/locale-context";
import {
  MerchantOrderEditDialog,
  type EditableMerchantOrder,
} from "@/components/merchant/merchant-order-edit-dialog";
import { OrderQuickActions } from "@/components/merchant/order-quick-actions";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AttemptProofCard } from "@/components/orders/attempt-proof";
import type { MerchantOrderDetail } from "@/lib/data/merchant-orders";
import { formatMoney } from "@/lib/format-money";
import type { Messages } from "@/lib/i18n/messages";
import { isRecipientPhone } from "@/lib/orders/recipient";
import { PARCEL_SIZE_AR } from "@/lib/orders/shipment-details";
import { orderStatusClass, type OrderStatus } from "@/lib/orders/status";
import type { TimelineKey, TimelineStep } from "@/lib/orders/timeline";
import { cn } from "@/lib/utils";

export type MerchantOrderView =
  | { status: "ready"; order: MerchantOrderDetail; steps: TimelineStep[] }
  | { status: "missing" }
  | { status: "error" };

const BAR: Record<OrderStatus, string> = {
  pending: "bg-amber-500",
  assigned: "bg-violet-500",
  picked_up: "bg-blue-500",
  at_hub: "bg-indigo-500",
  in_transit: "bg-sky-500",
  delivered: "bg-emerald-500",
  returned: "bg-orange-500",
  cancelled: "bg-rose-500",
};

const STEP_ICON: Record<TimelineKey, ComponentType<{ className?: string }>> = {
  created: PackagePlus,
  picked_up: Warehouse,
  out_for_delivery: Truck,
  delivered: PackageCheck,
};

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Africa/Khartoum",
});

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : timeFormat.format(date);
}

function phoneHref(phone: string): string | null {
  if (!isRecipientPhone(phone)) return null;
  const compact = phone.replace(/[^\d+]/g, "");
  return /^\+?\d{7,15}$/.test(compact) ? `tel:${compact}` : null;
}

function shipmentKind(order: MerchantOrderDetail): "delivery" | "exchange" | "return" {
  if (order.newItemNote && order.returnItemNote) return "exchange";
  if (order.returnItemNote || order.originalTracking) return "return";
  return "delivery";
}

function BackLink({ label, dir }: { label: string; dir: "rtl" | "ltr" }) {
  const Icon = dir === "rtl" ? ArrowRight : ArrowLeft;
  return (
    <Link
      href="/merchant/orders"
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit px-2")}
    >
      <Icon />
      {label}
    </Link>
  );
}

function Notice({
  title,
  body,
  alert,
}: {
  title: string;
  body: string;
  alert?: boolean;
}) {
  const { m, dir } = useLocale();
  return (
    <div className="flex flex-col gap-4">
      <BackLink label={m.orderDetail.back} dir={dir} />
      <Card>
        <CardHeader>
          <CardTitle role={alert ? "alert" : undefined}>{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function Fact({
  label,
  value,
  ltr,
  href,
}: {
  label: string;
  value: string;
  ltr?: boolean;
  href?: string | null;
}) {
  const body = href ? (
    <a
      href={href}
      className="text-brand font-semibold underline-offset-4 hover:underline"
      {...(href.startsWith("http")
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {})}
    >
      {value}
    </a>
  ) : (
    <span className="font-semibold">{value}</span>
  );

  return (
    <div className="flex flex-col gap-1 py-3">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd dir={ltr ? "ltr" : undefined} className="text-sm leading-snug whitespace-pre-line">
        {body}
      </dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-background px-4 py-3">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <span className="text-base font-bold tabular-nums">{value}</span>
    </div>
  );
}

function MerchantTimeline({
  steps,
  copy,
}: {
  steps: TimelineStep[];
  copy: Messages["orderDetail"]["steps"];
}) {
  return (
    <ol aria-label="Order progress" className="flex flex-col">
      {steps.map((step, index) => {
        const Icon = STEP_ICON[step.key];
        const text = copy[step.key];
        const isLast = index === steps.length - 1;
        const time = step.state === "upcoming" ? null : formatTime(step.at);
        return (
          <li key={step.key} className="flex gap-4" aria-current={step.state === "current" ? "step" : undefined}>
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "relative flex size-10 shrink-0 items-center justify-center rounded-full border-2",
                  step.state === "done" && "border-emerald-500 bg-emerald-500 text-white",
                  step.state === "current" && "border-sky-500 bg-sky-500 text-white",
                  step.state === "upcoming" && "border-border bg-background text-muted-foreground",
                )}
              >
                {step.state === "current" ? (
                  <span aria-hidden className="absolute inset-0 rounded-full bg-sky-500/30 motion-safe:animate-ping" />
                ) : null}
                {step.state === "done" ? (
                  <Check className="relative size-5" strokeWidth={3} />
                ) : (
                  <Icon className="relative size-5" />
                )}
              </span>
              {isLast ? null : (
                <span
                  aria-hidden
                  className={cn(
                    "my-1 w-0.5 flex-1 rounded-full",
                    steps[index + 1]?.state !== "upcoming" ? "bg-emerald-500" : "bg-border",
                  )}
                />
              )}
            </div>
            <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", isLast ? "pb-0" : "pb-6")}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h3 className={cn("text-sm font-semibold", step.state === "upcoming" && "text-muted-foreground")}>
                  {text.label}
                </h3>
                {time ? (
                  <time dateTime={step.at ?? undefined} className="text-muted-foreground text-xs tabular-nums">
                    {time}
                  </time>
                ) : null}
              </div>
              <p className="text-muted-foreground text-sm leading-snug">{text[step.state]}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function MerchantOrderDetail({ view }: { view: MerchantOrderView }) {
  const { m, dir } = useLocale();
  const copy = m.orderDetail;
  const [editing, setEditing] = useState(false);

  if (view.status === "missing") {
    return <Notice title={copy.missingTitle} body={copy.missingBody} />;
  }
  if (view.status === "error") {
    return <Notice title={copy.errorTitle} body={copy.errorBody} alert />;
  }

  const { order, steps } = view;
  const headline = copy.status[order.status];
  const kind = shipmentKind(order);
  const collect =
    order.paymentType === "cod" ? formatMoney(order.productPrice) : copy.paid;
  const customerPhone = phoneHref(order.phone);
  const secondaryPhone = phoneHref(order.secondaryPhone);

  return (
    <div className="flex flex-col gap-6">
      <BackLink label={copy.back} dir={dir} />

      <Card className="overflow-hidden py-0">
        <div className={cn("h-1.5", BAR[order.status])} />
        <CardHeader className="px-6 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-muted-foreground text-xs font-medium">{copy.tracking}</span>
              <CardTitle dir="ltr" className="w-fit font-mono text-2xl tracking-tight">
                {order.trackingCode}
              </CardTitle>
              <p className="text-muted-foreground text-sm">
                {copy.kinds[kind]}
                {" · "}
                <time dateTime={order.createdAt}>{order.createdLabel}</time>
              </p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <OrderQuickActions
                orderId={order.id}
                trackingCode={order.trackingCode}
                status={order.status}
                prominent
                onEdit={() => setEditing(true)}
              />
              <Badge variant="outline" className={cn("h-7 px-3 text-sm", orderStatusClass(order.status))}>
                {headline.title}
              </Badge>
            </div>
          </div>
          <p className="text-lg font-medium">{headline.detail}</p>
        </CardHeader>
        <CardContent className="grid gap-3 px-6 pb-6 sm:grid-cols-3">
          <Metric label={copy.productPrice} value={formatMoney(order.productPrice)} />
          <Metric label={copy.deliveryFee} value={formatMoney(order.deliveryFee)} />
          <Metric label={copy.collect} value={collect} />
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="text-brand size-5" />
                {copy.customerTitle}
              </CardTitle>
              <CardDescription>{copy.customerHint}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-8 sm:grid-cols-2 [&>div]:border-b [&>div]:border-border/80">
                <Fact label={copy.name} value={order.customerName || copy.unnamed} />
                <Fact
                  label={copy.phone}
                  value={order.phone || copy.empty}
                  ltr
                  href={customerPhone}
                />
                {order.secondaryPhone ? (
                  <Fact label={copy.secondaryPhone} value={order.secondaryPhone} ltr href={secondaryPhone} />
                ) : null}
                <Fact label={copy.address} value={order.dropoffAddress || copy.empty} />
                {order.extras?.buildingName ? (
                  <Fact label="اسم/رقم المبنى" value={order.extras.buildingName} />
                ) : null}
                {order.extras?.floorNumber ? (
                  <Fact label="رقم الدور" value={order.extras.floorNumber} />
                ) : null}
                {order.extras?.apartmentNumber ? (
                  <Fact label="رقم الشقة" value={order.extras.apartmentNumber} />
                ) : null}
                {order.extras?.landmark ? (
                  <Fact label="علامة مميزة" value={order.extras.landmark} />
                ) : null}
                {order.extras?.isWorkAddress ? <Fact label="نوع العنوان" value="عنوان عمل" /> : null}
                {order.dropoffMapUrl ? (
                  <Fact label={copy.map} value={copy.map} href={order.dropoffMapUrl} />
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="text-brand size-5" />
                {copy.productTitle}
              </CardTitle>
              <CardDescription>{copy.productHint}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-8 sm:grid-cols-2 [&>div]:border-b [&>div]:border-border/80">
                <Fact label={copy.shipment} value={copy.kinds[kind]} />
                <Fact
                  label={copy.payment}
                  value={order.paymentType === "cod" ? copy.cod : copy.prepaid}
                />
                <Fact label={copy.productPrice} value={formatMoney(order.productPrice)} />
                <Fact label={copy.deliveryFee} value={formatMoney(order.deliveryFee)} />
                <Fact label={copy.pickup} value={order.pickupAddress || copy.empty} />
                {order.pickupMapUrl ? (
                  <Fact label={copy.pickupMap} value={copy.pickupMap} href={order.pickupMapUrl} />
                ) : null}
                {order.newItemNote ? <Fact label={copy.newItem} value={order.newItemNote} /> : null}
                {order.returnItemNote ? (
                  <Fact label={copy.returnItem} value={order.returnItemNote} />
                ) : null}
                {order.originalTracking ? (
                  <Fact label={copy.originalTracking} value={order.originalTracking} ltr />
                ) : null}
                {order.extras ? (
                  <Fact label="حجم الشحنة" value={PARCEL_SIZE_AR[order.extras.parcelSize]} />
                ) : null}
                {order.extras ? (
                  <Fact label="عدد القطع" value={String(order.extras.piecesCount)} />
                ) : null}
                {order.extras?.productDescription ? (
                  <Fact label="وصف المنتج" value={order.extras.productDescription} />
                ) : null}
                {order.extras ? (
                  <Fact label="فتح الشحنة" value={order.extras.allowOpening ? "نعم" : "لا"} />
                ) : null}
                {order.extras?.deliveryNotes ? (
                  <Fact label="ملحوظات التوصيل" value={order.extras.deliveryNotes} />
                ) : null}
                {order.extras?.internalNotes ? (
                  <Fact label="ملاحظات داخلية" value={order.extras.internalNotes} />
                ) : null}
              </dl>
              {order.extras?.productImageUrl ? (
                <a href={order.extras.productImageUrl} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={order.extras.productImageUrl}
                    alt="صورة المنتج"
                    className="mt-4 h-32 w-32 rounded-xl border object-cover"
                  />
                </a>
              ) : null}
              <Link
                href={`/track/${encodeURIComponent(order.trackingCode)}`}
                className="text-brand mt-4 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
              >
                <ExternalLink className="size-4" />
                {copy.trackPage}
              </Link>
            </CardContent>
          </Card>

          {order.extras?.attempt ? (
            <AttemptProofCard attempt={order.extras.attempt} partial={order.extras.partial} />
          ) : null}
        </div>

        <Card className="lg:sticky lg:top-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="text-brand size-5" />
              {copy.timelineTitle}
            </CardTitle>
            <CardDescription>{copy.timelineHint}</CardDescription>
          </CardHeader>
          <CardContent>
            <MerchantTimeline steps={steps} copy={copy.steps} />
          </CardContent>
        </Card>
      </div>

      <MerchantOrderEditDialog
        order={editing ? toEditable(order) : null}
        open={editing}
        onOpenChange={setEditing}
      />
    </div>
  );
}

function toEditable(order: MerchantOrderDetail): EditableMerchantOrder {
  return {
    id: order.id,
    trackingCode: order.trackingCode,
    phone: order.phone,
    secondaryPhone: order.secondaryPhone,
    dropoffAddress: order.dropoffAddress,
    piecesCount: order.extras?.piecesCount ?? 1,
    productPrice: order.productPrice,
    paymentType: order.paymentType,
  };
}
