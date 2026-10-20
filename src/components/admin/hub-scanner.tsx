"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  PackageCheck,
  ScanBarcode,
  Truck,
  TriangleAlert,
  Warehouse,
} from "lucide-react";

import { useAdminPrefs } from "@/components/admin/admin-prefs";
import { scanInbound, scanOutbound } from "@/actions/admin";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { canWorkLeg, staffTypeLabel } from "@/lib/admin/labels";
import type { ScanInfo } from "@/lib/admin/types";
import type { AssignableDriver } from "@/lib/data/admin-ops";
import { formatMoney } from "@/lib/format-money";
import { normalizeTrackingCode } from "@/lib/orders/tracking";
import { cn } from "@/lib/utils";

/**
 * Hub sorting station. Built for a USB or Bluetooth barcode gun, which types
 * the code and presses Enter: the field stays focused, clears the instant a
 * code is read, and scans queue up so the next parcel can be scanned while
 * the previous one is still being saved. Results stack newest first.
 *
 *   Inbound   picked_up -> at_hub, and the destination zone / sorting code is
 *             shown large so the parcel goes straight to the right shelf.
 *   Outbound  at_hub -> in_transit with the selected active delivery driver.
 */

type Mode = "inbound" | "outbound";

type Entry = {
  id: number;
  code: string;
  mode: Mode;
  state: "saving" | "ok" | "repeat" | "error";
  info: ScanInfo | null;
  message: string | null;
  driverName: string | null;
};

const MAX_LOG = 50;

const MODE_META: ReadonlyArray<{
  id: Mode;
  icon: typeof Warehouse;
}> = [
  { id: "inbound", icon: Warehouse },
  { id: "outbound", icon: Truck },
];

export function HubScanner({ drivers }: { drivers: AssignableDriver[] }) {
  const { copy } = useAdminPrefs();
  const hubCopy = copy.hub;
  const modes = MODE_META.map((item) =>
    item.id === "inbound"
      ? { ...item, title: hubCopy.inbound, hint: hubCopy.inboundHint }
      : { ...item, title: hubCopy.outbound, hint: hubCopy.outboundHint },
  );
  const deliveryDrivers = useMemo(
    () => drivers.filter((driver) => canWorkLeg(driver.staffType, "delivery")),
    [drivers],
  );

  const [mode, setMode] = useState<Mode>("inbound");
  const [driverId, setDriverId] = useState("");
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [inputError, setInputError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  // Saves run strictly one after another, in scan order.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const selectedDriver = deliveryDrivers.find((driver) => driver.id === driverId) ?? null;
  const driverItems = deliveryDrivers.map((driver) => ({
    value: driver.id,
    label: driver.hubZone ? `${driver.name} — ${driver.hubZone}` : driver.name,
  }));

  const received = entries.filter((e) => e.mode === "inbound" && e.state === "ok").length;
  const dispatched = entries.filter((e) => e.mode === "outbound" && e.state === "ok").length;
  const problems = entries.filter((e) => e.state === "error").length;
  const saving = entries.filter((e) => e.state === "saving").length;
  const latest = entries.find((entry) => entry.state !== "saving") ?? null;

  function update(id: number, patch: Partial<Entry>) {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }

  function switchMode(next: Mode) {
    setMode(next);
    setInputError(null);
    inputRef.current?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const code = normalizeTrackingCode(input);
    if (code === null) {
      setInput("");
      setInputError("هذا ليس رقم تتبع صالحًا. راجع الباركود وحاول مرة أخرى.");
      inputRef.current?.focus();
      return;
    }

    if (mode === "outbound" && !selectedDriver) {
      // Keep what was scanned so choosing a driver does not mean scanning again.
      setInputError("اختر مندوب التوصيل أولًا قبل مسح الشحنة.");
      return;
    }

    setInput("");
    setInputError(null);
    inputRef.current?.focus();

    const id = nextId.current++;
    const scanMode = mode;
    const driver = selectedDriver;
    setEntries((current) =>
      [
        {
          id,
          code,
          mode: scanMode,
          state: "saving",
          info: null,
          message: null,
          driverName: driver?.name ?? null,
        } satisfies Entry,
        ...current,
      ].slice(0, MAX_LOG),
    );

    queue.current = queue.current.then(async () => {
      try {
        if (scanMode === "inbound") {
          const result = await scanInbound(code);
          if (result.ok) {
            update(id, {
              state: result.alreadyReceived ? "repeat" : "ok",
              info: result.info,
              message: result.alreadyReceived ? "الشحنة موجودة بالمخزن بالفعل. لم يتغير شيء." : null,
            });
          } else {
            update(id, { state: "error", message: result.message });
          }
        } else if (driver) {
          const result = await scanOutbound(code, driver.id);
          if (result.ok) {
            update(id, {
              state: result.alreadyLoaded ? "repeat" : "ok",
              info: result.info,
              message: result.alreadyLoaded
                ? `الشحنة خرجت مع ${driver.name} من قبل. لم يتغير شيء.`
                : null,
            });
          } else {
            update(id, { state: "error", message: result.message });
          }
        }
      } catch {
        update(id, { state: "error", message: "تعذّر الاتصال بالخادم. أعد مسح الشحنة." });
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="flex flex-col gap-5">
        <div role="tablist" aria-label={hubCopy.mode} className="grid grid-cols-2 gap-3">
          {modes.map((item) => {
            const Icon = item.icon;
            const active = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => switchMode(item.id)}
                className={cn(
                  "pointer-events-auto flex min-h-11 cursor-pointer touch-manipulation items-center gap-3 rounded-2xl border p-4 text-start outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "bg-ink-950 border-ink-950 text-white shadow-lg"
                    : "bg-card hover:bg-muted/60",
                )}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-xl",
                    active ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-bold">{item.title}</span>
                  <span
                    dir="ltr"
                    className={cn(
                      "text-start text-xs",
                      active ? "text-neutral-400" : "text-muted-foreground",
                    )}
                  >
                    {item.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {mode === "outbound" ? (
          <div className="bg-card flex flex-col gap-2 rounded-2xl border p-4">
            <span className="text-sm font-medium">{hubCopy.driver}</span>
            {deliveryDrivers.length === 0 ? (
              <p role="alert" className="text-destructive text-sm">
                لا يوجد مناديب توصيل نشطون. أضف مندوبًا من صفحة إدارة المناديب والطاقم.
              </p>
            ) : (
              <Select
                items={driverItems}
                value={driverId === "" ? null : driverId}
                onValueChange={(next) => {
                  setDriverId(next ?? "");
                  setInputError(null);
                  inputRef.current?.focus();
                }}
              >
                <SelectTrigger className="h-11 w-full" aria-label={hubCopy.driverLabel}>
                  <SelectValue placeholder="اختر المندوب الذي سيستلم الشحنات" />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {deliveryDrivers.map((driver) => (
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
            )}
          </div>
        ) : null}

        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <label className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-sm font-medium">
              <ScanBarcode className="size-4" />
              {mode === "inbound" ? "امسح الشحنة لاستلامها في المخزن" : "امسح الشحنة لإخراجها للمندوب"}
            </span>
            <input
              ref={inputRef}
              dir="ltr"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                if (inputError) setInputError(null);
              }}
              autoFocus
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="امسح الباركود أو اكتب رقم التتبع ثم Enter"
              aria-invalid={inputError ? true : undefined}
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-20 w-full rounded-2xl border px-5 font-mono text-2xl tracking-wider uppercase outline-none placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:normal-case focus-visible:ring-3"
            />
          </label>
          <div aria-live="polite">
            {inputError ? (
              <p role="alert" className="text-destructive text-sm">
                {inputError}
              </p>
            ) : null}
          </div>
        </form>

        <ResultPanel entry={latest} />
      </div>

      <aside className="flex flex-col gap-4">
        <div
          className="grid grid-cols-3 gap-3 text-center"
          aria-live="polite"
          aria-label="إجماليات الجلسة"
        >
          <Stat label="استُلمت" value={received} tone="good" />
          <Stat label="خرجت" value={dispatched} tone="good" />
          <Stat label="مشاكل" value={problems} tone={problems > 0 ? "bad" : "muted"} />
        </div>
        {saving > 0 ? (
          <p className="text-muted-foreground text-center text-xs">
            جارٍ حفظ {saving} شحنة…
          </p>
        ) : null}

        <section aria-label="آخر الشحنات الممسوحة" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">آخر الشحنات الممسوحة</h2>
          {entries.length > 0 ? (
            <ul className="divide-border bg-card flex max-h-[32rem] flex-col divide-y overflow-y-auto rounded-2xl border">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 px-4 py-3">
                  <EntryIcon state={entry.state} />
                  <div className="min-w-0 flex-1">
                    <p dir="ltr" className="text-start font-mono text-sm font-semibold">
                      {entry.code}
                    </p>
                    <p
                      className={cn(
                        "text-xs",
                        entry.state === "error" ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {entryLine(entry)}
                    </p>
                  </div>
                  {entry.state === "ok" && entry.info && entry.mode === "inbound" ? (
                    <span
                      dir="ltr"
                      className="bg-ink-950 shrink-0 rounded-lg px-2 py-1 font-mono text-xs font-bold text-white"
                    >
                      {entry.info.sortCode}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground rounded-2xl border border-dashed px-4 py-8 text-center text-sm">
              ستظهر هنا الشحنات التي تمسحها.
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}

function entryLine(entry: Entry): string {
  if (entry.state === "saving") return entry.mode === "inbound" ? "جارٍ الاستلام…" : "جارٍ الإخراج…";
  if (entry.state === "error" || entry.state === "repeat") return entry.message ?? "";
  if (entry.mode === "inbound") {
    return entry.info ? `تم الاستلام · ${entry.info.zone}` : "تم الاستلام في المخزن";
  }
  return `خرجت مع ${entry.info?.driverName ?? entry.driverName ?? "المندوب"}`;
}

function ResultPanel({ entry }: { entry: Entry | null }) {
  if (!entry) {
    return (
      <div className="text-muted-foreground flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 text-center text-sm">
        <PackageCheck className="size-8 opacity-40" />
        بانتظار أول شحنة. ستظهر هنا منطقة التوجيه وكود الفرز بخط كبير.
      </div>
    );
  }

  if (entry.state === "error") {
    return (
      <div
        role="alert"
        className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-6 py-8 text-center text-red-950"
      >
        <TriangleAlert className="size-10 text-red-600" />
        <p dir="ltr" className="font-mono text-lg font-semibold">
          {entry.code}
        </p>
        <p className="text-base font-semibold">{entry.message}</p>
      </div>
    );
  }

  const repeat = entry.state === "repeat";
  const info = entry.info;

  return (
    <div
      aria-live="polite"
      className={cn(
        "flex min-h-48 flex-col gap-4 rounded-2xl border px-6 py-6",
        repeat
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : "border-emerald-200 bg-emerald-50 text-emerald-950",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {repeat ? (
            <CircleAlert className="size-5 text-amber-600" />
          ) : (
            <CheckCircle2 className="size-5 text-emerald-600" />
          )}
          {repeat
            ? entry.message
            : entry.mode === "inbound"
              ? "تم الاستلام في المخزن"
              : `خرجت مع ${info?.driverName ?? entry.driverName ?? "المندوب"}`}
        </span>
        <span dir="ltr" className="font-mono text-sm font-semibold">
          {entry.code}
        </span>
      </div>

      {info ? (
        <div className="flex flex-wrap items-center gap-5">
          <div
            dir="ltr"
            className="bg-ink-950 text-gold flex min-w-32 items-center justify-center rounded-2xl px-6 py-4 font-mono text-5xl font-black tracking-wide"
          >
            {info.sortCode}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs font-medium opacity-70">منطقة التوجيه</span>
            <span className="text-3xl leading-tight font-black">{info.zone}</span>
            <span className="text-sm opacity-80">
              {info.merchantName}
              {info.customerName ? ` ← ${info.customerName}` : ""}
            </span>
          </div>
          <div className="flex flex-col items-end gap-1">
            {info.paymentType === "cod" && info.cod ? (
              <>
                <span className="text-xs font-medium opacity-70">تحصيل عند التسليم</span>
                <span dir="ltr" className="text-xl font-bold tabular-nums">
                  {formatMoney(info.cod)}
                </span>
              </>
            ) : (
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold">
                مدفوعة مسبقًا
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm opacity-80">تمت العملية، لكن تفاصيل الشحنة غير متاحة الآن.</p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "bad" | "muted";
}) {
  const color =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div className="bg-card rounded-2xl border px-3 py-3">
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  );
}

function EntryIcon({ state }: { state: Entry["state"] }) {
  if (state === "saving") {
    return <Loader2 className="text-muted-foreground mt-0.5 size-5 shrink-0 animate-spin" />;
  }
  if (state === "ok") {
    return <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />;
  }
  if (state === "repeat") {
    return <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />;
  }
  return <TriangleAlert className="text-destructive mt-0.5 size-5 shrink-0" />;
}
