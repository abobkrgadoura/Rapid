"use client";

import {
  Loader2,
  MapPinned,
  MessageCircle,
  Navigation,
  PackageCheck,
  Phone,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { reportDeliveryException } from "@/actions/driver-pro";
import { confirmDelivery } from "@/actions/delivery";
import { useDriverPrefs } from "@/components/driver/preferences";
import { PaymentBadge } from "@/components/orders/payment-badge";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ATTEMPT_FENCE_METERS, distanceMeters } from "@/lib/driver/geo";
import { navigationHref } from "@/lib/driver/navigation";
import { compressProofImage } from "@/lib/driver/proof-image";
import { deliveryWhatsAppMessage, whatsAppHref } from "@/lib/driver/whatsapp";
import { DELIVERY_ERROR_MESSAGES } from "@/lib/delivery/types";
import { formatMoney } from "@/lib/format-money";
import { readCurrentPosition } from "@/lib/geo/current-position";
import type { DriverStop } from "@/lib/data/driver-dashboard";
import type { GeoPoint } from "@/lib/math";
import { formatCents, parseNonNegativeMoneyCents } from "@/lib/money";
import { EXCEPTION_REASONS, type ExceptionReason } from "@/lib/orders/shipment-details";
import { DELIVERY_OTP_LENGTH, isDeliveryOtp } from "@/lib/otp-format";
import { cn } from "@/lib/utils";

function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

const linkButton = cn(
  buttonVariants({ variant: "outline" }),
  "h-12 flex-1 gap-2 rounded-2xl text-base",
);

type SortMode = "nearest" | "zone" | "cod";

function codCents(stop: DriverStop): bigint {
  if (stop.paymentType !== "cod") return BigInt(0);
  return parseNonNegativeMoneyCents(stop.productPrice) ?? BigInt(0);
}

export function DeliveryBoard({
  stops,
  currency,
}: {
  stops: DriverStop[];
  currency: string;
}) {
  const { t } = useDriverPrefs();
  const [mode, setMode] = useState<SortMode>("zone");
  const [here, setHere] = useState<GeoPoint | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);

  async function sortNearest() {
    setMode("nearest");
    setLocating(true);
    setLocationNote(null);
    const position = await readCurrentPosition();
    setLocating(false);
    if (!position.ok) {
      setLocationNote(t.locationFailed);
      setMode("zone");
      return;
    }
    setHere(position.fix);
  }

  const ordered = useMemo(() => {
    const copy = [...stops];
    if (mode === "cod") {
      copy.sort((left, right) => (codCents(right) > codCents(left) ? 1 : -1));
      return copy;
    }
    if (mode === "nearest" && here) {
      copy.sort((left, right) => {
        const leftDistance = left.point ? distanceMeters(here, left.point) : Number.POSITIVE_INFINITY;
        const rightDistance = right.point ? distanceMeters(here, right.point) : Number.POSITIVE_INFINITY;
        return leftDistance - rightDistance;
      });
      return copy;
    }
    copy.sort((left, right) => left.zone.localeCompare(right.zone, "ar"));
    return copy;
  }, [stops, mode, here]);

  const sorts: Array<{ id: SortMode; label: string; onClick: () => void }> = [
    { id: "nearest", label: t.sortNearest, onClick: () => void sortNearest() },
    { id: "zone", label: t.sortZone, onClick: () => setMode("zone") },
    { id: "cod", label: t.sortCod, onClick: () => setMode("cod") },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={t.sortLabel} className="flex gap-2 overflow-x-auto pb-1">
        {sorts.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={mode === item.id}
            onClick={item.onClick}
            className={cn(
              "pointer-events-auto h-11 min-h-11 shrink-0 cursor-pointer touch-manipulation rounded-full border px-3 text-xs font-semibold",
              mode === item.id ? "border-brand bg-brand text-brand-foreground" : "bg-card",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {locating ? <p className="text-muted-foreground text-xs">{t.locating}</p> : null}
      {locationNote ? <p className="text-xs text-amber-700">{locationNote}</p> : null}
      {ordered.map((stop) => (
        <DeliveryCard key={stop.id} stop={stop} currency={currency} />
      ))}
    </div>
  );
}

function DeliveryCard({ stop, currency }: { stop: DriverStop; currency: string }) {
  const { t, prefs } = useDriverPrefs();
  const isCod = stop.paymentType === "cod";
  const amountLabel = isCod ? formatMoney(stop.productPrice, currency).replace(" ج.س", "") : "0";
  const whatsApp = stop.phone
    ? whatsAppHref(
        stop.phone,
        deliveryWhatsAppMessage({
          customerName: stop.customerName,
          trackingCode: stop.trackingCode,
          merchantName: stop.merchantName,
          amountLabel,
        }),
      )
    : null;
  const maps = navigationHref(prefs.navApp, {
    gpsUrl: stop.dropoffGpsUrl,
    address: stop.dropoffAddress,
    point: stop.point,
  });

  return (
    <article className="bg-card flex flex-col gap-4 rounded-3xl border p-4 shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold">{stop.trackingCode}</p>
          <p className="truncate text-lg leading-snug font-semibold">
            {stop.customerName || "—"}
          </p>
          <p className="text-muted-foreground text-xs">{stop.merchantName}</p>
        </div>
        <OrderStatusBadge status={stop.status} />
      </header>

      <div className="flex items-start gap-3">
        <MapPinned className="text-muted-foreground mt-0.5 size-5 shrink-0" />
        <div className="min-w-0">
          <p className="text-base leading-snug whitespace-pre-line">
            {stop.dropoffAddress || "—"}
          </p>
          <p className="text-muted-foreground text-xs">{stop.zone}</p>
          {stop.landmark ? <p className="text-sm">{stop.landmark}</p> : null}
        </div>
      </div>

      <div className="bg-muted flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <PaymentBadge paymentType={stop.paymentType} />
        <span className="text-end text-sm font-semibold tabular-nums">
          {isCod ? `${t.collect} ${formatMoney(stop.productPrice, currency)}` : t.paid}
          {stop.piecesCount > 1 ? ` · ${stop.piecesCount} ${t.pieces}` : ""}
        </span>
      </div>

      <div className="flex gap-2">
        {stop.phone ? (
          <a href={telUrl(stop.phone)} className={linkButton}>
            <Phone className="size-5" />
            {t.call}
          </a>
        ) : null}
        {whatsApp ? (
          <a
            href={whatsApp}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(linkButton, "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700")}
          >
            <MessageCircle className="size-5" />
            {t.whatsApp}
          </a>
        ) : null}
        <a href={maps} target="_blank" rel="noopener noreferrer" className={linkButton}>
          <Navigation className="size-5" />
          {t.navigate}
        </a>
      </div>

      {stop.walletPending ? (
        <p className="rounded-2xl bg-amber-100 px-4 py-3 text-center text-sm text-amber-950 dark:bg-amber-400/15 dark:text-amber-200">
          {t.walletPending}
        </p>
      ) : (
        <p className="text-muted-foreground text-center text-sm">{t.outForDelivery}</p>
      )}

      {stop.status === "in_transit" ? (
        <div className="flex flex-col gap-2">
          <HandoffButton stop={stop} currency={currency} />
          <ExceptionButton stop={stop} />
        </div>
      ) : null}
    </article>
  );
}

function HandoffButton({ stop, currency }: { stop: DriverStop; currency: string }) {
  const { t, alert } = useDriverPrefs();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [otp, setOtp] = useState("");
  const [checked, setChecked] = useState(false);
  const [kept, setKept] = useState(1);
  const [collected, setCollected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const partialAllowed = stop.piecesCount > 1 && !stop.walletPending;
  const returned = Math.max(0, stop.piecesCount - kept);
  const needsOtp = stop.paymentType === "prepaid" && !stop.walletPending;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (needsOtp && !isDeliveryOtp(otp)) {
      setError(DELIVERY_ERROR_MESSAGES.otp_required);
      return;
    }
    if (!needsOtp && mode === "full" && !checked && !stop.walletPending) {
      setError(t.customerCheck);
      return;
    }
    if (mode === "partial") {
      if (kept < 1 || returned < 1) {
        setError(DELIVERY_ERROR_MESSAGES.partial_invalid);
        return;
      }
      const amount = stop.paymentType === "prepaid" ? "0.00" : collected;
      const cents = parseNonNegativeMoneyCents(amount);
      const price = parseNonNegativeMoneyCents(stop.productPrice);
      if (cents === null || (price !== null && stop.paymentType === "cod" && cents > price)) {
        setError(DELIVERY_ERROR_MESSAGES.partial_invalid);
        return;
      }
    }

    setBusy(true);
    try {
      const position = await readCurrentPosition();
      if (!position.ok) {
        setError(DELIVERY_ERROR_MESSAGES.invalid_location);
        return;
      }
      const partial =
        mode === "partial"
          ? {
              deliveredPieces: kept,
              returnedPieces: returned,
              collectedAmount:
                stop.paymentType === "prepaid"
                  ? "0.00"
                  : formatCents(parseNonNegativeMoneyCents(collected) ?? BigInt(0)),
            }
          : null;
      const result = await confirmDelivery({
        trackingCode: stop.trackingCode,
        otp: needsOtp ? otp : null,
        location: position.fix,
        partial,
      });
      if (!result.ok) {
        setError(DELIVERY_ERROR_MESSAGES[result.error]);
        return;
      }
      alert();
      setOpen(false);
      router.refresh();
    } catch {
      setError(DELIVERY_ERROR_MESSAGES.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto relative z-10 h-14 min-h-11 w-full gap-3 rounded-xl bg-[#0F62FF] text-base font-semibold text-white shadow-md hover:bg-[#0F62FF]/90"
      >
        <PackageCheck className="size-6" />
        {t.deliver}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{mode === "partial" ? t.partialDelivery : t.fullDelivery}</DialogTitle>
              <DialogDescription className="font-mono">{stop.trackingCode}</DialogDescription>
            </DialogHeader>
            {partialAllowed ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={mode === "full"}
                  onClick={() => setMode("full")}
                  className={cn(
                    "h-11 rounded-2xl border text-sm font-semibold",
                    mode === "full" ? "bg-brand text-brand-foreground" : "bg-card",
                  )}
                >
                  {t.fullDelivery}
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "partial"}
                  onClick={() => setMode("partial")}
                  className={cn(
                    "h-11 rounded-2xl border text-sm font-semibold",
                    mode === "partial" ? "bg-brand text-brand-foreground" : "bg-card",
                  )}
                >
                  {t.partialDelivery}
                </button>
              </div>
            ) : null}
            {needsOtp ? (
              <label className="flex flex-col gap-2 text-sm font-medium">
                {t.otp}
                <input
                  value={otp}
                  onChange={(event) =>
                    setOtp(event.target.value.replace(/\D/g, "").slice(0, DELIVERY_OTP_LENGTH))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="border-input h-16 rounded-2xl border text-center font-mono text-3xl tracking-[0.4em]"
                />
              </label>
            ) : mode === "full" && !stop.walletPending ? (
              <label className="flex items-start gap-3 rounded-2xl border px-3 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                  className="mt-1 size-4"
                />
                {t.customerCheck}
              </label>
            ) : null}
            {mode === "partial" ? (
              <div className="grid gap-3">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {t.kept}
                  <input
                    type="number"
                    min={1}
                    max={stop.piecesCount - 1}
                    value={kept}
                    onChange={(event) => setKept(Number(event.target.value))}
                    className="border-input h-12 rounded-2xl border px-3 text-lg"
                  />
                </label>
                <p className="text-sm">
                  {t.returning}: <span className="font-semibold tabular-nums">{returned}</span>
                </p>
                {stop.paymentType === "cod" ? (
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {t.collected} ({formatMoney(stop.productPrice, currency)})
                    <input
                      inputMode="decimal"
                      value={collected}
                      onChange={(event) => setCollected(event.target.value)}
                      className="border-input h-12 rounded-2xl border px-3"
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="bg-destructive/10 text-destructive rounded-xl px-3 py-2 text-sm">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy} className="h-12 rounded-2xl">
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {mode === "partial" ? t.confirmPartial : t.confirmFull}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

const REASON_KEY: Record<ExceptionReason, "noAnswer" | "phoneOff" | "postponed" | "refused" | "wrongAddress"> = {
  no_answer: "noAnswer",
  phone_off: "phoneOff",
  postponed: "postponed",
  refused: "refused",
  wrong_address: "wrongAddress",
};

function needsProof(reason: ExceptionReason) {
  return {
    whatsapp: reason === "no_answer" || reason === "postponed" || reason === "refused",
    call: reason === "no_answer" || reason === "phone_off",
    door: reason === "wrong_address" || reason === "refused",
  };
}

function ExceptionButton({ stop }: { stop: DriverStop }) {
  const { t, alert } = useDriverPrefs();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ExceptionReason>("no_answer");
  const [gps, setGps] = useState<GeoPoint | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [callLog, setCallLog] = useState<string | null>(null);
  const [door, setDoor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const meters = gps && stop.point ? distanceMeters(gps, stop.point) : null;
  const required = needsProof(reason);

  async function captureGps() {
    setGps(null);
    setGpsError(null);
    const position = await readCurrentPosition();
    if (!position.ok) {
      setGpsError(t.gpsWaiting);
      return;
    }
    setGps(position.fix);
  }

  function openSheet() {
    setError(null);
    setDone(null);
    setOpen(true);
    void captureGps();
  }

  async function onFile(
    file: File | undefined,
    set: (value: string | null) => void,
  ) {
    if (!file) return;
    const compressed = await compressProofImage(file);
    set(compressed);
    if (!compressed) setError(t.saveFailed);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!gps) {
      setError(t.gpsWaiting);
      return;
    }
    if ((required.whatsapp && !whatsapp) || (required.call && !callLog) || (required.door && !door)) {
      setError(DELIVERY_ERROR_MESSAGES.failed);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await reportDeliveryException({
        orderId: stop.id,
        reason,
        latitude: gps.latitude,
        longitude: gps.longitude,
        whatsappProof: whatsapp,
        callLogProof: callLog,
        doorProof: door,
      });
      if (!result.ok) {
        setError(result.error === "proof" ? t.whatsAppProof : t.saveFailed);
        return;
      }
      alert();
      setDone(result.suspicious ? `${t.exceptionSent} ${t.suspicious}` : t.exceptionSent);
      router.refresh();
    } catch {
      setError(t.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        onClick={openSheet}
        className="h-12 w-full rounded-2xl"
      >
        <ShieldAlert className="size-4" />
        {t.exception}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t.exception}</DialogTitle>
              <DialogDescription className="font-mono">{stop.trackingCode}</DialogDescription>
            </DialogHeader>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-semibold">{t.reason}</legend>
              {EXCEPTION_REASONS.map((item) => (
                <label key={item} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name="reason"
                    checked={reason === item}
                    onChange={() => setReason(item)}
                  />
                  {t[REASON_KEY[item]]}
                </label>
              ))}
            </fieldset>

            <div
              className={cn(
                "flex items-start gap-2 rounded-2xl border px-3 py-3 text-sm",
                gps ? "border-emerald-600 bg-emerald-50 text-emerald-950 dark:bg-emerald-400/10 dark:text-emerald-100" : "bg-muted",
              )}
            >
              {gps ? <MapPinned className="mt-0.5 size-4 shrink-0" /> : <Loader2 className="mt-0.5 size-4 animate-spin" />}
              <div>
                <p>{gps ? t.gpsOk : gpsError ?? t.gpsWaiting}</p>
                {meters !== null ? (
                  <p className="text-xs tabular-nums">
                    {t.gpsMeters}: {meters} m
                    {meters > ATTEMPT_FENCE_METERS ? ` — ${t.gpsFar}` : ""}
                  </p>
                ) : gps ? (
                  <p className="text-xs">{t.gpsMissing}</p>
                ) : null}
              </div>
            </div>

            {required.whatsapp ? (
              <ProofField label={t.whatsAppProof} src={whatsapp} onFile={(file) => onFile(file, setWhatsapp)} />
            ) : null}
            {required.call ? (
              <ProofField label={t.callProof} src={callLog} onFile={(file) => onFile(file, setCallLog)} />
            ) : null}
            {required.door ? (
              <ProofField
                label={t.doorProof}
                src={door}
                capture
                onFile={(file) => onFile(file, setDoor)}
              />
            ) : null}

            {error ? (
              <p role="alert" className="text-destructive flex items-start gap-2 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            ) : null}
            {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
            <Button type="submit" disabled={busy || !gps || Boolean(done)} className="h-12 rounded-2xl">
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {t.submitException}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProofField({
  label,
  src,
  capture,
  onFile,
}: {
  label: string;
  src: string | null;
  capture?: boolean;
  onFile: (file: File | undefined) => void;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      <input
        type="file"
        accept="image/*"
        capture={capture ? "environment" : undefined}
        onChange={(event) => onFile(event.target.files?.[0])}
        className="text-xs"
      />
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-28 w-full rounded-xl object-cover" />
      ) : null}
    </label>
  );
}
