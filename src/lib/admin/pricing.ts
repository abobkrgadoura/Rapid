import {
  DEFAULT_MAX_CASH_SDG,
  DEFAULT_PICKUP_FEE_SDG,
  DEFAULT_PICKUP_FREE_FROM,
} from "@/lib/locale/sudan";
import { SUDAN_LAUNCH_ZONES } from "@/lib/pricing/fees";

export type ZoneDraft = {
  stateName: string;
  cityName: string;
  feeSdg: number;
  isActive: boolean;
};

export type PricingSettings = {
  pickupFeeSdg: number;
  pickupFeeFreeFrom: number;
  defaultMaxCashSdg: number;
  zones: ZoneDraft[];
};

export type SettingsSnapshot = {
  migrationApplied: boolean;
  pricing: PricingSettings;
};

export function defaultPricing(): PricingSettings {
  return {
    pickupFeeSdg: DEFAULT_PICKUP_FEE_SDG,
    pickupFeeFreeFrom: DEFAULT_PICKUP_FREE_FROM,
    defaultMaxCashSdg: DEFAULT_MAX_CASH_SDG,
    zones: SUDAN_LAUNCH_ZONES.map((zone) => ({ ...zone })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function whole(value: unknown, max: number): number | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits || digits.length > 9) return null;
  const amount = Number(digits);
  if (!Number.isInteger(amount) || amount < 0 || amount > max) return null;
  return amount;
}

export function cleanPricingInput(
  input: unknown,
): { zones: ZoneDraft[]; pickupFeeSdg: number; freeFrom: number } | null {
  if (!isRecord(input) || !Array.isArray(input.zones)) return null;
  if (input.zones.length > 40) return null;
  const pickupFeeSdg = whole(input.pickupFeeSdg, 10_000_000);
  const freeFrom = whole(input.freeFrom, 100);
  if (pickupFeeSdg === null || freeFrom === null || freeFrom < 1) return null;

  const zones: ZoneDraft[] = [];
  const seen = new Set<string>();
  for (const item of input.zones) {
    if (!isRecord(item)) return null;
    const stateName = typeof item.stateName === "string" ? item.stateName.trim() : "";
    const cityName = typeof item.cityName === "string" ? item.cityName.trim() : "";
    const feeSdg = whole(item.feeSdg, 10_000_000);
    if (stateName.length < 2 || stateName.length > 80 || cityName.length > 80 || feeSdg === null) {
      return null;
    }
    const key = `${stateName}\n${cityName}`;
    if (seen.has(key)) return null;
    seen.add(key);
    zones.push({
      stateName,
      cityName,
      feeSdg,
      isActive: item.isActive !== false,
    });
  }

  return { zones, pickupFeeSdg, freeFrom };
}

export function cleanFleetInput(input: unknown): number | null {
  if (!isRecord(input)) return null;
  return whole(input.defaultMaxCashSdg, 100_000_000);
}
