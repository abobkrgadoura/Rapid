"use client";

import { useState } from "react";
import { MapPin, ShieldAlert, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format-money";
import {
  EXCEPTION_REASON_AR,
  type AttemptProof,
  type PartialDelivery,
} from "@/lib/orders/shipment-details";
import { cn } from "@/lib/utils";

const timeFormat = new Intl.DateTimeFormat("ar-SD-u-nu-latn", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Africa/Khartoum",
});

function formatAttempt(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : timeFormat.format(date);
}

function ProofShot({
  label,
  src,
  open,
  onOpen,
}: {
  label: string;
  src: string | null;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-xs font-medium">{label}</figcaption>
      {src ? (
        <button
          type="button"
          onClick={onOpen}
          className="overflow-hidden rounded-xl border bg-white text-start"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={label} className={cn("w-full object-cover", open ? "max-h-96" : "h-28")} />
        </button>
      ) : (
        <div className="text-muted-foreground flex h-28 items-center justify-center rounded-xl border border-dashed text-xs">
          لم تُرفق
        </div>
      )}
    </figure>
  );
}

export function AttemptProofCard({
  attempt,
  partial,
}: {
  attempt: AttemptProof;
  partial: PartialDelivery | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const when = formatAttempt(attempt.lastAttemptAt);
  const reason = attempt.reason ? EXCEPTION_REASON_AR[attempt.reason] : "محاولة توصيل";

  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle>توثيق محاولة التوصيل وإثبات التواصل</CardTitle>
        <CardDescription>Driver Proof of Attempt</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-950">
            {reason}
          </Badge>
          {when ? (
            <time dateTime={attempt.lastAttemptAt ?? undefined} className="text-muted-foreground text-xs tabular-nums">
              {when}
            </time>
          ) : null}
          <span className="text-muted-foreground text-xs">
            {attempt.failedAttempts} {attempt.failedAttempts === 1 ? "محاولة" : "محاولات"}
          </span>
        </div>

        <div
          className={cn(
            "flex items-start gap-2 rounded-xl border px-3 py-2 text-sm",
            attempt.gpsVerified
              ? "border-emerald-300 bg-emerald-50 text-emerald-950"
              : "border-border bg-muted/40",
          )}
        >
          {attempt.gpsVerified ? (
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          ) : (
            <MapPin className="mt-0.5 size-4 shrink-0" />
          )}
          <p>
            {attempt.gpsVerified ? "موثق جغرافياً عبر GPS" : "غير موثق جغرافياً"}
            {attempt.distanceMeters !== null ? (
              <span className="tabular-nums"> · {attempt.distanceMeters} م</span>
            ) : null}
          </p>
        </div>

        {attempt.suspicious ? (
          <p className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-950">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            سُجّلت عدة محاولات خلال أقل من دقيقة. راجع الإثبات قبل اعتماد المحاولة.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <ProofShot
            label="لقطة شاشة محادثة الواتساب مع العميل"
            src={attempt.whatsappProofUrl}
            open={open === "whatsapp"}
            onOpen={() => setOpen((current) => (current === "whatsapp" ? null : "whatsapp"))}
          />
          <ProofShot
            label="لقطة شاشة سجل المكالمات"
            src={attempt.callLogProofUrl}
            open={open === "call"}
            onOpen={() => setOpen((current) => (current === "call" ? null : "call"))}
          />
          <ProofShot
            label="صورة الموقع / باب العميل"
            src={attempt.doorPhotoProofUrl}
            open={open === "door"}
            onOpen={() => setOpen((current) => (current === "door" ? null : "door"))}
          />
        </div>

        {partial ? (
          <dl className="grid gap-3 rounded-xl border px-4 py-3 sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-xs">قطع سُلّمت</dt>
              <dd className="font-semibold tabular-nums">{partial.deliveredPieces ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">قطع مرتجعة</dt>
              <dd className="font-semibold tabular-nums">{partial.returnedPieces ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">المحصّل جزئيًا</dt>
              <dd className="font-semibold tabular-nums">
                {partial.collectedAmount ? formatMoney(partial.collectedAmount) : "—"}
              </dd>
            </div>
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}
