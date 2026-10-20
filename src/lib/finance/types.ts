/**
 * Shapes shared by the finance server actions and the merchant / admin
 * screens. Kept out of the "use server" file, which may only export async
 * functions.
 */

export type FinanceError =
  | "unauthorized"
  | "forbidden"
  | "invalid"
  | "not_found"
  | "insufficient"
  | "conflict"
  | "migration_pending"
  | "failed";

export type FinanceResult =
  | { ok: true; amount: string }
  | { ok: false; error: FinanceError };

export const FINANCE_ERROR_MESSAGES: Record<FinanceError, string> = {
  unauthorized: "انتهت الجلسة. سجّل الدخول من جديد.",
  forbidden: "حسابك لا يملك صلاحية تنفيذ هذا الإجراء.",
  invalid: "لا يمكن تنفيذ الحركة على هذا الرصيد.",
  not_found: "لم يُعثر على المحفظة أو الحساب.",
  insufficient: "لا يوجد رصيد متاح لهذه الحركة.",
  conflict: "يوجد طلب سحب قيد المراجعة بالفعل.",
  migration_pending:
    "طبّق ملف 0009_phase12_financial_engine.sql أولاً حتى تعمل التسويات ومحافظ التجار.",
  failed: "حدث خطأ غير متوقع. حاول مرة أخرى.",
};

export type LedgerRow = {
  id: string;
  createdAt: string;
  trackingCode: string | null;
  description: string;
  amount: string;
  balanceAfter: string;
};

export type MerchantWalletView = {
  migrationApplied: boolean;
  available: string;
  pending: string;
  revenue: string;
  pendingWithdrawal: string | null;
  transactions: LedgerRow[];
};

export type DriverCustodyRow = {
  driverId: string;
  name: string;
  zone: string;
  cashInHand: string;
};

export type MerchantPayoutRow = {
  merchantId: string;
  name: string;
  balance: string;
};

export type AdminFinanceView = {
  migrationApplied: boolean;
  custody: DriverCustodyRow[];
  payouts: MerchantPayoutRow[];
};
