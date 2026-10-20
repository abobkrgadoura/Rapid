import { getAuthSession } from "@/lib/auth/session";
import { canonicalMoney, sumMoney } from "@/lib/format-money";
import { parseSignedMoneyCents } from "@/lib/money";
import { isOrderStatus } from "@/lib/orders/status";
import { createClient } from "@/utils/supabase/server";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AdminMetrics = {
  revenue: string;
  activeDrivers: number;
  pendingOrders: number;
};

export type DriverWalletRow = {
  id: string;
  driverName: string;
  employmentType: "freelance" | "in_house" | null;
  balance: string;
  currency: string;
};

export type LoadResult<T> = { ok: true; data: T } | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID.test(value)) return null;
  return value.toLowerCase();
}

export async function loadAdminMetrics(): Promise<LoadResult<AdminMetrics>> {
  const session = await getAuthSession();
  if (session.status !== "ready" || session.profile.role !== "admin") {
    return { ok: false };
  }

  const supabase = await createClient();
  const [drivers, pending, commissions] = await Promise.all([
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "driver"),
    supabase
      .from("orders_readable")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase.from("orders_readable").select("status, platform_commission"),
  ]);

  if (drivers.error || pending.error || commissions.error) {
    console.error(
      "admin metrics",
      drivers.error?.message,
      pending.error?.message,
      commissions.error?.message,
    );
    return { ok: false };
  }

  if (
    drivers.count === null ||
    pending.count === null ||
    !Array.isArray(commissions.data)
  ) {
    return { ok: false };
  }

  const included: string[] = [];
  for (const row of commissions.data) {
    if (!isRecord(row) || !isOrderStatus(row.status)) return { ok: false };
    if (row.status === "cancelled") continue;
    const amount = canonicalMoney(row.platform_commission);
    if (amount === null) return { ok: false };
    included.push(amount);
  }

  const revenue = sumMoney(included);
  if (revenue === null) return { ok: false };

  return {
    ok: true,
    data: {
      revenue,
      activeDrivers: drivers.count,
      pendingOrders: pending.count,
    },
  };
}

export async function loadDriverWallets(): Promise<
  LoadResult<DriverWalletRow[]>
> {
  const session = await getAuthSession();
  if (session.status !== "ready" || session.profile.role !== "admin") {
    return { ok: false };
  }

  const supabase = await createClient();
  const wallets = await supabase
    .from("wallets")
    .select("id, driver_id, balance, currency");

  if (wallets.error || !Array.isArray(wallets.data)) {
    console.error("admin wallets", wallets.error?.message);
    return { ok: false };
  }

  const driverIds = [
    ...new Set(
      wallets.data
        .map((row) => (isRecord(row) ? uuid(row.driver_id) : null))
        .filter((id): id is string => id !== null),
    ),
  ];

  const names = new Map<
    string,
    { name: string; employmentType: DriverWalletRow["employmentType"] }
  >();

  if (driverIds.length > 0) {
    const profiles = await supabase
      .from("profiles")
      .select("id, full_name, email, employment_type")
      .in("id", driverIds);

    if (profiles.error || !Array.isArray(profiles.data)) {
      console.error("admin wallet drivers", profiles.error?.message);
      return { ok: false };
    }

    for (const row of profiles.data) {
      if (!isRecord(row)) continue;
      const id = uuid(row.id);
      if (!id) continue;
      const fullName =
        typeof row.full_name === "string" ? row.full_name.trim() : "";
      const email = typeof row.email === "string" ? row.email.trim() : "";
      const employmentType =
        row.employment_type === "freelance" || row.employment_type === "in_house"
          ? row.employment_type
          : null;
      names.set(id, {
        name: fullName || email || "Unnamed driver",
        employmentType,
      });
    }
  }

  const rows: DriverWalletRow[] = [];
  for (const row of wallets.data) {
    if (!isRecord(row)) return { ok: false };
    const id = uuid(row.id);
    const driverId = uuid(row.driver_id);
    const balance = canonicalMoney(row.balance);
    if (!id || !driverId || balance === null) return { ok: false };

    const currency =
      typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency)
        ? row.currency
        : "SDG";
    const driver = names.get(driverId);

    rows.push({
      id,
      driverName: driver?.name ?? "Unnamed driver",
      employmentType: driver?.employmentType ?? null,
      balance,
      currency,
    });
  }

  rows.sort((left, right) => {
    const leftCents = parseSignedMoneyCents(left.balance) ?? BigInt(0);
    const rightCents = parseSignedMoneyCents(right.balance) ?? BigInt(0);
    if (leftCents !== rightCents) return leftCents < rightCents ? -1 : 1;
    return left.driverName.localeCompare(right.driverName);
  });

  return { ok: true, data: rows };
}
