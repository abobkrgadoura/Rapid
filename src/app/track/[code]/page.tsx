import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PackageSearch, TriangleAlert } from "lucide-react";

import { AutoRefresh } from "@/components/track/auto-refresh";
import { ShipmentStepper } from "@/components/track/shipment-stepper";
import { buttonVariants } from "@/components/ui/button";
import { loadPublicTracking } from "@/lib/data/tracking";
import { buildPublicTimeline } from "@/lib/orders/public-timeline";
import type { OrderStatus, PaymentType } from "@/lib/orders/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "تتبع الشحنة",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const instant = false;

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "تم إنشاء الطلب",
  assigned: "بانتظار الاستلام",
  picked_up: "تم الاستلام من التاجر",
  at_hub: "في مخزن الفرز",
  in_transit: "خرجت للتوصيل",
  delivered: "تم التسليم",
  returned: "مرتجعة إلى المتجر",
  cancelled: "ملغاة",
};

const STATUS_CLASS: Record<OrderStatus, string> = {
  pending: "bg-amber-100 text-amber-950",
  assigned: "bg-violet-100 text-violet-950",
  picked_up: "bg-blue-100 text-blue-950",
  at_hub: "bg-indigo-100 text-indigo-950",
  in_transit: "bg-sky-100 text-sky-950",
  delivered: "bg-emerald-100 text-emerald-950",
  returned: "bg-orange-100 text-orange-950",
  cancelled: "bg-rose-100 text-rose-950",
};

export default function TrackDetailPage({
  params,
}: PageProps<"/track/[code]">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:py-12">
      <Suspense fallback={<TrackingSkeleton />}>
        <TrackingContent params={params} />
      </Suspense>
    </div>
  );
}

async function TrackingContent({
  params,
}: {
  params: PageProps<"/track/[code]">["params"];
}) {
  const { code } = await params;
  const result = await loadPublicTracking(code);

  if (!result.ok) {
    return result.reason === "error" ? <LoadError /> : <NotFound />;
  }

  const tracking = result.data;
  const steps = buildPublicTimeline(tracking);
  const live =
    tracking.status !== "delivered" &&
    tracking.status !== "cancelled" &&
    tracking.status !== "returned";

  return (
    <article className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/5">
      <div className="bg-ink-950 px-6 py-6 text-white sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-zinc-400">رقم التتبع</p>
            <h1 dir="ltr" className="mt-1 font-mono text-2xl font-semibold tracking-wide sm:text-3xl">
              {tracking.trackingCode}
            </h1>
          </div>
          <span className={cn("rounded-full px-3 py-1 text-xs font-bold", STATUS_CLASS[tracking.status])}>
            {STATUS_LABEL[tracking.status]}
          </span>
        </div>
        <p className="mt-4 text-sm text-zinc-300">
          مُرسلة من: <span className="font-semibold text-white">{tracking.merchantName}</span>
        </p>
      </div>

      <div className="px-6 py-8 sm:px-8">
        {tracking.status === "cancelled" ? (
          <p className="mb-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-950">
            تم إلغاء هذه الشحنة. تواصل مع المتجر لمزيد من التفاصيل.
          </p>
        ) : null}
        {tracking.status === "returned" ? (
          <p className="mb-6 rounded-2xl bg-orange-50 px-4 py-3 text-sm text-orange-950">
            تعذّر تسليم هذه الشحنة وهي في طريقها للعودة إلى المتجر.
          </p>
        ) : null}
        <ShipmentStepper steps={steps} />
      </div>

      <div className="grid gap-px border-t border-zinc-200 bg-zinc-200 sm:grid-cols-2">
        <SummaryCell label="طريقة الدفع">
          <PaymentSummary
            paymentType={tracking.paymentType}
            totalCollectible={tracking.totalCollectible}
          />
        </SummaryCell>
        <SummaryCell label="منطقة التسليم">
          <p className="text-base font-semibold text-neutral-950">{tracking.destinationSummary}</p>
        </SummaryCell>
      </div>

      {live ? (
        <div className="border-t border-zinc-200 px-6 py-4">
          <AutoRefresh />
        </div>
      ) : null}
    </article>
  );
}

function PaymentSummary({
  paymentType,
  totalCollectible,
}: {
  paymentType: PaymentType;
  totalCollectible: string;
}) {
  if (paymentType === "prepaid") {
    return (
      <div>
        <p className="text-base font-semibold text-neutral-950">مدفوع مسبقاً</p>
        <p className="mt-1 text-sm text-zinc-500 tabular-nums">0.00 ج.س</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-base font-semibold text-neutral-950">الدفع عند الاستلام</p>
      <p className="mt-1 text-sm text-zinc-500">
        جهّز <span className="font-semibold text-neutral-950 tabular-nums">{formatCollectible(totalCollectible)}</span>
      </p>
    </div>
  );
}

function formatCollectible(canonical: string): string {
  const negative = canonical.startsWith("-");
  const absolute = negative ? canonical.slice(1) : canonical;
  const [whole, fraction = "00"] = absolute.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}${grouped}.${fraction} ج.س`;
}

function SummaryCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-50 px-6 py-5 sm:px-8">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="rounded-3xl border border-zinc-200 bg-white px-6 py-14 text-center shadow-sm">
      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
        <PackageSearch className="size-7" />
      </div>
      <h1 className="text-2xl font-bold text-neutral-950">لم نعثر على هذه الشحنة</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
        تحقق من رقم التتبع على البوليصة أو في رسالة المتجر، ثم حاول مرة أخرى.
      </p>
      <Link href="/track" className={cn(buttonVariants({ variant: "brand" }), "mt-6 h-12 rounded-2xl px-6 text-base font-bold")}>
        جرّب رقمًا آخر
      </Link>
    </div>
  );
}

function LoadError() {
  return (
    <div className="rounded-3xl border border-zinc-200 bg-white px-6 py-14 text-center shadow-sm">
      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-900">
        <TriangleAlert className="size-7" />
      </div>
      <h1 className="text-2xl font-bold text-neutral-950">التتبع غير متاح الآن</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
        الشحنة نفسها لم تتأثر. أعد تحميل الصفحة بعد لحظات.
      </p>
      <Link href="/track" className={cn(buttonVariants({ variant: "outline" }), "mt-6 h-12 rounded-2xl px-6")}>
        العودة للبحث
      </Link>
    </div>
  );
}

function TrackingSkeleton() {
  return (
    <div role="status" aria-label="جارٍ تحميل الشحنة" className="flex flex-col gap-4">
      <div className="h-40 animate-pulse rounded-3xl bg-zinc-200" />
      <div className="h-72 animate-pulse rounded-3xl bg-zinc-200" />
    </div>
  );
}
