import type { AwbLanguage } from "@/lib/merchant/settings";

export type AwbAddressParts = {
  street: string;
  buildingName?: string | null;
  floorNumber?: string | null;
  apartmentNumber?: string | null;
};

/**
 * Street, building, floor, and apartment on one AWB address line.
 * Floor and apartment are printed with a short label so a bare number
 * still reads as a floor or a flat.
 */
export function composeAwbAddress(parts: AwbAddressParts, language: AwbLanguage): string {
  const joiner = language === "ar" ? "، " : ", ";
  const bits: string[] = [];
  const street = parts.street.trim();
  if (street) bits.push(street);

  const building = parts.buildingName?.trim() ?? "";
  if (building) bits.push(building);

  const floor = parts.floorNumber?.trim() ?? "";
  if (floor) {
    const labeled =
      language === "ar"
        ? floor.startsWith("الدور")
        : /^floor\b/i.test(floor);
    bits.push(labeled ? floor : language === "ar" ? `الدور ${floor}` : `floor ${floor}`);
  }

  const apartment = parts.apartmentNumber?.trim() ?? "";
  if (apartment) {
    const labeled =
      language === "ar"
        ? apartment.startsWith("شقة")
        : /^(apt|apartment)\b/i.test(apartment);
    bits.push(labeled ? apartment : language === "ar" ? `شقة ${apartment}` : `apt ${apartment}`);
  }

  return bits.join(joiner);
}

/**
 * The notes row prints delivery notes only. If a private note was folded
 * into that string by mistake, it is removed before the label is drawn.
 */
export function awbPrintedNotes(deliveryNotes: string, internalNotes: string): string {
  const delivery = deliveryNotes.replace(/\s+/g, " ").trim();
  const internal = internalNotes.replace(/\s+/g, " ").trim();
  if (!delivery) return "";
  if (!internal || !delivery.includes(internal)) return delivery;
  return delivery
    .split(internal)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ")
    .trim();
}
