"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, Banknote, Clock3, Loader2, Wallet } from "lucide-react";

import { requestMerchantPayout } from "@/actions/finance";
import { DataTable, type DataColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toastError, toastSuccess } from "@/components/ui/toast";
import { FINANCE_ERROR_MESSAGES, type LedgerRow, type MerchantWalletView } from "@/lib/finance/types";
import { formatMoney } from "@/lib/format-money";
import { parseSignedMoneyCents } from "@/lib/money";

function tone(amount: string): string {
  const cents = parseSignedMoneyCents(amount) ?? BigInt(0);
  if (cents > BigInt(0)) return "text-emerald-700";
  if (cents < BigInt(0)) return "text-red-600";
  return "text-zinc-500";
}

function signed(amount: string): string {
  const cents = parseSignedMoneyCents(amount) ?? BigInt(0);
  const text = formatMoney(amount);
  return cents > BigInt(0) ? `+${text}` : text;
}

const columns: DataColumn<LedgerRow>[] = [
  {
    id: "when",
    header: "التاريخ",
    cell: (row) => (
      <span dir="ltr" className="tabular-nums">
        {row.createdAt}
      </span>
    ),
  },
  {
    id: "order",
    header: "الشحنة",
    cell: (row) =>
      row.trackingCode ? (
        <span dir="ltr" className="font-mono text-xs font-medium">
          {row.trackingCode}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "description",
    header: "البيان",
    className: "whitespace-normal",
    cell: (row) => row.description,
  },
  {
    id: "amount",
    header: "المبلغ",
    headClassName: "text-end",
    className: "text-end",
    cell: (row) => (
      <span dir="ltr" className={`font-medium tabular-nums ${tone(row.amount)}`}>
        {signed(row.amount)}
      </span>
    ),
  },
  {
    id: "after",
    header: "الرصيد بعد الحركة",
    headClassName: "text-end",
    className: "text-end",
    cell: (row) => (
      <span dir="ltr" className="tabular-nums">
        {formatMoney(row.balanceAfter)}
      </span>
    ),
  },
];

export function WalletDashboard({ view }: { view: MerchantWalletView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const availableCents = parseSignedMoneyCents(view.available) ?? BigInt(0);
  const canRequest = view.migrationApplied && availableCents > BigInt(0) && !view.pendingWithdrawal;

  function requestPayout() {
    if (pending || !canRequest) return;
    startTransition(async () => {
      try {
        const result = await requestMerchantPayout();
        if (!result.ok) {
          toastError("تعذّر طلب السحب", FINANCE_ERROR_MESSAGES[result.error]);
          return;
        }
        toastSuccess("تم تسجيل طلب السحب", `المبلغ ${formatMoney(result.amount)} بانتظار تحويل الإدارة.`);
        router.refresh();
      } catch {
        toastError("تعذّر طلب السحب", FINANCE_ERROR_MESSAGES.failed);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">المحفظة</h1>
          <p className="text-muted-foreground text-sm">
            مستحقاتك من التحصيل، ورسوم الشحن، وطلبات السحب. العملة بالجنيه السوداني.
          </p>
        </div>
        <Button
          type="button"
          variant="brand"
          className="h-10 px-4"
          disabled={!canRequest || pending}
          onClick={requestPayout}
        >
          {pending ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}
          طلب سحب رصيد
        </Button>
      </div>

      {view.migrationApplied ? null : (
        <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {FINANCE_ERROR_MESSAGES.migration_pending} الرصيد المعلق أدناه يُحسب من الشحنات الحالية.
        </p>
      )}

      {view.pendingWithdrawal ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          طلب سحب بمبلغ{" "}
          <span dir="ltr" className="font-semibold tabular-nums">
            {formatMoney(view.pendingWithdrawal)}
          </span>{" "}
          قيد المراجعة. يُخصم الرصيد عندما تسجّله الإدارة كمدفوع.
        </p>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="relative overflow-hidden rounded-2xl bg-indigo-950 p-6 text-white shadow-lg shadow-indigo-950/20">
          <div className="absolute -top-10 -left-8 size-36 rounded-full bg-indigo-400/20" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-indigo-100/80">الرصيد المتاح للسحب</p>
              <p dir="ltr" className="text-start text-3xl font-semibold tracking-tight tabular-nums">
                {formatMoney(view.available)}
              </p>
            </div>
            <span className="flex size-10 items-center justify-center rounded-xl bg-white/10">
              <Wallet className="size-5" />
            </span>
          </div>
          <p className="relative mt-4 text-xs text-indigo-100/70">صافي الحركات المُسوّاة في الدفتر.</p>
        </article>

        <Card className="border-amber-200/80 bg-amber-50/60">
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              <CardDescription>رصيد معلق</CardDescription>
              <CardTitle dir="ltr" className="text-start text-2xl tabular-nums text-amber-950">
                {formatMoney(view.pending)}
              </CardTitle>
            </div>
            <span className="flex size-10 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
              <Clock3 className="size-5" />
            </span>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-amber-900/80">
              قيمة بضاعة الدفع عند الاستلام للشحنات التي ما زالت في الطريق.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              <CardDescription>إجمالي المبيعات</CardDescription>
              <CardTitle dir="ltr" className="text-start text-2xl tabular-nums">
                {formatMoney(view.revenue)}
              </CardTitle>
            </div>
            <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-xl">
              <Banknote className="size-5" />
            </span>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-xs">مجموع تحصيلات الشحنات المُرحّلة إلى الدفتر.</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>سجل الحركات</CardTitle>
          <CardDescription>تحصيل الشحنة، وخصم رسوم الشحن، وسحب الأرباح.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            rows={view.transactions}
            rowKey={(row) => row.id}
            empty="لا توجد حركات مالية بعد. تظهر هنا بعد تسليم الشحنات."
            caption="سجل محفظة التاجر"
          />
        </CardContent>
      </Card>
    </div>
  );
}
