/**
 * Sudan-first launch constants. Egypt is postponed; new defaults are SDG,
 * +249, and Africa/Khartoum. Wallet and order columns still store the ISO
 * currency code so a later country can be added without a rewrite.
 */

export const CURRENCY_CODE = "SDG";
export const CURRENCY_AR = "ج.س";
export const COUNTRY_CODE = "SD";
export const CALLING_CODE = "+249";
export const PHONE_PLACEHOLDER = "0912345678";
export const TIME_ZONE = "Africa/Khartoum";

/** Cash a new driver may hold before COD dispatch is refused. */
export const DEFAULT_MAX_CASH_SDG = 300_000;
/** Charged on pickup until the merchant reaches the free threshold. */
export const DEFAULT_PICKUP_FEE_SDG = 2_000;
export const DEFAULT_PICKUP_FREE_FROM = 3;

export const VEHICLE_TYPES = ["موتوسيكل", "سيارة فان", "سيارة ملاكي"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const KYC_STATUSES = ["pending", "verified", "rejected"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const KYC_STATUS_LABEL: Record<KycStatus, string> = {
  pending: "قيد المراجعة",
  verified: "موثّق",
  rejected: "مرفوض",
};

export const SUDAN_HUBS = [
  "ولاية الخرطوم - المخزن الرئيسي",
  "أم درمان",
  "الخرطوم بحري",
  "بورتسودان",
  "ود مدني",
] as const;

export function isVehicleType(value: unknown): value is VehicleType {
  return typeof value === "string" && (VEHICLE_TYPES as readonly string[]).includes(value);
}

/**
 * What the screen shows. The stored value stays "موتوسيكل" so the database
 * check and existing profiles keep matching.
 */
export function vehicleLabel(type: VehicleType, locale: "ar" | "en" = "ar"): string {
  if (type === "موتوسيكل") return locale === "en" ? "Motorcycle" : "دراجة نارية";
  if (locale === "en") return type === "سيارة فان" ? "Van" : "Sedan";
  return type;
}

export function isKycStatus(value: unknown): value is KycStatus {
  return typeof value === "string" && (KYC_STATUSES as readonly string[]).includes(value);
}

/** True when the driver is holding more cash than their ceiling allows. */
export function cashCustodyExceeded(current: number, max: number): boolean {
  return Number.isFinite(current) && Number.isFinite(max) && max >= 0 && current > max;
}

export function formatSdg(amount: number): string {
  const grouped = Math.trunc(amount).toLocaleString("en-GB");
  return `${grouped} ${CURRENCY_AR}`;
}
