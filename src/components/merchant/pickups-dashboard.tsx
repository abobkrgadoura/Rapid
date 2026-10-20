"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { create as createQrCode } from "qrcode";
import { Check, Loader2, PackageCheck, QrCode, Truck } from "lucide-react";

import { requestMerchantPickup, verifyHandoverQr } from "@/actions/pickups";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toastError, toastSuccess } from "@/components/ui/toast";
import type { MerchantPickupsView } from "@/lib/data/merchant-pickups";
import { formatMoney } from "@/lib/format-money";
import { cn } from "@/lib/utils";

const QR_QUIET = 2;

function HandoverQr({ token }: { token: string }) {
  const qr = createQrCode(token, { errorCorrectionLevel: "M" });
  let path = "";
  const size = qr.modules.size;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.modules.get(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  const span = size + QR_QUIET * 2;
  return (
    <svg
      viewBox={`${-QR_QUIET} ${-QR_QUIET} ${span} ${span}`}
      role="img"
      aria-label={token}
      shapeRendering="crispEdges"
      className="size-44 bg-white text-black"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Truck;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2">
          <Icon className="text-brand size-4" />
          {label}
        </CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export function PickupsDashboard({ view }: { view: MerchantPickupsView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const active = view.openRequest;

  function requestPickup() {
    startTransition(async () => {
      const result = await requestMerchantPickup();
      if (!result.ok) {
        const message =
          result.error === "empty"
            ? "لا توجد شحنات بانتظار الاستلام."
            : result.error === "unavailable"
              ? "طلب الاستلام يحتاج تهجير قاعدة البيانات 0010."
              : "تعذر طلب مندوب الاستلام. حاول مرة أخرى.";
        toastError("تعذر الطلب", message);
        return;
      }
      toastSuccess("تم طلب مندوب الاستلام", `${result.count} شحنات في هذه الدفعة`);
      setOpen(true);
      router.refresh();
    });
  }

  function confirm(code: string) {
    startTransition(async () => {
      const result = await verifyHandoverQr(code);
      if (!result.ok) {
        toastError(
          "لم يُقبل الرمز",
          result.error === "mismatch"
            ? "رمز التسليم لا يطابق إيصال هذه الدفعة."
            : "تعذر تأكيد التسليم. حاول مرة أخرى.",
        );
        return;
      }
      toastSuccess("تم تأكيد تسليم الشحنات للمندوب", result.token);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">الاستلامات</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          اطلب مندوب استلام لشحناتك الجاهزة، ثم أكّد التسليم بإيصال QR.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Kpi label="شحنات جاهزة للاستلام" value={view.readyCount} icon={Truck} />
        <Kpi label="تم استلامها اليوم" value={view.pickedUpToday} icon={PackageCheck} />
      </div>

      <div
        className={cn(
          "rounded-2xl border px-5 py-4 text-sm leading-relaxed",
          view.readyCount === 0 && !view.openRequest
            ? "border-border bg-muted/40"
            : view.feeApplies
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : "border-emerald-300 bg-emerald-50 text-emerald-950",
        )}
      >
        {view.readyCount === 0 && !view.openRequest ? (
          <p>
            لا توجد شحنات جاهزة. رسوم الاستلام تُحتسب عندما تقل الدفعة عن {view.freeFrom} شحنات
            ({formatMoney(`${view.feeSdg}.00`)}
            )، وتكون مجانية من {view.freeFrom} شحنات.
          </p>
        ) : view.feeApplies ? (
          <p>
            دفعة الاستلام الحالية أقل من {view.freeFrom} شحنات، لذلك تُحتسب رسوم استلام{" "}
            <strong className="tabular-nums">{formatMoney(view.batchFee)}</strong>.
          </p>
        ) : (
          <p>
            دفعة الاستلام الحالية {view.openRequest?.count ?? view.readyCount} شحنات (من{" "}
            {view.freeFrom} فأكثر)، لذلك الاستلام <strong>مجاني</strong>.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="brand"
          size="lg"
          className="h-11 font-bold"
          disabled={pending || (view.readyCount === 0 && !active)}
          onClick={requestPickup}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Truck />}
          طلب مندوب استلام
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-11 font-bold"
          disabled={!active}
          onClick={() => {
            setToken(active?.token ?? "");
            setOpen(true);
          }}
        >
          <QrCode />
          تأكيد تسليم الشحنات للمندوب (QR)
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>شحنات بانتظار الاستلام</CardTitle>
          <CardDescription>
            {view.pending.length === 0
              ? "لا توجد شحنات معلّقة."
              : "هذه الشحنات تدخل في طلب الاستلام."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {view.pending.length === 0 ? null : (
            <ul className="divide-y">
              {view.pending.map((parcel) => (
                <li key={parcel.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="text-sm font-medium">{parcel.customerName || "بدون اسم"}</span>
                  <span dir="ltr" className="font-mono text-xs font-semibold">
                    {parcel.trackingCode}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تأكيد تسليم الشحنات للمندوب</DialogTitle>
            <DialogDescription>
              أظهر رمز QR لمندوب الاستلام، أو اكتب الرمز الذي يظهر على إيصاله.
            </DialogDescription>
          </DialogHeader>
          {active ? (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-2xl border bg-white p-3">
                <HandoverQr token={active.token} />
              </div>
              <p dir="ltr" className="font-mono text-sm font-bold tracking-[0.2em]">
                {active.token}
              </p>
              <p className="text-muted-foreground text-center text-xs">
                {active.count} شحنات
                {active.verified ? " · تم التأكيد" : ""}
              </p>
              <form
                className="flex w-full flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  confirm(token || active.token);
                }}
              >
                <Input
                  dir="ltr"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={active.token}
                  aria-label="رمز تسليم المندوب"
                  className="h-11 text-center font-mono tracking-widest"
                  autoComplete="off"
                />
                <Button type="submit" variant="brand" className="h-11 font-bold" disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" /> : <Check />}
                  تأكيد التسليم
                </Button>
              </form>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">اطلب مندوب الاستلام أولًا ليظهر رمز التسليم.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
