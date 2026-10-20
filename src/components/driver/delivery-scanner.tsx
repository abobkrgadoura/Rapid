"use client";

import {
  CheckCircle2,
  Loader2,
  MapPin,
  QrCode,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { confirmDelivery, lookupDeliveryOrder } from "@/actions/delivery";
import { useDriverPrefs } from "@/components/driver/preferences";
import { PaymentBadge } from "@/components/orders/payment-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DELIVERY_ERROR_MESSAGES,
  type ConfirmDeliveryResult,
  type DeliveryErrorCode,
  type DeliveryOrder,
} from "@/lib/delivery/types";
import { formatMoney } from "@/lib/format-money";
import {
  POSITION_FAILURE_MESSAGES,
  readCurrentPosition,
} from "@/lib/geo/current-position";
import { normalizeTrackingCode } from "@/lib/orders/tracking";
import { DELIVERY_OTP_LENGTH, isDeliveryOtp } from "@/lib/otp-format";

/**
 * Delivery flow, simulated scanner edition.
 *
 *   1. Type the tracking code (stands in for reading the parcel's QR).
 *   2. We look the order up. Prepaid orders ask for the customer's 4-digit
 *      code; COD orders go straight to confirmation.
 *   3. On confirm we read a fresh GPS fix, then call confirmDelivery, which
 *      verifies the OTP, marks the order delivered, and posts the wallet
 *      entry (COD debit or prepaid credit) in that order.
 *
 * Swapping in a real camera later only replaces step 1: anything that yields
 * a string (a bare code or a tracking URL) can feed `submitCode`.
 */

type Step = "code" | "confirm" | "done";
type Busy = null | "lookup" | "location" | "posting";

type Success = Extract<ConfirmDeliveryResult, { ok: true }>;

const BUSY_LABEL: Record<Exclude<Busy, null>, string> = {
  lookup: "Looking up order…",
  location: "Getting your location…",
  posting: "Confirming delivery…",
};

function signed(amount: string, currency: string): string {
  const text = formatMoney(amount, currency);
  return amount.startsWith("-") || amount === "0.00" ? text : `+${text}`;
}

export function DeliveryScanner({ currency = "SDG" }: { currency?: string }) {
  const { t } = useDriverPrefs();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("code");
  const [busy, setBusy] = useState<Busy>(null);
  const [codeInput, setCodeInput] = useState("");
  const [otp, setOtp] = useState("");
  const [order, setOrder] = useState<DeliveryOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Success | null>(null);
  // A ref, not state: two quick taps must not both get past the guard.
  const inFlight = useRef(false);

  function reset() {
    setStep("code");
    setBusy(null);
    setCodeInput("");
    setOtp("");
    setOrder(null);
    setError(null);
    setSuccess(null);
    inFlight.current = false;
  }

  function openScanner() {
    reset();
    setOpen(true);
  }

  function onOpenChange(next: boolean) {
    // Never drop the sheet while a delivery is being written.
    if (!next && inFlight.current) return;
    if (!next) setOpen(false);
  }

  function message(code: DeliveryErrorCode, attemptsRemaining?: number): string {
    const base = DELIVERY_ERROR_MESSAGES[code];
    if (code === "otp_invalid" && attemptsRemaining !== undefined) {
      return `${base} ${attemptsRemaining} ${
        attemptsRemaining === 1 ? "try" : "tries"
      } left.`;
    }
    return base;
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    const code = normalizeTrackingCode(codeInput);
    if (code === null) {
      setError(DELIVERY_ERROR_MESSAGES.invalid_code);
      return;
    }

    inFlight.current = true;
    setBusy("lookup");
    setError(null);
    try {
      const result = await lookupDeliveryOrder(code);
      if (!result.ok) {
        setError(message(result.error));
        return;
      }
      setOrder(result.order);
      setOtp("");
      setStep("confirm");
    } catch {
      setError(DELIVERY_ERROR_MESSAGES.failed);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function submitDelivery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !order) return;

    if (order.requiresOtp && !isDeliveryOtp(otp)) {
      setError(DELIVERY_ERROR_MESSAGES.otp_required);
      return;
    }

    inFlight.current = true;
    setError(null);
    try {
      setBusy("location");
      const position = await readCurrentPosition();
      if (!position.ok) {
        setError(POSITION_FAILURE_MESSAGES[position.reason]);
        return;
      }

      setBusy("posting");
      const result = await confirmDelivery({
        trackingCode: order.trackingCode,
        otp: order.requiresOtp ? otp : null,
        location: position.fix,
      });

      if (result.ok) {
        setSuccess(result);
        setStep("done");
        return;
      }

      setError(message(result.error, result.attemptsRemaining));
      if (result.error === "otp_invalid") setOtp("");
      if (result.delivered) {
        // Delivered already; only the wallet entry is left. The retry skips the OTP.
        setOrder({ ...order, requiresOtp: false, resume: true, status: "delivered" });
      }
      if (result.error === "already_completed") setOtp("");
    } catch {
      setError(DELIVERY_ERROR_MESSAGES.failed);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const working = busy !== null;

  return (
    <>
      <Button
        type="button"
        onClick={openScanner}
        className="pointer-events-auto relative z-50 h-16 min-h-11 w-full gap-3 rounded-xl bg-[#0F62FF] text-lg font-semibold text-white shadow-md hover:bg-[#0F62FF]/90"
      >
        <QrCode className="size-7" />
        {t.scanDeliver}
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-busy={working}>
          {step === "code" ? (
            <form onSubmit={submitCode} className="flex flex-col gap-5" noValidate>
              <DialogHeader>
                <DialogTitle>{t.scanParcelTitle}</DialogTitle>
                <DialogDescription>
                  Development scanner: type the tracking code printed on the parcel
                  label.
                </DialogDescription>
              </DialogHeader>

              <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium">{t.tracking}</span>
                <input
                  value={codeInput}
                  onChange={(event) => {
                    setCodeInput(event.target.value);
                    if (error) setError(null);
                  }}
                  disabled={working}
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

              <ErrorLine message={error} />

              <Button
                type="submit"
                disabled={working || codeInput.trim().length === 0}
                className="h-14 w-full rounded-2xl text-base font-semibold"
              >
                {busy === "lookup" ? (
                  <>
                    <Loader2 className="size-5 animate-spin" />
                    {BUSY_LABEL.lookup}
                  </>
                ) : (
                  t.findOrder
                )}
              </Button>
            </form>
          ) : null}

          {step === "confirm" && order ? (
            <form onSubmit={submitDelivery} className="flex flex-col gap-5" noValidate>
              <DialogHeader>
                <DialogTitle>
                  {order.resume ? t.walletPending : t.confirmTitle}
                </DialogTitle>
                <DialogDescription>
                  {order.resume
                    ? "This parcel is already marked delivered. Retry to post the wallet entry."
                    : order.paymentType === "cod"
                      ? "Collect the cash from the customer, then confirm."
                      : "Ask the customer for their 4-digit code, then confirm."}
                </DialogDescription>
              </DialogHeader>

              <OrderSummary order={order} currency={currency} />

              {order.requiresOtp ? (
                <label className="flex flex-col gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="size-4" />
                    Customer&rsquo;s delivery code
                  </span>
                  <input
                    value={otp}
                    onChange={(event) => {
                      setOtp(
                        event.target.value
                          .replace(/\D/g, "")
                          .slice(0, DELIVERY_OTP_LENGTH),
                      );
                      if (error) setError(null);
                    }}
                    disabled={working}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    maxLength={DELIVERY_OTP_LENGTH}
                    enterKeyHint="done"
                    placeholder="••••"
                    aria-label="4-digit delivery code"
                    aria-invalid={error ? true : undefined}
                    className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-20 w-full rounded-2xl border px-4 text-center font-mono text-4xl tracking-[0.6em] outline-none focus-visible:ring-3 disabled:opacity-50"
                  />
                </label>
              ) : null}

              <p className="text-muted-foreground flex items-start gap-2 text-xs">
                <MapPin className="mt-0.5 size-3.5 shrink-0" />
                Your location is recorded with this delivery. You&rsquo;ll be asked to
                allow it.
              </p>

              <ErrorLine message={error} />

              <div className="flex flex-col gap-3">
                <Button
                  type="submit"
                  disabled={
                    working || (order.requiresOtp && otp.length !== DELIVERY_OTP_LENGTH)
                  }
                  className="h-14 w-full rounded-2xl text-base font-semibold"
                >
                  {busy === "location" || busy === "posting" ? (
                    <>
                      <Loader2 className="size-5 animate-spin" />
                      {BUSY_LABEL[busy]}
                    </>
                  ) : order.resume ? (
                    t.confirmTitle
                  ) : (
                    t.confirmFull
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={working}
                  onClick={() => {
                    setStep("code");
                    setOrder(null);
                    setOtp("");
                    setError(null);
                  }}
                  className="h-12 w-full rounded-2xl text-base"
                >
                  Scan a different parcel
                </Button>
              </div>
            </form>
          ) : null}

          {step === "done" && success ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col items-center gap-3 pt-2 text-center">
                <CheckCircle2 className="size-14 text-emerald-600 dark:text-emerald-400" />
                <DialogHeader className="items-center">
                  <DialogTitle>{t.deliveredTitle}</DialogTitle>
                  <DialogDescription>
                    <span className="font-mono">{success.trackingCode}</span> is
                    complete.
                  </DialogDescription>
                </DialogHeader>
              </div>

              <dl className="bg-muted flex flex-col gap-3 rounded-2xl p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">
                    {success.paymentType === "cod" ? "Wallet debit" : "Wallet credit"}
                  </dt>
                  <dd className="text-base font-semibold tabular-nums">
                    {success.posted
                      ? signed(success.amount, currency)
                      : "No movement"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">New balance</dt>
                  <dd className="text-base font-semibold tabular-nums">
                    {formatMoney(success.balanceAfter, currency)}
                  </dd>
                </div>
              </dl>

              <Button
                type="button"
                onClick={() => setOpen(false)}
                className="h-14 w-full rounded-2xl text-base font-semibold"
              >
                Done
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  return (
    <div aria-live="polite">
      {message ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}

function OrderSummary({
  order,
  currency,
}: {
  order: DeliveryOrder;
  currency: string;
}) {
  const isCod = order.paymentType === "cod";

  return (
    <div className="bg-muted flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-base font-semibold break-all">
          {order.trackingCode}
        </span>
        <PaymentBadge paymentType={order.paymentType} />
      </div>

      {order.customerName || order.dropoffAddress ? (
        <div className="text-sm">
          {order.customerName ? (
            <p className="font-medium">{order.customerName}</p>
          ) : null}
          {order.dropoffAddress ? (
            <p className="text-muted-foreground whitespace-pre-line">
              {order.dropoffAddress}
            </p>
          ) : null}
        </div>
      ) : null}

      <dl className="border-border flex flex-col gap-2 border-t pt-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">
            {isCod ? "Product price" : "Payment"}
          </dt>
          <dd className="text-base font-semibold tabular-nums">
            {isCod ? formatMoney(order.productPrice, currency) : "Already paid"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">
            {isCod ? "Wallet debit" : "Wallet credit"}
          </dt>
          <dd className="font-semibold tabular-nums">
            {signed(order.walletAmount, currency)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
