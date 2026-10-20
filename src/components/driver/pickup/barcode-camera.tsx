"use client";

import { CameraOff, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

type CameraState = "starting" | "live" | "denied" | "unavailable";

/** Same label shown twice in a row is ignored for this long (ms). The decoder fires on every frame. */
const REPEAT_WINDOW_MS = 2500;

/**
 * Live rear-camera scanner for parcel labels (QR and Code 128 barcodes).
 * It only reads text: the parent decides whether the text is a valid tracking
 * code. The camera stops when this component unmounts; the parent unmounts it
 * when the scanning view closes.
 */
export function BarcodeCamera({
  onScan,
  disabled = false,
}: {
  onScan: (text: string) => void;
  /** Keep the preview running but ignore decoded text, e.g. while a scan is being saved. */
  disabled?: boolean;
}) {
  const reactId = useId();
  const elementId = `barcode-camera-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [state, setState] = useState<CameraState>("starting");

  // The scanner is started once; these refs let it see the latest props.
  const onScanRef = useRef(onScan);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    onScanRef.current = onScan;
    disabledRef.current = disabled;
  }, [onScan, disabled]);

  useEffect(() => {
    let cancelled = false;
    let stopScanner: (() => Promise<void>) | null = null;
    let last = { text: "", at: 0 };

    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        // getUserMedia needs HTTPS (or localhost) and a browser that has a camera API.
        setState("unavailable");
        return;
      }

      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        if (cancelled) return;

        const scanner = new Html5Qrcode(elementId, {
          verbose: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.EAN_13,
          ],
          useBarCodeDetectorIfSupported: true,
        });

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            // Wide box: Code 128 labels are long and thin.
            qrbox: (width, height) => {
              const boxWidth = Math.floor(Math.min(width, 480) * 0.9);
              const boxHeight = Math.floor(Math.min(height, boxWidth * 0.6));
              return { width: boxWidth, height: boxHeight };
            },
            aspectRatio: 4 / 3,
          },
          (text) => {
            if (disabledRef.current) return;
            const now = Date.now();
            if (text === last.text && now - last.at < REPEAT_WINDOW_MS) return;
            last = { text, at: now };
            onScanRef.current(text);
          },
          () => {
            // A frame without a readable code. Normal; not an error.
          },
        );

        stopScanner = async () => {
          try {
            if (scanner.isScanning) await scanner.stop();
            scanner.clear();
          } catch {
            // The stream is already gone (e.g. the element was removed).
          }
        };

        if (cancelled) {
          await stopScanner();
          return;
        }
        setState("live");
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof Error ? error.name : String(error);
        const message = error instanceof Error ? error.message : String(error);
        const refused = /NotAllowed|Permission|denied/i.test(`${name} ${message}`);
        setState(refused ? "denied" : "unavailable");
      }
    }

    void start();

    return () => {
      cancelled = true;
      void stopScanner?.();
    };
  }, [elementId]);

  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-[#0F62FF] bg-black">
      {/* html5-qrcode renders its <video> into this element. */}
      <div id={elementId} className="min-h-64 w-full [&_video]:w-full [&_video]:object-cover" />

      {state === "starting" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-sm font-semibold text-white">
          <Loader2 className="size-6 animate-spin" aria-hidden />
          جارٍ تشغيل الكاميرا…
        </div>
      ) : null}

      {state === "denied" || state === "unavailable" ? (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#082D52] px-6 text-center text-sm font-semibold text-white"
        >
          <CameraOff className="size-8" aria-hidden />
          {state === "denied"
            ? "تم رفض إذن الكاميرا. فعّل الكاميرا من إعدادات المتصفح ثم أعد المحاولة، أو أدخل الرمز يدويًا."
            : "تعذّر تشغيل الكاميرا على هذا الجهاز. أدخل رمز التتبع يدويًا."}
        </div>
      ) : null}
    </div>
  );
}
