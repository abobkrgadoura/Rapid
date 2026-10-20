"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Home,
  Loader2,
  MapPin,
  MessageCircle,
  Package,
  PackageCheck,
  Phone,
  ScanBarcode,
  Store,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { confirmBatchPickup, scanPickupParcel } from "@/actions/hub";
import { usePickupFeedback } from "@/components/driver/pickup/pickup-feedback";
import { useDriverPrefs } from "@/components/driver/preferences";
import { QrMark } from "@/components/driver/pickup/qr-mark";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { playDriverAlert } from "@/lib/driver/alerts";
import type { PickupPendingParcel } from "@/lib/driver/pickup-shipments";
import { HUB_ERROR_MESSAGES, type HubErrorCode } from "@/lib/hub/types";
import { TIME_ZONE } from "@/lib/locale/sudan";
import { normalizeTrackingCode } from "@/lib/orders/tracking";

type Busy = null | "scan" | "confirm";

function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function whatsappUrl(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

const contactButton =
  "pointer-events-auto relative z-10 flex min-h-14 cursor-pointer touch-manipulation flex-col items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white px-2 py-2 text-sm font-medium text-[#082D52] outline-none";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="min-w-0 truncate text-sm font-bold text-[#082D52] tabular-nums">{value}</span>
    </div>
  );
}

const doneDate = new Intl.DateTimeFormat("ar-SD-u-nu-latn", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const doneTime = new Intl.DateTimeFormat("ar-SD-u-nu-latn", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h12",
});

function formatDoneDate(date: Date): string {
  return doneDate.format(date);
}

function formatDoneTime(date: Date): string {
  return doneTime.format(date);
}

export interface PickupScannerProps {
  merchantId: string;
  companyName: string;
  pendingCount: number;
  pickupFee: string | null;
  address: string;
  phone?: string | null;
  mapsHref?: string | null;
  /** Real pending parcels for this merchant. Empty when the list is not available. */
  parcels?: PickupPendingParcel[];
  /** When the oldest pending parcel was created. */
  requestedAt?: string | null;
  /** Classes for the card button that opens this dialog. */
  triggerClassName?: string;
  children?: ReactNode;
  /** When set, the parent owns the dialog. Used by the home scan button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}

export function PickupScanner({
  merchantId,
  companyName,
  pendingCount,
  pickupFee,
  address,
  phone = null,
  mapsHref = null,
  parcels = [],
  requestedAt = null,
  triggerClassName,
  children,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: PickupScannerProps) {
  const reportPickup = usePickupFeedback();
  const { t, prefs } = useDriverPrefs();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const [busy, setBusy] = useState<Busy>(null);
  const [input, setInput] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const [doneAt, setDoneAt] = useState<string | null>(null);
  const [doneCodes, setDoneCodes] = useState<string[]>([]);
  const [doneRemaining, setDoneRemaining] = useState(0);
  const [partialPrompt, setPartialPrompt] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [isScanningMode, setIsScanningMode] = useState(false);
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);

  function setOpen(next: boolean) {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  const resetSession = useCallback(() => {
    setBusy(null);
    setInput("");
    setCodes([]);
    setError(null);
    setDoneCount(null);
    setDoneAt(null);
    setDoneCodes([]);
    setDoneRemaining(0);
    setPartialPrompt(false);
    setIsScanningMode(false);
    inFlight.current = false;
  }, []);

  function openScanner() {
    resetSession();
    setOpen(true);
  }

  function handleOpenChange(next: boolean) {
    if (!next && inFlight.current) return;
    if (!next) setOpen(false);
  }

  useEffect(() => {
    if (open && !wasOpen.current) resetSession();
    wasOpen.current = open;
  }, [open, resetSession]);

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
      setPartialPrompt(false);
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
      // Only the scanned codes are sent. confirm_batch_pickup updates exactly
      // these rows, so parcels that were not scanned stay pending.
      const result = await confirmBatchPickup(codes);
      if (!result.ok) {
        setError(describe(result.error));
        setPartialPrompt(false);
        return;
      }
      reportPickup({ companyName, count: result.count });
      setDoneCodes(result.trackingCodes);
      setDoneRemaining(Math.max(0, total - result.count));
      setDoneCount(result.count);
      setDoneAt(new Date().toISOString());
      setPartialPrompt(false);
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
  const missing = total - codes.length;
  const scannedSet = new Set(codes);
  const requestedDate = requestedAt ? new Date(requestedAt) : null;
  const requestedValid = requestedDate !== null && !Number.isNaN(requestedDate.getTime());

  /** Every parcel scanned confirms at once. Fewer needs an explicit partial-pickup OK. */
  function requestConfirm() {
    if (inFlight.current || codes.length === 0) return;
    if (missing > 0) {
      setPartialPrompt(true);
      return;
    }
    void confirm();
  }
  const receipt =
    doneCount !== null && doneAt
      ? `RAPID|${merchantId}|${doneCount}|${doneAt}|${pickupFee ?? "pending"}`
      : "";

  return (
    <>
      {hideTrigger ? null : children ? (
        <button type="button" onClick={openScanner} className={triggerClassName}>
          {children}
        </button>
      ) : (
        <button
          type="button"
          onClick={openScanner}
          aria-label={t.scanPickup}
          className="pointer-events-auto relative z-10 inline-flex size-11 min-h-11 min-w-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-xl text-gray-400 outline-none"
        >
          <ChevronLeft className="size-5 ltr:rotate-180" aria-hidden />
        </button>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          dir="rtl"
          aria-busy={working}
          className="fixed inset-0 z-50 w-full h-[100dvh] max-h-screen max-w-none p-0 m-0 gap-0 border-none rounded-none bg-[#F4F7FB] flex flex-col overflow-y-auto shadow-none [&>div[aria-hidden]]:hidden"
        >
          <DialogTitle className="sr-only">
            {doneCount !== null ? "تم استلام الطرود بنجاح" : isScanningMode ? "مسح الباركود" : "تفاصيل المتجر"}
          </DialogTitle>
          <DialogDescription className="sr-only">{companyName}</DialogDescription>

          <div className="bg-[#082D52] text-white h-20 min-h-[5rem] flex items-center justify-between px-4 sticky top-0 z-50">
            <ChevronRight
              role="button"
              aria-label="رجوع"
              onClick={() => {
                if (doneCount === null && isScanningMode) {
                  if (!working) setIsScanningMode(false);
                } else {
                  handleOpenChange(false);
                }
              }}
              className="size-6 cursor-pointer"
            />
            <h1 className="text-lg font-bold">
              {doneCount === null && isScanningMode ? "مسح الباركود" : "تفاصيل المتجر"}
            </h1>
            <Store className="size-6" aria-hidden />
          </div>

          {doneCount === null && !isScanningMode ? (
            <div className="flex flex-1 flex-col">
              <div className="flex flex-col p-4">
                <div className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#0F62FF]">
                    <Store className="size-6" aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-2xl font-bold text-[#082D52]">{companyName}</span>
                    <div className="flex items-center gap-2 mt-2 text-gray-500 text-sm font-medium">
                      <MapPin className="size-4 text-[#0F62FF]" aria-hidden />{" "}
                      <span>{address || "الخرطوم - السوق العربي"}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-gray-100 p-4 mt-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-base font-bold text-[#082D52]">
                    <Package className="size-5 text-[#0F62FF]" aria-hidden />
                    تفاصيل الاستلام
                  </div>
                  <DetailRow label="عدد الطرود" value={String(pendingCount)} />
                  {requestedValid && requestedDate ? (
                    <>
                      <DetailRow label="تاريخ الطلب" value={formatDoneDate(requestedDate)} />
                      <DetailRow label="وقت الطلب" value={formatDoneTime(requestedDate)} />
                    </>
                  ) : null}
                </div>

                {parcels.length > 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-100 p-4 mt-4 flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-base font-bold text-[#082D52]">
                      <ScanBarcode className="size-5 text-[#0F62FF]" aria-hidden />
                      الطرود المنتظرة
                    </div>
                    <ul className="flex flex-col divide-y divide-gray-100">
                      {parcels.map((parcel) => (
                        <li key={parcel.id} className="flex items-center justify-between gap-3 py-2">
                          <span dir="ltr" className="font-mono text-sm font-bold text-[#082D52]">
                            {parcel.trackingCode}
                          </span>
                          <span className="text-xs font-semibold text-gray-500 tabular-nums">
                            {parcel.weightKg === null ? "—" : `${parcel.weightKg} كجم`} ·{" "}
                            {parcel.piecesCount} قطعة · {formatDoneDate(new Date(parcel.createdAt))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="grid grid-cols-3 gap-2 mt-4">
                  {phone ? (
                    <a href={telUrl(phone)} className={contactButton}>
                      <Phone className="size-5" aria-hidden />
                      اتصال
                    </a>
                  ) : (
                    <span aria-disabled className={`${contactButton} opacity-40`}>
                      <Phone className="size-5" aria-hidden />
                      اتصال
                    </span>
                  )}
                  {mapsHref ? (
                    <a href={mapsHref} target="_blank" rel="noopener noreferrer" className={contactButton}>
                      <MapPin className="size-5" aria-hidden />
                      خريطة
                    </a>
                  ) : (
                    <span aria-disabled className={`${contactButton} opacity-40`}>
                      <MapPin className="size-5" aria-hidden />
                      خريطة
                    </span>
                  )}
                  {phone ? (
                    <a
                      href={whatsappUrl(phone)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={contactButton}
                    >
                      <MessageCircle className="size-5" aria-hidden />
                      واتساب
                    </a>
                  ) : (
                    <span aria-disabled className={`${contactButton} opacity-40`}>
                      <MessageCircle className="size-5" aria-hidden />
                      واتساب
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-auto sticky bottom-0 p-4 bg-white border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsScanningMode(true)}
                  className="bg-[#0F62FF] text-white rounded-xl h-14 w-full font-bold flex justify-center items-center gap-2"
                >
                  <ScanBarcode /> بدء الاستلام
                </button>
              </div>
            </div>
          ) : doneCount === null ? (
            <div className="flex flex-1 flex-col p-4">
              <p className="truncate text-sm text-gray-500">
                {companyName} · {t.scannedOf} {codes.length} {t.of} {total} {t.parcel}
              </p>

              <label className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-white px-4 py-3">
                <span className="text-sm font-semibold text-[#082D52]">{t.continuous}</span>
                <input
                  type="checkbox"
                  checked={continuous}
                  onChange={(event) => setContinuous(event.target.checked)}
                  className="size-5 accent-[#0F62FF]"
                />
              </label>

              <div
                className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-zinc-100 bg-white px-4 py-3"
                aria-live="polite"
              >
                <span className="text-sm font-medium text-gray-600">{t.scannedOf}</span>
                <span className="text-2xl font-bold text-[#0F62FF] tabular-nums">
                  {codes.length} {t.of} {total}
                </span>
              </div>

              <form onSubmit={submitScan} className="mt-4 flex flex-col" noValidate>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    if (error) setError(null);
                  }}
                  disabled={working}
                  autoFocus
                  dir="ltr"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  placeholder="RP1A2B3C4D5E"
                  aria-label={t.tracking}
                  aria-invalid={error ? true : undefined}
                  className="h-16 text-center font-mono text-xl tracking-widest border-2 border-[#0F62FF] rounded-xl focus:outline-none w-full mb-3 bg-white uppercase disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={working || input.trim().length === 0}
                  className="bg-blue-400 hover:bg-blue-500 text-white rounded-xl h-14 font-bold text-base w-full mb-3 flex justify-center items-center gap-2 disabled:opacity-50"
                >
                  {busy === "scan" ? <Loader2 className="size-5 animate-spin" /> : "إضافة شحنة"}
                </button>
              </form>

              {error ? (
                <p role="alert" className="mb-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-600">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  {error}
                </p>
              ) : null}

              {partialPrompt && missing > 0 ? (
                <div
                  role="alertdialog"
                  aria-live="assertive"
                  className="rounded-2xl border border-amber-200 bg-amber-50 p-4"
                >
                  <p className="flex items-start gap-2 text-sm font-bold text-amber-900">
                    <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
                    <span>
                      لقد مسحت {codes.length} من {total} طرود. هل تؤكد الاستلام الجزئي؟
                      <span className="mt-1 block text-xs font-medium text-amber-800">
                        سيبقى {missing} {missing === 1 ? "طرد" : "طرود"} غير ممسوح بحالة قيد الانتظار.
                      </span>
                    </span>
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPartialPrompt(false)}
                      disabled={working}
                      className="h-12 rounded-xl border border-amber-300 bg-white text-sm font-bold text-amber-900 disabled:opacity-50"
                    >
                      متابعة المسح
                    </button>
                    <button
                      type="button"
                      onClick={() => void confirm()}
                      disabled={working}
                      className="flex h-12 items-center justify-center gap-2 rounded-xl bg-amber-600 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {busy === "confirm" ? <Loader2 className="size-4 animate-spin" /> : null}
                      تأكيد استلام جزئي
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={requestConfirm}
                  disabled={working || codes.length === 0}
                  className="bg-[#0F62FF] hover:bg-blue-700 text-white rounded-xl h-14 font-bold text-base w-full flex justify-center items-center gap-2 disabled:opacity-50"
                >
                  {busy === "confirm" ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <PackageCheck className="size-5" />
                  )}
                  {missing > 0 ? "إنهاء الاستلام" : "تأكيد الاستلام"}
                  {codes.length > 0 ? ` (${codes.length}/${total})` : ""}
                </button>
              )}

              {parcels.length > 0 ? (
                <ul className="mt-4 flex flex-col divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-white px-4">
                  {parcels.map((parcel) => {
                    const scanned = scannedSet.has(parcel.trackingCode);
                    return (
                      <li key={parcel.id} className="flex items-center justify-between gap-3 py-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <CheckCircle2
                            className={`size-5 shrink-0 ${scanned ? "text-emerald-500" : "text-gray-300"}`}
                            aria-hidden
                          />
                          <span dir="ltr" className="font-mono text-sm font-bold text-[#082D52]">
                            {parcel.trackingCode}
                          </span>
                        </span>
                        <span className="text-xs font-semibold text-gray-500 tabular-nums">
                          {parcel.weightKg === null ? "—" : `${parcel.weightKg} كجم`} · {parcel.piecesCount} قطعة
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {codes.length > 0 ? (
                <ul className="mt-4 flex flex-wrap gap-2">
                  {codes.map((code) => (
                    <li
                      key={code}
                      className="flex items-center gap-1 rounded-full border border-blue-100 bg-white py-1 ps-3 pe-1"
                    >
                      <span dir="ltr" className="font-mono text-sm font-semibold tracking-wider text-[#082D52]">
                        {code}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setPartialPrompt(false);
                          setCodes((current) => current.filter((item) => item !== code));
                        }}
                        disabled={working}
                        aria-label={code}
                        className="pointer-events-auto relative z-10 flex size-7 items-center justify-center rounded-full text-gray-400"
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center p-4 pt-8 text-center">
              <div className="rounded-full bg-green-100 p-6">
                <CheckCircle2 className="size-24 text-green-600" aria-hidden />
              </div>
              <h2 className="text-2xl font-bold text-[#082D52] text-center mt-4">تم استلام الطرود بنجاح</h2>
              <dl className="mt-6 flex w-full flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 text-start">
                <DetailRow label="اسم المتجر" value={companyName} />
                <DetailRow label="عدد الطرود" value={String(doneCount)} />
                {doneRemaining > 0 ? (
                  <DetailRow label="متبقي قيد الانتظار" value={String(doneRemaining)} />
                ) : null}
                <DetailRow label="التاريخ" value={doneAt ? formatDoneDate(new Date(doneAt)) : ""} />
                <DetailRow label="الوقت" value={doneAt ? formatDoneTime(new Date(doneAt)) : ""} />
              </dl>
              {doneCodes.length > 0 ? (
                <ul className="mt-3 flex w-full flex-wrap justify-center gap-2">
                  {doneCodes.map((code) => (
                    <li
                      key={code}
                      dir="ltr"
                      className="rounded-full border border-emerald-100 bg-white px-3 py-1 font-mono text-xs font-semibold tracking-wider text-[#082D52]"
                    >
                      {code}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-4 w-full">
                <QrMark value={receipt} label={t.handoverTitle} />
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="bg-[#0F62FF] text-white rounded-xl h-14 w-full font-bold mt-8 flex justify-center items-center gap-2"
              >
                <Home className="size-5" aria-hidden /> العودة إلى القائمة
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
