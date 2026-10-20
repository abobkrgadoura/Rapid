import { canonicalMoney } from "@/lib/format-money";

export const PARCEL_SIZES = ["small", "medium", "large", "heavy", "bulky"] as const;

export type ParcelSize = (typeof PARCEL_SIZES)[number];

export const EXCEPTION_REASONS = [
  "no_answer",
  "phone_off",
  "postponed",
  "refused",
  "wrong_address",
] as const;

export type ExceptionReason = (typeof EXCEPTION_REASONS)[number];

export const PARCEL_SIZE_AR: Record<ParcelSize, string> = {
  small: "صغيرة",
  medium: "متوسطة",
  large: "كبيرة",
  heavy: "شحنة ثقيلة",
  bulky: "شحنة ضخمة",
};

export const EXCEPTION_REASON_AR: Record<ExceptionReason, string> = {
  no_answer: "العميل لا يرد",
  phone_off: "الهاتف مغلق",
  postponed: "تأجيل",
  refused: "رفض الاستلام",
  wrong_address: "عنوان خاطئ",
};

export type AttemptProof = {
  reason: ExceptionReason | null;
  failedAttempts: number;
  callLogProofUrl: string | null;
  whatsappProofUrl: string | null;
  doorPhotoProofUrl: string | null;
  distanceMeters: number | null;
  gpsVerified: boolean;
  lastAttemptAt: string | null;
  suspicious: boolean;
};

export type PartialDelivery = {
  deliveredPieces: number | null;
  returnedPieces: number | null;
  collectedAmount: string | null;
};

export type ShipmentExtras = {
  buildingName: string;
  floorNumber: string;
  apartmentNumber: string;
  landmark: string;
  isWorkAddress: boolean;
  parcelSize: ParcelSize;
  piecesCount: number;
  productDescription: string;
  productImageUrl: string | null;
  allowOpening: boolean;
  deliveryNotes: string;
  internalNotes: string;
  attempt: AttemptProof | null;
  partial: PartialDelivery | null;
};

export function isParcelSize(value: unknown): value is ParcelSize {
  return typeof value === "string" && (PARCEL_SIZES as readonly string[]).includes(value);
}

export function isExceptionReason(value: unknown): value is ExceptionReason {
  return typeof value === "string" && (EXCEPTION_REASONS as readonly string[]).includes(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function flag(value: unknown): boolean {
  return value === true;
}

function whole(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

/** https image, or a small png/jpeg/webp data URL. Anything else is dropped. */
export function safeImageSrc(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) {
    if (trimmed.length > 400_000) return null;
    return /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(trimmed)
      ? trimmed
      : null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Reads Phase 13 columns when the query selected them. A row from a database
 * that does not have the columns yet returns null.
 */
export function readShipmentExtras(row: Record<string, unknown>): ShipmentExtras | null {
  if (!("parcel_size" in row) && !("exception_reason" in row)) return null;

  const parcelSize = isParcelSize(row.parcel_size) ? row.parcel_size : "small";
  const pieces = whole(row.pieces_count);
  const failed = whole(row.failed_attempts) ?? 0;
  const reason = isExceptionReason(row.exception_reason) ? row.exception_reason : null;
  const delivered = whole(row.delivered_pieces_count);
  const returned = whole(row.returned_pieces_count);
  const collected = canonicalMoney(row.partial_collected_amount);
  const lastAttemptAt =
    typeof row.last_attempt_at === "string" && !Number.isNaN(new Date(row.last_attempt_at).getTime())
      ? row.last_attempt_at
      : null;

  const attempt: AttemptProof | null =
    reason || failed > 0
      ? {
          reason,
          failedAttempts: Math.max(0, failed),
          callLogProofUrl: safeImageSrc(row.call_log_proof_url),
          whatsappProofUrl: safeImageSrc(row.whatsapp_proof_url),
          doorPhotoProofUrl: safeImageSrc(row.door_photo_proof_url),
          distanceMeters: whole(row.attempt_distance_meters),
          gpsVerified: flag(row.is_gps_verified),
          lastAttemptAt,
          suspicious: flag(row.suspicious_attempt_flag),
        }
      : null;

  const partial: PartialDelivery | null = flag(row.is_partial_delivery)
    ? {
        deliveredPieces: delivered,
        returnedPieces: returned,
        collectedAmount: collected,
      }
    : null;

  return {
    buildingName: text(row.building_name),
    floorNumber: text(row.floor_number),
    apartmentNumber: text(row.apartment_number),
    landmark: text(row.landmark),
    isWorkAddress: flag(row.is_work_address),
    parcelSize,
    piecesCount: pieces !== null && pieces >= 1 && pieces <= 99 ? pieces : 1,
    productDescription: text(row.product_description),
    productImageUrl: safeImageSrc(row.product_image_url),
    allowOpening: flag(row.allow_opening),
    deliveryNotes: text(row.delivery_notes),
    internalNotes: text(row.internal_notes),
    attempt,
    partial,
  };
}
