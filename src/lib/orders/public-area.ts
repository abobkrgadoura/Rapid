import { isRecipientPhone } from "@/lib/orders/recipient";

/** Shown when the dropoff has no city or zone that is safe to publish. */
export const PUBLIC_AREA_FALLBACK = "منطقة التوصيل";

const SENSITIVE =
  /(شارع|شقه|شقة|شقق|طابق|طوابق|مبنى|مباني|مبني|عمارة|عمارات|عماره|برج|حارة|حاره|فيلا|منزل|الدور|أدوار|فوق|بجوار|أمام|امام|خلف|رقم|apartment|flat|floor|floors|building|bldg|street|road|suite|unit|villa|above|beside|opposite|behind)/i;

const STANDALONE = /(^|\s)(دور|عند)(\s|$)/;

/**
 * A published area is a short place name. Street, unit, landmark, phone, and
 * URL text fail closed so a buggy lookup cannot render them.
 */
export function isSafeAreaPiece(piece: string): boolean {
  const value = piece.trim();
  if (value.length < 2 || value.length > 48) return false;
  if (!/[A-Za-zء-ي].*[A-Za-zء-ي]/.test(value)) return false;
  if (/https?:|www\.|maps\.|goo\.gl|waze|gps|@|\+/i.test(value)) return false;

  const western = value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
  const digits = western.replace(/\D/g, "");
  if (digits.length > 2) return false;
  if (SENSITIVE.test(value) || STANDALONE.test(value)) return false;
  return true;
}

export function isPublicAreaSummary(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === PUBLIC_AREA_FALLBACK) return true;
  return isSafeAreaPiece(trimmed);
}

/**
 * City or zone from a stored dropoff blob. Name, phone, street, floor, and
 * apartment lines are dropped. The raw address is never returned.
 */
export function publicAreaFromDropoff(stored: string): string {
  const parts = stored.split(/\r?\n/);
  let index = 0;
  if (parts.length >= 3 && isRecipientPhone((parts[1] ?? "").trim())) {
    index = 2;
    if (parts.length >= 4 && /^alt:/i.test((parts[2] ?? "").trim())) index = 3;
  }

  const body = parts
    .slice(index)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^(ref|item|back):/i.test(line))
    .join(" ");

  for (const piece of body.split(/[,،;؛]+/)) {
    if (isSafeAreaPiece(piece)) return piece.trim();
  }
  return PUBLIC_AREA_FALLBACK;
}

export function publishAreaSummary(value: unknown): string {
  if (typeof value !== "string") return PUBLIC_AREA_FALLBACK;
  const trimmed = value.trim();
  return isPublicAreaSummary(trimmed) ? trimmed : PUBLIC_AREA_FALLBACK;
}
