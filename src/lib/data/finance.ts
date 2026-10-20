import { getAuthSession } from "@/lib/auth/session";
import type {
  AdminFinanceView,
  DriverCustodyRow,
  LedgerRow,
  MerchantPayoutRow,
  MerchantWalletView,
} from "@/lib/finance/types";
import { canonicalMoney, sumMoney } from "@/lib/format-money";
import { TIME_ZONE } from "@/lib/locale/sudan";
import { parseSignedMoneyCents } from "@/lib/money";
import { createClient } from "@/utils/supabase/server";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UNDEFINED_COLUMN = "42703";
const UNDEFINED_TABLE = "42P01";

const ledgerTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});

const DESCRIPTIONS: Record<string, string> = {
  settlement: "تحصيل شحنة",
  payout: "سحب أرباح",
  adjustment: "خصم رسوم شحن",
  cod_debt: "خصم رسوم شحن",
  prepaid_earning: "تحصيل شحنة",
};

export type LoadResult<T> = { ok: true; data: T } | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID.test(value)) return null;
  return value.toLowerCase();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function displayName(row: Record<string, unknown>, fallback: string): string {
  return text(row.company_name) || text(row.full_name) || text(row.email) || fallback;
}

function schemaMissing(code: string | undefined): boolean {
  return code === UNDEFINED_COLUMN || code === UNDEFINED_TABLE;
}

function describe(type: unknown, description: unknown): string {
  const written = text(description);
  if (written) return written;
  if (typeof type === "string" && DESCRIPTIONS[type]) return DESCRIPTIONS[type];
  return "حركة مالية";
}

function formatWhen(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return ledgerTime.format(date);
}

function trackingOf(value: unknown): string | null {
  if (Array.isArray(value)) return trackingOf(value[0]);
  if (!isRecord(value)) return null;
  const code = text(value.tracking_code);
  return code || null;
}

function compareMoneyDesc(left: string, right: string): number {
  const leftCents = parseSignedMoneyCents(left) ?? BigInt(0);
  const rightCents = parseSignedMoneyCents(right) ?? BigInt(0);
  if (leftCents === rightCents) return 0;
  return leftCents < rightCents ? 1 : -1;
}

export async function loadMerchantWallet(): Promise<LoadResult<MerchantWalletView>> {
  const session = await getAuthSession();
  if (session.status !== "ready" || session.profile.role !== "merchant") {
    return { ok: false };
  }

  const supabase = await createClient();
  const merchantId = session.profile.id;

  const [probe, pendingOrders] = await Promise.all([
    supabase.from("wallets").select("kind").limit(1),
    supabase
      .from("orders_readable")
      .select("product_price")
      .eq("merchant_id", merchantId)
      .eq("status", "in_transit")
      .eq("payment_type", "cod"),
  ]);

  if (probe.error && !schemaMissing(probe.error.code)) {
    console.error("merchant wallet probe", probe.error.code, probe.error.message);
    return { ok: false };
  }
  if (pendingOrders.error || !Array.isArray(pendingOrders.data)) {
    console.error("merchant pending cod", pendingOrders.error?.message);
    return { ok: false };
  }

  const pendingParts: string[] = [];
  for (const row of pendingOrders.data) {
    if (!isRecord(row)) return { ok: false };
    const price = canonicalMoney(row.product_price);
    if (price === null) return { ok: false };
    pendingParts.push(price);
  }
  const pending = sumMoney(pendingParts);
  if (pending === null) return { ok: false };

  const migrationApplied = !probe.error;
  const empty: MerchantWalletView = {
    migrationApplied,
    available: "0.00",
    pending,
    revenue: "0.00",
    pendingWithdrawal: null,
    transactions: [],
  };
  if (!migrationApplied) return { ok: true, data: empty };

  const wallet = await supabase
    .from("wallets")
    .select("id, balance, currency")
    .eq("merchant_id", merchantId)
    .eq("kind", "merchant")
    .maybeSingle();

  if (wallet.error) {
    console.error("merchant wallet", wallet.error.code, wallet.error.message);
    return { ok: false };
  }
  if (!wallet.data || !isRecord(wallet.data)) {
    return { ok: true, data: empty };
  }

  const walletId = uuid(wallet.data.id);
  const available = canonicalMoney(wallet.data.balance);
  if (!walletId || available === null) return { ok: false };

  const [entries, creditsQuery, openRequest] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, created_at, type, amount, balance_after, description, orders(tracking_code)")
      .eq("wallet_id", walletId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("transactions")
      .select("amount")
      .eq("wallet_id", walletId)
      .gt("amount", 0)
      .limit(5000),
    supabase
      .from("withdrawal_requests")
      .select("amount")
      .eq("merchant_id", merchantId)
      .eq("status", "pending")
      .maybeSingle(),
  ]);

  if (entries.error || !Array.isArray(entries.data)) {
    console.error("merchant ledger", entries.error?.message);
    return { ok: false };
  }
  if (creditsQuery.error || !Array.isArray(creditsQuery.data)) {
    console.error("merchant revenue", creditsQuery.error?.message);
    return { ok: false };
  }
  if (openRequest.error && !schemaMissing(openRequest.error.code)) {
    console.error("merchant withdrawal", openRequest.error.code, openRequest.error.message);
    return { ok: false };
  }

  const credits: string[] = [];
  for (const row of creditsQuery.data) {
    if (!isRecord(row)) return { ok: false };
    const amount = canonicalMoney(row.amount);
    if (amount === null) return { ok: false };
    credits.push(amount);
  }

  const transactions: LedgerRow[] = [];
  for (const row of entries.data) {
    if (!isRecord(row)) return { ok: false };
    const id = uuid(row.id);
    const createdAt = formatWhen(row.created_at);
    const amount = canonicalMoney(row.amount);
    const balanceAfter = canonicalMoney(row.balance_after);
    if (!id || !createdAt || amount === null || balanceAfter === null) return { ok: false };
    transactions.push({
      id,
      createdAt,
      trackingCode: trackingOf(row.orders),
      description: describe(row.type, row.description),
      amount,
      balanceAfter,
    });
  }

  const revenue = sumMoney(credits);
  if (revenue === null) return { ok: false };

  let pendingWithdrawal: string | null = null;
  if (openRequest.data && isRecord(openRequest.data)) {
    pendingWithdrawal = canonicalMoney(openRequest.data.amount);
    if (pendingWithdrawal === null) return { ok: false };
  }

  return {
    ok: true,
    data: {
      migrationApplied: true,
      available,
      pending,
      revenue,
      pendingWithdrawal,
      transactions,
    },
  };
}

export async function loadAdminFinance(): Promise<LoadResult<AdminFinanceView>> {
  const session = await getAuthSession();
  if (session.status !== "ready" || session.profile.role !== "admin") {
    return { ok: false };
  }

  const supabase = await createClient();
  const probe = await supabase.from("wallets").select("kind").eq("kind", "vault").limit(1);
  if (probe.error && !schemaMissing(probe.error.code)) {
    console.error("finance probe", probe.error.code, probe.error.message);
    return { ok: false };
  }

  const migrationApplied = !probe.error;
  const [drivers, merchantWallets] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, hub_zone, current_cash_in_hand")
      .eq("role", "driver")
      .gt("current_cash_in_hand", 0),
    migrationApplied
      ? supabase
          .from("wallets")
          .select("merchant_id, balance")
          .eq("kind", "merchant")
          .gt("balance", 0)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (drivers.error) {
    if (schemaMissing(drivers.error.code)) {
      return { ok: true, data: { migrationApplied: false, custody: [], payouts: [] } };
    }
    console.error("finance custody", drivers.error.code, drivers.error.message);
    return { ok: false };
  }
  if (merchantWallets.error || !Array.isArray(drivers.data) || !Array.isArray(merchantWallets.data)) {
    console.error("finance payouts", merchantWallets.error?.message);
    return { ok: false };
  }

  const custody: DriverCustodyRow[] = [];
  for (const row of drivers.data) {
    if (!isRecord(row)) return { ok: false };
    const driverId = uuid(row.id);
    const cash = canonicalMoney(row.current_cash_in_hand);
    if (!driverId || cash === null) return { ok: false };
    const cents = parseSignedMoneyCents(cash);
    if (cents === null || cents <= BigInt(0)) continue;
    custody.push({
      driverId,
      name: displayName(row, "مندوب"),
      zone: text(row.hub_zone) || "غير محددة",
      cashInHand: cash,
    });
  }
  custody.sort((left, right) => {
    const byCash = compareMoneyDesc(left.cashInHand, right.cashInHand);
    return byCash !== 0 ? byCash : left.name.localeCompare(right.name, "ar");
  });

  const payouts: MerchantPayoutRow[] = [];
  if (migrationApplied && merchantWallets.data.length > 0) {
    const ids = merchantWallets.data
      .map((row) => (isRecord(row) ? uuid(row.merchant_id) : null))
      .filter((id): id is string => id !== null);

    if (ids.length === 0) return { ok: false };

    const profiles = await supabase
      .from("profiles")
      .select("id, full_name, company_name, email")
      .in("id", ids);

    if (profiles.error || !Array.isArray(profiles.data)) {
      console.error("finance merchants", profiles.error?.message);
      return { ok: false };
    }

    const names = new Map<string, string>();
    for (const row of profiles.data) {
      if (!isRecord(row)) continue;
      const id = uuid(row.id);
      if (id) names.set(id, displayName(row, "تاجر"));
    }

    for (const row of merchantWallets.data) {
      if (!isRecord(row)) return { ok: false };
      const merchantId = uuid(row.merchant_id);
      const balance = canonicalMoney(row.balance);
      if (!merchantId || balance === null) return { ok: false };
      const cents = parseSignedMoneyCents(balance);
      if (cents === null || cents <= BigInt(0)) continue;
      payouts.push({
        merchantId,
        name: names.get(merchantId) ?? "تاجر",
        balance,
      });
    }
    payouts.sort((left, right) => {
      const byBalance = compareMoneyDesc(left.balance, right.balance);
      return byBalance !== 0 ? byBalance : left.name.localeCompare(right.name, "ar");
    });
  }

  return { ok: true, data: { migrationApplied, custody, payouts } };
}
