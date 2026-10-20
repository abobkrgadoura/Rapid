import { DataTable, type DataColumn } from "@/components/data-table";
import { PlaceholderAction } from "@/components/placeholder-action";
import { Badge } from "@/components/ui/badge";
import type { DriverWalletRow } from "@/lib/data/admin-dashboard";
import { formatMoney } from "@/lib/format-money";
import { parseSignedMoneyCents } from "@/lib/money";

function employmentLabel(
  employmentType: DriverWalletRow["employmentType"],
): string {
  if (employmentType === "freelance") return "مستقل";
  if (employmentType === "in_house") return "موظف بالشركة";
  return "مندوب";
}

function balanceMeaning(cents: bigint): string {
  if (cents > BigInt(0)) return "المنصة مدينة للمندوب";
  if (cents < BigInt(0)) return "المندوب مدين للمنصة";
  return "مُسوّى";
}

const columns: DataColumn<DriverWalletRow>[] = [
  {
    id: "driver",
    header: "المندوب",
    className: "whitespace-normal",
    cell: (row) => (
      <div className="flex min-w-40 flex-col gap-1">
        <span className="font-medium">{row.driverName}</span>
        <Badge variant="outline" className="w-fit">
          {employmentLabel(row.employmentType)}
        </Badge>
      </div>
    ),
  },
  {
    id: "balance",
    header: "الرصيد",
    headClassName: "text-end",
    className: "text-end",
    cell: (row) => {
      const cents = parseSignedMoneyCents(row.balance) ?? BigInt(0);
      const tone =
        cents < BigInt(0)
          ? "text-destructive"
          : cents > BigInt(0)
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-muted-foreground";

      return (
        <div className="flex flex-col items-end gap-1">
          <span dir="ltr" className={`font-medium tabular-nums ${tone}`}>
            {formatMoney(row.balance, row.currency)}
          </span>
          <span className="text-muted-foreground text-xs">
            {balanceMeaning(cents)}
          </span>
        </div>
      );
    },
  },
  {
    id: "action",
    header: "التسوية",
    headClassName: "text-end",
    className: "text-end",
    cell: (row) => {
      const cents = parseSignedMoneyCents(row.balance) ?? BigInt(0);
      if (cents >= BigInt(0)) {
        return <span className="text-muted-foreground text-xs">—</span>;
      }

      return (
        <div className="flex justify-end">
          <PlaceholderAction
            label="تسوية الرصيد"
            note="تسجيل التسوية غير مربوط بهذه الشاشة بعد."
            size="sm"
            align="end"
          />
        </div>
      );
    },
  },
];

export function DriverWalletsTable({ rows }: { rows: DriverWalletRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      empty="لا توجد محافظ مناديب بعد."
      caption="محافظ المناديب والأرصدة"
    />
  );
}
