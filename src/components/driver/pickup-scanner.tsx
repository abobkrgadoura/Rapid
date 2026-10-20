"use client";

import {
  CheckCircle2,
  Loader2,
  PackageCheck,
  QrCode,
  TriangleAlert,
  X,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { confirmBatchPickup, scanPickupParcel } from "@/actions/hub";
import { usePickupFeedback } from "@/components/driver/driver-tabs";
import { useDriverPrefs } from "@/components/driver/preferences";
import { QrMark } from "@/components/driver/qr-mark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { playDriverAlert } from "@/lib/driver/alerts";
import { HUB_ERROR_MESSAGES, type HubErrorCode } from "@/lib/hub/types";
import { formatMoney } from "@/lib/format-money";
import { TIME_ZONE } from "@/lib/locale/sudan";
import { normalizeTrackingCode } from "@/lib/orders/tracking";

type Busy = null | "scan" | "confirm";

const clock = new Intl.DateTimeFormat("ar-SD-u-nu-latn", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function PickupScanner({
  merchantId,
  companyName,
  pendingCount,
  pickupFee,
}: {
  merchantId: string;
  companyName: string;
  pendingCount: number;
  pickupFee: string | null;
}) {
  const reportPickup = usePickupFeedback();
  const { t, prefs } = useDriverPrefs();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [input, setInput] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const [doneAt, setDoneAt] = useState<string | null>(null);
  const [continuous, setContinuous] = useState(false);
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function openScanner() {
    setBusy(null);
    setInput("");
    setCodes([]);
    setError(null);
    setDoneCount(null);
    setDoneAt(null);
    inFlight.current = false;
    setOpen(true);
  }

  function onOpenChange(next: boolean) {
    if (!next && inFlight.current) return;
    if (!next) setOpen(false);
  }

  function describe(code: HubErrorCode): string {
    return HUB_ERROR_MESSAGES[code];
  }

  function beep() {
    if (continuous || prefs.highAlert) playDriverAlert();
  }

  async function submitScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    const code = normalizeTrackingCode(input);
    if (code === null) {
      setError(HUB_ERROR_MESSAGES.invalid_code);
      return;
    }
    if (codes.includes(code)) {
      setInput("");
      setError(`${code} · ${t.scannedOf}`);
      inputRef.current?.focus();
      return;
    }

    inFlight.current = true;
    setBusy("scan");
    setError(null);
    try {
      const result = await scanPickupParcel(merchantId, code);
      if (!result.ok) {
        setError(describe(result.error));
        return;
      }
      setCodes((current) =>
        current.includes(result.trackingCode) ? current : [...current, result.trackingCode],
      );
      setInput("");
      beep();
    } catch {
      setError(HUB_ERROR_MESSAGES.failed);
    } finally {
      inFlight.current = false;
      setBusy(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function confirm() {
    if (inFlight.current || codes.length === 0) return;

    inFlight.current = true;
    setBusy("confirm");
    setError(null);
    try {
      const result = await confirmBatchPickup(codes);
      if (!result.ok) {
        setError(describe(result.error));
        return;
      }
      reportPickup({ companyName, count: result.count });
      setDoneCount(result.count);
      setDoneAt(new Date().toISOString());
      beep();
    } catch {
      setError(HUB_ERROR_MESSAGES.failed);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const working = busy !== null;
  const total = Math.max(pendingCount, codes.length);
  const feeLabel =
    pickupFee === null ? t.feePending : pickupFee === "0.00" ? t.feeWaived : formatMoney(pickupFee);
  const receipt =
    doneCount !== null && doneAt
      ? `RAPID|${merchantId}|${doneCount}|${doneAt}|${pickupFee ?? "pending"}`
      : "";

  return (
    <>
      <Button
        type="button"
        onClick={openScanner}
        className="h-14 w-full gap-2 rounded-2xl text-base font-semibold"
      >
        <QrCode className="size-5" />
        {t.scanPickup}
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-busy={working}>
          {doneCount === null ? (
            <div className="flex flex-col gap-5">
              <DialogHeader>
                <DialogTitle>
                  {t.pickups} · {companyName}
                </DialogTitle>
                <DialogDescription>
                  {t.scannedOf} {codes.length} {t.of} {total} {t.parcel}
                </DialogDescription>
              </DialogHeader>

              <label className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
                <span className="text-sm font-semibold">{t.continuous}</span>
                <input
                  type="checkbox"
                  checked={continuous}
                  onChange={(event) => setContinuous(event.target.checked)}
                  className="size-5"
                />
              </label>

              <div
                className="bg-muted flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
                aria-live="polite"
              >
                <span className="text-sm font-medium">{t.scannedOf}</span>
                <span className="text-2xl font-semibold tabular-nums">
                  {codes.length} {t.of} {total}
                </span>
              </div>

              <form onSubmit={submitScan} className="flex flex-col gap-3" noValidate>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium">{t.tracking}</span>
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(event) => {
                      setInput(event.target.value);
                      if (error) setError(null);
                    }}
                    disabled={working}
                    autoFocus
                    inputMode="text"
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="go"
                    placeholder="RP1A2B3C4D5E"
                    aria-invalid={error ? true : undefined}
                    className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-16 w-full rounded-2xl border px-4 text-center font-mono text-xl tracking-wider uppercase outline-none focus-visible:ring-3 disabled:opacity-50"
                  />
                </label>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={working || input.trim().length === 0}
                  className="h-12 w-full rounded-2xl text-base"
                >
                  {busy === "scan" ? <Loader2 className="size-5 animate-spin" /> : t.addParcel}
                </Button>
              </form>

              {error ? (
                <p role="alert" className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  {error}
                </p>
              ) : null}

              {codes.length > 0 ? (
                <ul className="divide-border flex max-h-40 flex-col divide-y overflow-y-auto rounded-2xl border">
                  {codes.map((code) => (
                    <li key={code} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="font-mono text-sm font-semibold">{code}</span>
                      <button
                        type="button"
                        onClick={() => setCodes((current) => current.filter((item) => item !== code))}
                        disabled={working}
                        aria-label={code}
                        className="flex size-9 items-center justify-center rounded-xl"
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <Button
                type="button"
                onClick={confirm}
                disabled={working || codes.length === 0}
                className="h-14 w-full gap-2 rounded-2xl text-base font-semibold"
              >
                {busy === "confirm" ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <PackageCheck className="size-5" />
                )}
                {t.confirmPickup}
                {codes.length > 0 ? ` (${codes.length})` : ""}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 text-center">
              <CheckCircle2 className="size-12 text-emerald-600" />
              <DialogHeader className="items-center">
                <DialogTitle>{t.handoverTitle}</DialogTitle>
                <DialogDescription>{t.handoverHint}</DialogDescription>
              </DialogHeader>
              <QrMark value={receipt} label={t.handoverTitle} />
              <dl className="bg-muted w-full rounded-2xl px-4 py-3 text-start text-sm">
                <div className="flex justify-between gap-3 py-1">
                  <dt className="text-muted-foreground">{t.merchant}</dt>
                  <dd className="font-semibold">{companyName}</dd>
                </div>
                <div className="flex justify-between gap-3 py-1">
                  <dt className="text-muted-foreground">{t.scannedCount}</dt>
                  <dd className="font-semibold tabular-nums">{doneCount}</dd>
                </div>
                <div className="flex justify-between gap-3 py-1">
                  <dt className="text-muted-foreground">{t.time}</dt>
                  <dd className="font-semibold tabular-nums">
                    {doneAt ? clock.format(new Date(doneAt)) : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 py-1">
                  <dt className="text-muted-foreground">{t.pickupFee}</dt>
                  <dd className="font-semibold">{feeLabel}</dd>
                </div>
              </dl>
              <Button type="button" onClick={() => setOpen(false)} className="h-12 w-full rounded-2xl">
                {t.done}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
