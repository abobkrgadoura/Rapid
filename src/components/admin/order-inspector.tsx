"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Lock, ShieldAlert } from "lucide-react";

import { useAdminPrefs } from "@/components/admin/admin-prefs";
import { overrideOrder, type OverrideStatus, type OverrideUnassign } from "@/actions/admin";
import { AttemptProofCard } from "@/components/orders/attempt-proof";
import { AdminDrawer } from "@/components/admin/admin-modal";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastError, toastSuccess } from "@/components/ui/toast";
import { ORDER_STATUS_AR, ORDER_STATUS_TONE } from "@/lib/admin/labels";
import { ADMIN_ERROR_MESSAGES } from "@/lib/admin/types";
import type { AdminOrderRow } from "@/lib/data/admin-ops";
import { formatMoney } from "@/lib/format-money";
import { PARCEL_SIZE_AR } from "@/lib/orders/shipment-details";
import { cn } from "@/lib/utils";

const STATUS_ITEMS: ReadonlyArray<{ value: "keep" | OverrideStatus; label: string }> = [
  { value: "keep", label: "بدون تغيير الحالة" },
  { value: "pending", label: "إعادة إلى بانتظار الاستلام" },
  { value: "picked_up", label: "تم الاستلام من التاجر" },
  { value: "at_hub", label: "في مخزن الفرز" },
  { value: "in_transit", label: "خرجت للتوصيل (يلزم مندوب توصيل)" },
  { value: "returned", label: "مرتجعة إلى التاجر (RTO)" },
  { value: "cancelled", label: "ملغاة" },
];

const UNASSIGN_ITEMS: ReadonlyArray<{ value: "none" | OverrideUnassign; label: string }> = [
  { value: "none", label: "بدون سحب مندوب" },
  { value: "delivery", label: "سحب مندوب التوصيل" },
  { value: "pickup", label: "سحب مندوب الاستلام" },
  { value: "both", label: "سحب المندوبين" },
];

/** Overrides that end a parcel's journey ask for a second click. */
const NEEDS_CONFIRM: ReadonlySet<string> = new Set(["returned", "cancelled", "pending"]);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-bold">{title}</h3>
      {children}
    </section>
  );
}

export function OrderInspector({
  row,
  open,
  onOpenChange,
  onChanged,
  onEdit,
}: {
  row: AdminOrderRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  onEdit: () => void;
}) {
  return (
    <AdminDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={row ? `الشحنة ${row.trackingCode}` : "تفاصيل الشحنة"}
      description="مراجعة بيانات الشحنة وتصحيح حالتها أو سحب المندوب."
    >
      {row ? (
        <InspectorBody key={row.id} row={row} onChanged={onChanged} onEdit={onEdit} />
      ) : null}
    </AdminDrawer>
  );
}

function InspectorBody({
  row,
  onChanged,
  onEdit,
}: {
  row: AdminOrderRow;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const { copy } = useAdminPrefs();
  const t = copy.inspector;
  const [status, setStatus] = useState<"keep" | OverrideStatus>("keep");
  const [unassign, setUnassign] = useState<"none" | OverrideUnassign>("none");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasChange = status !== "keep" || unassign !== "none";
  const needsConfirm =
    (status !== "keep" && NEEDS_CONFIRM.has(status)) || unassign === "both";

  async function apply() {
    if (!hasChange || saving) return;
    if (needsConfirm && !confirming) {
      setConfirming(true);
      return;
    }

    setSaving(true);
    try {
      const result = await overrideOrder(
        row.trackingCode,
        status === "keep" ? null : status,
        unassign === "none" ? null : unassign,
      );
      if (!result.ok) {
        toastError("تعذّر تعديل الشحنة", ADMIN_ERROR_MESSAGES[result.error]);
        setConfirming(false);
        return;
      }
      toastSuccess(
        result.changed ? "تم تعديل الشحنة" : "لا يوجد تغيير",
        `${row.trackingCode} · ${ORDER_STATUS_AR[result.status as AdminOrderRow["status"]]}`,
      );
      setStatus("keep");
      setUnassign("none");
      setConfirming(false);
      onChanged();
    } catch {
      toastError("تعذّر تعديل الشحنة", ADMIN_ERROR_MESSAGES.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "inline-flex rounded-full border px-3 py-1 text-xs font-semibold",
            ORDER_STATUS_TONE[row.status],
          )}
        >
          {ORDER_STATUS_AR[row.status]}
        </span>
        <span className="bg-muted rounded-full px-3 py-1 text-xs font-semibold">
          {row.paymentType === "cod" ? "الدفع عند الاستلام (COD)" : "مدفوعة مسبقًا"}
        </span>
        <span
          dir="ltr"
          className="bg-ink-950 text-gold rounded-lg px-2.5 py-1 font-mono text-xs font-bold"
        >
          {row.sortCode}
        </span>
      </div>

      <Section title="المبالغ">
        <dl className="grid grid-cols-2 gap-4">
          <Field label="سعر المنتج">
            <span dir="ltr" className="tabular-nums">
              {formatMoney(row.productPrice)}
            </span>
          </Field>
          <Field label="رسوم التوصيل">
            <span dir="ltr" className="tabular-nums">
              {formatMoney(row.deliveryFee)}
            </span>
          </Field>
          <Field label="تحصيل عند التسليم">
            <span dir="ltr" className="tabular-nums">
              {row.paymentType === "cod" ? formatMoney(row.cod) : "لا يوجد"}
            </span>
          </Field>
        </dl>
      </Section>

      <Section title="العميل والتوصيل">
        <dl className="grid grid-cols-2 gap-4">
          <Field label="العميل">{row.customerName || "—"}</Field>
          <Field label="الهاتف">
            <span dir="ltr" className="text-start">
              {row.phone || "—"}
            </span>
          </Field>
          {row.secondaryPhone ? (
            <Field label="هاتف إضافي">
              <span dir="ltr" className="text-start">
                {row.secondaryPhone}
              </span>
            </Field>
          ) : null}
          <Field label="المنطقة">{row.zone}</Field>
          <div className="col-span-2">
            <Field label="العنوان">{row.address || "—"}</Field>
          </div>
          {row.extras?.buildingName ? (
            <Field label="المبنى">{row.extras.buildingName}</Field>
          ) : null}
          {row.extras?.floorNumber ? <Field label="الدور">{row.extras.floorNumber}</Field> : null}
          {row.extras?.apartmentNumber ? (
            <Field label="الشقة">{row.extras.apartmentNumber}</Field>
          ) : null}
          {row.extras?.landmark ? (
            <div className="col-span-2">
              <Field label="علامة مميزة">{row.extras.landmark}</Field>
            </div>
          ) : null}
        </dl>
        {row.dropoffMapUrl ? (
          <a
            href={row.dropoffMapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand flex w-fit items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
          >
            <ExternalLink className="size-3" />
            موقع التسليم على الخريطة
          </a>
        ) : null}
      </Section>

      {row.extras?.attempt ? (
        <AttemptProofCard attempt={row.extras.attempt} partial={row.extras.partial} />
      ) : null}

      {row.extras ? (
        <Section title="الشحنة">
          <dl className="grid grid-cols-2 gap-4">
            <Field label="الحجم">{PARCEL_SIZE_AR[row.extras.parcelSize]}</Field>
            <Field label="القطع">{String(row.extras.piecesCount)}</Field>
            <Field label="فتح الشحنة">{row.extras.allowOpening ? "نعم" : "لا"}</Field>
            {row.extras.productDescription ? (
              <div className="col-span-2">
                <Field label="وصف المنتج">{row.extras.productDescription}</Field>
              </div>
            ) : null}
            {row.extras.deliveryNotes ? (
              <div className="col-span-2">
                <Field label="ملحوظات التوصيل">{row.extras.deliveryNotes}</Field>
              </div>
            ) : null}
            {row.extras.internalNotes ? (
              <div className="col-span-2">
                <Field label="ملاحظات داخلية">{row.extras.internalNotes}</Field>
              </div>
            ) : null}
          </dl>
        </Section>
      ) : null}

      <Section title="التاجر والاستلام">
        <dl className="grid grid-cols-2 gap-4">
          <Field label="التاجر">{row.merchantName}</Field>
          <Field label="مندوب الاستلام">{row.pickupDriverName ?? "غير معيّن"}</Field>
          <div className="col-span-2">
            <Field label="عنوان الاستلام">{row.pickupAddress || "—"}</Field>
          </div>
        </dl>
        {row.pickupMapUrl ? (
          <a
            href={row.pickupMapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand flex w-fit items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
          >
            <ExternalLink className="size-3" />
            موقع الاستلام على الخريطة
          </a>
        ) : null}
      </Section>

      <Section title="المندوب والمسار">
        <dl className="grid grid-cols-2 gap-4">
          <Field label="مندوب التوصيل">{row.driverName ?? "غير معيّن"}</Field>
          <Field label="تاريخ الإنشاء">{row.createdLabel}</Field>
          <Field label="تم الاستلام من التاجر">{row.pickedUpLabel ?? "—"}</Field>
          <Field label="خرجت للتوصيل">{row.inTransitLabel ?? "—"}</Field>
          <Field label="تم التسليم">{row.deliveredLabel ?? "—"}</Field>
        </dl>
      </Section>

      <Section title="بيانات الشحنة">
        <Button type="button" variant="outline" className="h-10 w-fit font-bold" onClick={onEdit}>
          {t.edit}
        </Button>
      </Section>

      <Section title="تصحيح الحالة (صلاحية المدير)">
        {row.locked ? (
          <p className="flex items-start gap-2 rounded-xl border bg-zinc-50 p-3 text-xs leading-relaxed">
            <Lock className="mt-0.5 size-4 shrink-0" />
            الشحنة مُسلَّمة أو سُجّلت لها حركة مالية، فلا يمكن تغيير حالتها. التصحيح المالي
            يتم بقيد في دفتر المحفظة.
          </p>
        ) : (
          <div className="flex flex-col gap-4 rounded-2xl border p-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">الحالة الجديدة</span>
              <Select
                items={STATUS_ITEMS}
                value={status}
                onValueChange={(next) => {
                  setStatus((next ?? "keep") as "keep" | OverrideStatus);
                  setConfirming(false);
                }}
              >
                <SelectTrigger className="h-10 w-full" aria-label="الحالة الجديدة">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {STATUS_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">سحب مندوب</span>
              <Select
                items={UNASSIGN_ITEMS}
                value={unassign}
                onValueChange={(next) => {
                  setUnassign((next ?? "none") as "none" | OverrideUnassign);
                  setConfirming(false);
                }}
              >
                <SelectTrigger className="h-10 w-full" aria-label="سحب مندوب">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {UNASSIGN_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs leading-relaxed">
                سحب مندوب التوصيل من شحنة خرجت للتوصيل يعيدها إلى المخزن، وسحب مندوب الاستلام
                من شحنة استلمها يعيدها إلى بانتظار الاستلام.
              </p>
            </div>

            {confirming ? (
              <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                هذا التعديل سيغيّر مسار الشحنة. اضغط «تأكيد التعديل» للمتابعة.
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={confirming ? "destructive" : "brand"}
                size="lg"
                className="h-10 gap-2 px-5 font-bold"
                disabled={!hasChange || saving}
                onClick={apply}
              >
                {saving ? <Loader2 className="animate-spin" /> : null}
                {confirming ? t.confirm : t.apply}
              </Button>
              {confirming ? (
                <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                  {t.undo}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
