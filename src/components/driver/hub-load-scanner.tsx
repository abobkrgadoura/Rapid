"use client";

import { Loader2, PackageCheck, TriangleAlert, Warehouse } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { startDeliveryFromHub } from "@/actions/hub";
import { useDriverPrefs } from "@/components/driver/preferences";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HUB_ERROR_MESSAGES } from "@/lib/hub/types";
import { normalizeTrackingCode } from "@/lib/orders/tracking";

/**
 * Delivery driver, at the hub counter. Each scan assigns the parcel to this
 * driver and sets it out for delivery. The sheet stays open between scans so a
 * driver can load a whole route; the parcels appear on the Deliveries tab
 * behind it as each scan lands.
 */

type Loaded = { code: string; repeat: boolean };

export function HubLoadScanner() {
  const { t, alert } = useDriverPrefs();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [loaded, setLoaded] = useState<Loaded[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function openScanner() {
    setBusy(false);
    setInput("");
    setLoaded([]);
    setError(null);
    inFlight.current = false;
    setOpen(true);
  }

  function onOpenChange(next: boolean) {
    if (!next && inFlight.current) return;
    if (!next) setOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    const code = normalizeTrackingCode(input);
    if (code === null) {
      setError(HUB_ERROR_MESSAGES.invalid_code);
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await startDeliveryFromHub(code);
      if (!result.ok) {
        setError(HUB_ERROR_MESSAGES[result.error]);
        return;
      }
      setLoaded((current) => [
        { code: result.trackingCode, repeat: result.alreadyLoaded },
        ...current.filter((item) => item.code !== result.trackingCode),
      ]);
      setInput("");
      if (!result.alreadyLoaded) alert();
    } catch {
      setError(HUB_ERROR_MESSAGES.failed);
    } finally {
      inFlight.current = false;
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={openScanner}
        className="h-12 w-full gap-2 rounded-2xl text-base font-semibold"
      >
        <Warehouse className="size-5" />
        {t.loadHub}
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-busy={busy}>
          <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
            <DialogHeader>
              <DialogTitle>{t.loadHubTitle}</DialogTitle>
              <DialogDescription>
                Scan each parcel you are taking out. It becomes yours to deliver.
                Development scanner: type the tracking code and press Enter.
              </DialogDescription>
            </DialogHeader>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Tracking code</span>
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  if (error) setError(null);
                }}
                disabled={busy}
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

            <div aria-live="polite">
              {error ? (
                <p
                  role="alert"
                  className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </p>
              ) : null}
            </div>

            <Button
              type="submit"
              disabled={busy || input.trim().length === 0}
              className="h-14 w-full gap-2 rounded-2xl text-base font-semibold"
            >
              {busy ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <PackageCheck className="size-5" />
              )}
              Load parcel
            </Button>
          </form>

          {loaded.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium" aria-live="polite">
                Loaded this session: {loaded.length}
              </p>
              <ul className="divide-border flex max-h-40 flex-col divide-y overflow-y-auto rounded-2xl border">
                {loaded.map((item) => (
                  <li
                    key={item.code}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="font-mono text-sm font-semibold">{item.code}</span>
                    <span className="text-muted-foreground text-xs">
                      {item.repeat ? t.alreadyLoaded : t.onRoute}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
            className="h-12 w-full rounded-2xl text-base"
          >
            Done
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
