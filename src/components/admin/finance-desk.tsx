"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAdminPrefs } from "@/components/admin/admin-prefs";
import { payoutMerchant, settleDriverCash } from "@/actions/finance";
import { DataTable, type DataColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toastError, toastSuccess } from "@/components/ui/toast";
import {
  FINANCE_ERROR_MESSAGES,
  type AdminFinanceView,
  type DriverCustodyRow,
  type MerchantPayoutRow,
} from "@/lib/finance/types";
import { formatMoney } from "@/lib/format-money";

function ConfirmButton({
  rowId,
  armed,
  busy,
  disabled,
  label,
  confirmLabel,
  onArm,
  onRun,
}: {
  rowId: string;
  armed: string | null;
  busy: boolean;
  disabled: boolean;
  label: string;
  confirmLabel: string;
  onArm: (id: string) => void;
  onRun: (id: string) => void;
}) {
  const isArmed = armed === rowId;
  return (
    <div className="flex justify-end">
      <Button
        type="button"
        size="sm"
        variant={isArmed ? "brand" : "outline"}
        disabled={disabled}
        onClick={() => (isArmed ? onRun(rowId) : onArm(rowId))}
      >
        {busy ? <Loader2 className="animate-spin" /> : null}
        {isArmed ? confirmLabel : label}
      </Button>
    </div>
  );
}

export function FinanceDesk({ view }: { view: AdminFinanceView }) {
  const { copy } = useAdminPrefs();
  const financeCopy = copy.finance;
  const router = useRouter();
  const [armed, setArmed] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(
    id: string,
    action: (id: string) => Promise<{ ok: true; amount: string } | { ok: false; error: keyof typeof FINANCE_ERROR_MESSAGES }>,
    successTitle: string,
    successDetail: (amount: string) => string,
  ) {
    if (pending) return;
    setBusyId(id);
    startTransition(async () => {
      try {
        const result = await action(id);
        if (!result.ok) {
          toastError("تعذّرت الحركة", FINANCE_ERROR_MESSAGES[result.error]);
          return;
        }
        toastSuccess(successTitle, successDetail(result.amount));
        router.refresh();
      } catch {
        toastError("تعذّرت الحركة", FINANCE_ERROR_MESSAGES.failed);
      } finally {
        setBusyId(null);
        setArmed(null);
      }
    });
  }

  const custodyColumns: DataColumn<DriverCustodyRow>[] = [
    {
      id: "name",
      header: "المندوب",
      className: "whitespace-normal font-medium",
      cell: (row) => row.name,
    },
    {
      id: "zone",
      header: "المنطقة",
      className: "whitespace-normal",
      cell: (row) => row.zone,
    },
    {
      id: "cash",
      header: "العهدة النقدية",
      headClassName: "text-end",
      className: "text-end",
      cell: (row) => (
        <span dir="ltr" className="font-medium text-amber-800 tabular-nums">
          {formatMoney(row.cashInHand)}
        </span>
      ),
    },
    {
      id: "action",
      header: "التسوية",
      headClassName: "text-end",
      className: "text-end",
      cell: (row) => (
        <ConfirmButton
          rowId={row.driverId}
          armed={armed}
          busy={pending && busyId === row.driverId}
          disabled={pending}
          label={financeCopy.receive}
          confirmLabel={financeCopy.confirmReceive}
          onArm={setArmed}
          onRun={(id) =>
            run(
              id,
              settleDriverCash,
              "تم استلام العهدة وتصفير الحساب",
              (amount) => `أُضيف ${formatMoney(amount)} إلى خزينة الشركة.`,
            )
          }
        />
      ),
    },
  ];

  const payoutColumns: DataColumn<MerchantPayoutRow>[] = [
    {
      id: "name",
      header: "التاجر",
      className: "whitespace-normal font-medium",
      cell: (row) => row.name,
    },
    {
      id: "balance",
      header: "الرصيد الحالي",
      headClassName: "text-end",
      className: "text-end",
      cell: (row) => (
        <span dir="ltr" className="font-medium text-emerald-700 tabular-nums">
          {formatMoney(row.balance)}
        </span>
      ),
    },
    {
      id: "action",
      header: "التحويل",
      headClassName: "text-end",
      className: "text-end",
      cell: (row) => (
        <ConfirmButton
          rowId={row.merchantId}
          armed={armed}
          busy={pending && busyId === row.merchantId}
          disabled={pending}
          label={financeCopy.markPaid}
          confirmLabel={financeCopy.confirmPayout}
          onArm={setArmed}
          onRun={(id) =>
            run(
              id,
              payoutMerchant,
              "تم تسجيل التحويل",
              (amount) => `خُصم ${formatMoney(amount)} ببيان «تحويل أرباح للتاجر».`,
            )
          }
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {view.migrationApplied ? null : (
        <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {FINANCE_ERROR_MESSAGES.migration_pending}
        </p>
      )}

      <Tabs defaultValue="custody" className="gap-6">
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
          <TabsTrigger value="custody" className="px-4 py-2">
            {financeCopy.custodyTab}
            <span className="text-muted-foreground tabular-nums">{view.custody.length}</span>
          </TabsTrigger>
          <TabsTrigger value="payouts" className="px-4 py-2">
            {financeCopy.payoutsTab}
            <span className="text-muted-foreground tabular-nums">{view.payouts.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="custody">
          <Card>
            <CardHeader>
              <CardTitle>{financeCopy.custodyTitle}</CardTitle>
              <CardDescription>
                المناديب الذين يحملون نقدية من التحصيل. الاستلام يُضيف المبلغ إلى خزينة الشركة
                ويصفّر العهدة.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={custodyColumns}
                rows={view.custody}
                rowKey={(row) => row.driverId}
                empty="لا توجد عهدة نقدية بانتظار التسوية."
                caption="عهدة المناديب"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payouts">
          <Card>
            <CardHeader>
              <CardTitle>{financeCopy.payoutsTitle}</CardTitle>
              <CardDescription>
                محافظ التجار ذات الرصيد الموجب. التسجيل كمدفوع يخصم الرصيد كاملًا ببيان «تحويل
                أرباح للتاجر».
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={payoutColumns}
                rows={view.payouts}
                rowKey={(row) => row.merchantId}
                empty="لا توجد أرصدة تجار بانتظار التحويل."
                caption="مستحقات التجار"
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
