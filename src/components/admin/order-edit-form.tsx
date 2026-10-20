"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAdminPrefs } from "@/components/admin/admin-prefs";
import { editOrderDetails } from "@/actions/admin-operations";
import { AdminDialog } from "@/components/admin/admin-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toastError, toastSuccess } from "@/components/ui/toast";
import { ADMIN_ERROR_MESSAGES } from "@/lib/admin/types";
import type { AdminOrderRow } from "@/lib/data/admin-ops";
import { formatMoney } from "@/lib/format-money";
import { PHONE_PLACEHOLDER } from "@/lib/locale/sudan";

const fieldClass =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function OrderEditDialog({
  row,
  open,
  onOpenChange,
  onChanged,
}: {
  row: AdminOrderRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  return (
    <AdminDialog
      open={open}
      onOpenChange={onOpenChange}
      title="تعديل بيانات الشحنة"
      description={row ? row.trackingCode : "صلاحية المدير فقط."}
    >
      {row ? (
        <OrderEditForm
          key={row.id}
          row={row}
          onSaved={() => {
            onChanged();
            onOpenChange(false);
          }}
        />
      ) : null}
    </AdminDialog>
  );
}

export function OrderEditForm({
  row,
  onSaved,
}: {
  row: AdminOrderRow;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const { copy } = useAdminPrefs();
  const [phone, setPhone] = useState(row.phone);
  const [address, setAddress] = useState(row.address);
  const [cod, setCod] = useState(row.paymentType === "cod" ? row.cod : "");
  const [notes, setNotes] = useState(row.extras?.deliveryNotes ?? "");
  const [saving, setSaving] = useState(false);
  const codLocked = row.locked || row.paymentType !== "cod";

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const result = await editOrderDetails({
        trackingCode: row.trackingCode,
        phone,
        address,
        codAmount: row.paymentType === "cod" ? cod : row.cod,
        deliveryNotes: notes,
      });
      if (!result.ok) {
        toastError("تعذّر حفظ البيانات", ADMIN_ERROR_MESSAGES[result.error]);
        return;
      }
      toastSuccess(
        result.changed ? "تم تعديل بيانات الشحنة" : "لا يوجد تغيير",
        row.trackingCode,
      );
      router.refresh();
      onSaved?.();
    } catch {
      toastError("تعذّر حفظ البيانات", ADMIN_ERROR_MESSAGES.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4 px-6 py-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="text-muted-foreground text-xs leading-relaxed">
        هذا التعديل للمدير فقط ويُسجَّل في سجل الشحنة. التحصيل عند الاستلام الحالي:{" "}
        <span dir="ltr" className="font-semibold tabular-nums">
          {row.paymentType === "cod" ? formatMoney(row.cod) : "مدفوعة مسبقًا"}
        </span>
      </p>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        هاتف العميل
        <Input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          inputMode="tel"
          dir="ltr"
          placeholder={PHONE_PLACEHOLDER}
          className="h-10 text-start"
          autoComplete="off"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        عنوان العميل
        <textarea
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          rows={3}
          className={fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        مبلغ التحصيل (COD)
        <Input
          value={cod}
          onChange={(event) => setCod(event.target.value)}
          inputMode="decimal"
          dir="ltr"
          disabled={codLocked}
          className="h-10 text-start"
        />
        {row.paymentType !== "cod" ? (
          <span className="text-muted-foreground text-xs font-normal">
            الشحنة مدفوعة مسبقًا، فلا يوجد مبلغ تحصّل عند الباب.
          </span>
        ) : row.locked ? (
          <span className="text-muted-foreground text-xs font-normal">
            سُلّمت الشحنة أو رُحّلت حركتها المالية، فلا يُغيَّر مبلغ التحصيل.
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        ملاحظات التوصيل
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          maxLength={240}
          className={fieldClass}
        />
      </label>

      <Button type="submit" variant="brand" className="h-10 font-bold" disabled={saving}>
        {saving ? <Loader2 className="animate-spin" /> : null}
        {copy.editForm.save}
      </Button>
    </form>
  );
}
