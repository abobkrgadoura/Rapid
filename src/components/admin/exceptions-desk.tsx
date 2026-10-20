"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAdminPrefs } from "@/components/admin/admin-prefs";
import { reviewException } from "@/actions/admin-operations";
import { AdminDialog } from "@/components/admin/admin-modal";
import { AttemptProofCard } from "@/components/orders/attempt-proof";
import { Button } from "@/components/ui/button";
import { toastError, toastSuccess } from "@/components/ui/toast";
import { ORDER_STATUS_AR } from "@/lib/admin/labels";
import { ADMIN_ERROR_MESSAGES } from "@/lib/admin/types";
import type { ExceptionOrder } from "@/lib/data/admin-ops";
import { EXCEPTION_REASON_AR, type AttemptProof } from "@/lib/orders/shipment-details";

function proofOf(row: ExceptionOrder): AttemptProof {
  return {
    reason: row.reason,
    failedAttempts: row.failedAttempts,
    callLogProofUrl: row.callLogProofUrl,
    whatsappProofUrl: row.whatsappProofUrl,
    doorPhotoProofUrl: row.doorPhotoProofUrl,
    distanceMeters: row.distanceMeters,
    gpsVerified: row.gpsVerified,
    lastAttemptAt: row.attemptAt,
    suspicious: row.suspicious,
  };
}

export function ExceptionsDesk({ orders }: { orders: ExceptionOrder[] }) {
  const { copy } = useAdminPrefs();
  const t = copy.exceptions;
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = orders.find((row) => row.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div
        className={`bg-card overflow-x-auto rounded-2xl border shadow-sm transition-opacity ${refreshing ? "opacity-60" : ""}`}
      >
        <table className="w-full min-w-[48rem] text-sm">
          <caption className="sr-only">{t.caption}</caption>
          <thead>
            <tr className="bg-muted/50 text-muted-foreground border-b text-xs">
              <th className="px-4 py-3 text-start font-medium">{t.tracking}</th>
              <th className="px-3 py-3 text-start font-medium">{t.driver}</th>
              <th className="px-3 py-3 text-start font-medium">{t.reason}</th>
              <th className="px-3 py-3 text-start font-medium">{t.attempt}</th>
              <th className="px-3 py-3 text-start font-medium">
                <span className="sr-only">{t.review}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground h-28 text-center">
                  {t.empty}
                </td>
              </tr>
            ) : (
              orders.map((row) => (
                <tr key={row.id} className="hover:bg-muted/40 border-b last:border-0">
                  <td className="px-4 py-3">
                    <span dir="ltr" className="font-mono text-xs font-semibold">
                      {row.trackingCode}
                    </span>
                  </td>
                  <td className="px-3 py-3">{row.driverName ?? t.unassigned}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col">
                      <span>{row.reason ? EXCEPTION_REASON_AR[row.reason] : t.failed}</span>
                      <span className="text-muted-foreground text-xs">
                        {row.failedAttempts} {row.failedAttempts === 1 ? t.attemptOne : t.attemptMany}
                      </span>
                    </div>
                  </td>
                  <td className="text-muted-foreground px-3 py-3 text-xs whitespace-nowrap">
                    {row.attemptLabel ?? "—"}
                  </td>
                  <td className="px-3 py-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => setOpenId(row.id)}>
                      {t.reviewProofs}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <AdminDialog
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpenId(null);
        }}
        title={open ? t.proofsOf(open.trackingCode) : t.proofsTitle}
        description={t.proofsHint}
        className="max-w-3xl"
      >
        {open ? (
          <ReviewBody
            key={open.id}
            row={open}
            onDone={() => {
              setOpenId(null);
              startRefresh(() => router.refresh());
            }}
          />
        ) : null}
      </AdminDialog>
    </div>
  );
}

function ReviewBody({ row, onDone }: { row: ExceptionOrder; onDone: () => void }) {
  const { copy } = useAdminPrefs();
  const t = copy.exceptions;
  const [pending, setPending] = useState<"accept" | "reject" | null>(null);
  const [saving, setSaving] = useState(false);

  async function decide(decision: "accept" | "reject") {
    if (saving) return;
    if (pending !== decision) {
      setPending(decision);
      return;
    }
    setSaving(true);
    try {
      const result = await reviewException(row.trackingCode, decision);
      if (!result.ok) {
        toastError("تعذّر حفظ المراجعة", ADMIN_ERROR_MESSAGES[result.error]);
        setPending(null);
        return;
      }
      toastSuccess(
        decision === "accept" ? "قُبل العذر" : "رُفض العذر",
        `${row.trackingCode} · ${ORDER_STATUS_AR[result.status as ExceptionOrder["status"]]}`,
      );
      onDone();
    } catch {
      toastError("تعذّر حفظ المراجعة", ADMIN_ERROR_MESSAGES.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 px-6 py-5">
      <AttemptProofCard attempt={proofOf(row)} partial={null} />

      {row.locked ? (
        <p className="rounded-xl border bg-zinc-50 p-3 text-xs leading-relaxed">
          الشحنة مُسلَّمة أو ملغاة أو سُجّلت لها حركة مالية. يمكن رفض العذر لإغلاق المراجعة، ولا
          يمكن إرجاعها إلى المخزن.
        </p>
      ) : (
        <p className="text-muted-foreground text-xs leading-relaxed">
          رفض العميل أو ثلاث محاولات فاشلة تُرجع الشحنة للتاجر. غير ذلك تعود إلى المخزن ليُعاد
          توجيهها.
        </p>
      )}

      {pending ? (
        <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
          {pending === "accept"
            ? "سيُغلق هذا العذر وتتحرك الشحنة حسب القاعدة أعلاه."
            : "سيُمسح سبب التعذر ويصلك المندوب تنبيهًا للمحاولة من جديد."}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="brand"
          className="h-10 font-bold"
          disabled={row.locked || saving}
          onClick={() => decide("accept")}
        >
          {saving && pending === "accept" ? <Loader2 className="animate-spin" /> : null}
          {pending === "accept" ? t.confirmAccept : t.accept}
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="h-10 font-bold"
          disabled={saving}
          onClick={() => decide("reject")}
        >
          {saving && pending === "reject" ? <Loader2 className="animate-spin" /> : null}
          {pending === "reject" ? t.confirmReject : t.reject}
        </Button>
      </div>
    </div>
  );
}
