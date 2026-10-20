"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Loader2, X } from "lucide-react";

import { updateMerchantOrder, type MerchantEditError } from "@/actions/merchant-orders";
import { useLocale } from "@/components/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toastError, toastSuccess } from "@/components/ui/toast";
import type { Messages } from "@/lib/i18n/messages";
import { inspectMerchantEdit, type MerchantEditIssue } from "@/lib/orders/merchant-edit";
import { PHONE_PLACEHOLDER } from "@/lib/locale/sudan";
import type { PaymentType } from "@/lib/orders/status";
import { cn } from "@/lib/utils";

const fieldClass =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type EditableMerchantOrder = {
  id: string;
  trackingCode: string;
  phone: string;
  secondaryPhone: string;
  dropoffAddress: string;
  piecesCount: number;
  productPrice: string;
  paymentType: PaymentType;
};

function moneyInput(canonical: string): string {
  const [whole = "0", fraction = "00"] = canonical.split(".");
  if (!fraction || /^0+$/.test(fraction)) return whole;
  return `${whole}.${fraction.replace(/0+$/, "")}`;
}

export function MerchantOrderEditDialog({
  order,
  open,
  onOpenChange,
}: {
  order: EditableMerchantOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { m, dir, locale } = useLocale();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          data-slot="dialog-overlay"
          className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-[2px] transition-opacity duration-200 data-closed:pointer-events-none data-ending-style:pointer-events-none data-ending-style:opacity-0 data-starting-style:pointer-events-none data-starting-style:opacity-0"
        />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
          <DialogPrimitive.Popup
            dir={dir}
            lang={locale}
            data-slot="dialog-content"
            className="bg-background pointer-events-auto flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border shadow-2xl outline-none transition-[opacity,transform] duration-200 data-closed:pointer-events-none data-ending-style:pointer-events-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
          >
            <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
              <div className="flex min-w-0 flex-col gap-1">
                <DialogPrimitive.Title className="text-lg leading-tight font-bold tracking-tight">
                  {m.orderEdit.title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-muted-foreground text-sm">
                  {order ? order.trackingCode : m.orderEdit.hint}
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close
                aria-label={m.shell.closeMenu}
                className="text-muted-foreground hover:bg-muted hover:text-foreground pointer-events-auto flex size-11 min-h-11 min-w-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {order ? (
                <EditForm
                  key={`${order.id}:${order.phone}:${order.secondaryPhone}:${order.dropoffAddress}:${order.piecesCount}:${order.productPrice}`}
                  order={order}
                  copy={m.orderEdit}
                  onSaved={() => onOpenChange(false)}
                />
              ) : null}
            </div>
          </DialogPrimitive.Popup>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function EditForm({
  order,
  copy,
  onSaved,
}: {
  order: EditableMerchantOrder;
  copy: Messages["orderEdit"];
  onSaved: () => void;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(order.phone);
  const [secondaryPhone, setSecondaryPhone] = useState(order.secondaryPhone);
  const [address, setAddress] = useState(order.dropoffAddress);
  const [pieces, setPieces] = useState(String(order.piecesCount));
  const [cod, setCod] = useState(
    order.paymentType === "cod" ? moneyInput(order.productPrice) : "",
  );
  const [issues, setIssues] = useState<MerchantEditIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const prepaid = order.paymentType !== "cod";

  async function save() {
    if (saving) return;
    const fields = {
      phone,
      secondaryPhone,
      dropoffAddress: address,
      piecesCount: pieces,
      codAmount: prepaid ? order.productPrice : cod,
    };
    const inspected = inspectMerchantEdit(fields, order.paymentType);
    setIssues(inspected.issues);
    if (!inspected.parsed) return;

    setSaving(true);
    try {
      const result = await updateMerchantOrder({ orderId: order.id, ...fields });
      if (!result.ok) {
        toastError(copy.title, copy.errors[result.error]);
        if (isField(result.error)) setIssues([result.error]);
        return;
      }
      toastSuccess(result.changed ? copy.saved : copy.unchanged, order.trackingCode);
      router.refresh();
      onSaved();
    } catch {
      toastError(copy.title, copy.errors.failed);
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
      <p className="text-muted-foreground text-xs leading-relaxed">{copy.hint}</p>

      <Field label={copy.phone} error={issues.includes("phone") ? copy.errors.phone : null}>
        <Input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          inputMode="tel"
          dir="ltr"
          placeholder={PHONE_PLACEHOLDER}
          className="h-10 text-start"
          autoComplete="off"
          aria-invalid={issues.includes("phone")}
        />
      </Field>

      <Field
        label={copy.secondaryPhone}
        hint={copy.secondaryHint}
        error={issues.includes("secondary") ? copy.errors.secondary : null}
      >
        <Input
          value={secondaryPhone}
          onChange={(event) => setSecondaryPhone(event.target.value)}
          inputMode="tel"
          dir="ltr"
          placeholder={PHONE_PLACEHOLDER}
          className="h-10 text-start"
          autoComplete="off"
          aria-invalid={issues.includes("secondary")}
        />
      </Field>

      <Field label={copy.address} error={issues.includes("address") ? copy.errors.address : null}>
        <textarea
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          rows={3}
          maxLength={500}
          className={fieldClass}
          aria-invalid={issues.includes("address")}
        />
      </Field>

      <Field label={copy.pieces} error={issues.includes("pieces") ? copy.errors.pieces : null}>
        <Input
          value={pieces}
          onChange={(event) => setPieces(event.target.value)}
          inputMode="numeric"
          dir="ltr"
          className="h-10 text-start"
          aria-invalid={issues.includes("pieces")}
        />
      </Field>

      <Field
        label={copy.cod}
        hint={prepaid ? copy.prepaidHint : null}
        error={issues.includes("cod") ? copy.errors.cod : null}
      >
        <Input
          value={cod}
          onChange={(event) => setCod(event.target.value)}
          inputMode="decimal"
          dir="ltr"
          disabled={prepaid}
          className="h-10 text-start"
          aria-invalid={issues.includes("cod")}
        />
      </Field>

      <Button type="submit" variant="brand" className="h-10 font-bold" disabled={saving}>
        {saving ? <Loader2 className="animate-spin" /> : null}
        {copy.save}
      </Button>
    </form>
  );
}

function isField(error: MerchantEditError): error is MerchantEditIssue {
  return (
    error === "phone" ||
    error === "secondary" ||
    error === "address" ||
    error === "pieces" ||
    error === "cod"
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | null;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      {children}
      {hint ? <span className="text-muted-foreground text-xs font-normal">{hint}</span> : null}
      {error ? <span className={cn("text-destructive text-xs font-normal")}>{error}</span> : null}
    </label>
  );
}
