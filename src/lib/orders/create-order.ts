import {
  ORDER_MONEY_MAX_CENTS,
  canonicalMoney,
} from "@/lib/format-money";
import { parseNonNegativeMoneyCents } from "@/lib/money";
import { readOptionalMapsUrl } from "@/lib/orders/gps-url";
import { isRecipientPhone } from "@/lib/orders/recipient";
import { isParcelSize, type ParcelSize } from "@/lib/orders/shipment-details";
import { isPaymentType, type PaymentType } from "@/lib/orders/status";
import { toLatinDigits } from "@/lib/merchant/settings";

export type OrderIntent = "delivery" | "exchange" | "return";

export function orderIntent(value: unknown): OrderIntent {
  return value === "exchange" || value === "return" ? value : "delivery";
}

export type CreateOrderValues = {
  intent: OrderIntent;
  locale: "ar" | "en";
  customerName: string;
  phone: string;
  secondaryPhone: string;
  originalTracking: string;
  newItemNote: string;
  returnItemNote: string;
  pickupAddress: string;
  returnAddress: string;
  dropoffAddress: string;
  pickupGpsUrl: string;
  dropoffGpsUrl: string;
  productPrice: string;
  deliveryFee: string;
  paymentType: PaymentType;
  buildingName: string;
  floorNumber: string;
  apartmentNumber: string;
  landmark: string;
  isWorkAddress: boolean;
  parcelSize: ParcelSize;
  piecesCount: string;
  productDescription: string;
  productImageUrl: string;
  allowOpening: boolean;
  deliveryNotes: string;
  internalNotes: string;
};

export type CreateOrderField = keyof CreateOrderValues;

export type CreateOrderState = {
  resetKey: number;
  /** Increments on every rejected submit so the form can toast once per try. */
  attempt: number;
  values: CreateOrderValues;
  errors: Partial<Record<CreateOrderField, string>>;
  formError: string | null;
  trackingCode: string | null;
};

export const emptyCreateOrderValues: CreateOrderValues = {
  intent: "delivery",
  locale: "ar",
  customerName: "",
  phone: "",
  secondaryPhone: "",
  originalTracking: "",
  newItemNote: "",
  returnItemNote: "",
  pickupAddress: "",
  returnAddress: "",
  dropoffAddress: "",
  pickupGpsUrl: "",
  dropoffGpsUrl: "",
  productPrice: "",
  deliveryFee: "",
  paymentType: "cod",
  buildingName: "",
  floorNumber: "",
  apartmentNumber: "",
  landmark: "",
  isWorkAddress: false,
  parcelSize: "small",
  piecesCount: "1",
  productDescription: "",
  productImageUrl: "",
  allowOpening: false,
  deliveryNotes: "",
  internalNotes: "",
};

export const initialCreateOrderState: CreateOrderState = {
  resetKey: 0,
  attempt: 0,
  values: emptyCreateOrderValues,
  errors: {},
  formError: null,
  trackingCode: null,
};

/** Seeds the form with the merchant's saved pickup and return locations. */
export function createOrderState(saved?: {
  pickupAddress?: string;
  returnAddress?: string;
  pickupGpsUrl?: string;
} | null): CreateOrderState {
  return {
    ...initialCreateOrderState,
    values: {
      ...emptyCreateOrderValues,
      pickupAddress: saved?.pickupAddress ?? "",
      returnAddress: saved?.returnAddress ?? "",
      pickupGpsUrl: saved?.pickupGpsUrl ?? "",
    },
  };
}

export type ParsedCreateOrder = {
  intent: OrderIntent;
  customerName: string;
  phone: string;
  secondaryPhone: string;
  originalTracking: string;
  newItemNote: string;
  returnItemNote: string;
  pickupAddress: string;
  returnAddress: string;
  dropoffAddress: string;
  /** Normalized https map link, or null when the merchant left it blank. */
  pickupGpsUrl: string | null;
  dropoffGpsUrl: string | null;
  productPrice: string;
  deliveryFee: string;
  paymentType: PaymentType;
  buildingName: string | null;
  floorNumber: string | null;
  apartmentNumber: string | null;
  landmark: string | null;
  isWorkAddress: boolean;
  parcelSize: ParcelSize;
  piecesCount: number;
  productDescription: string | null;
  productImageUrl: string | null;
  allowOpening: boolean;
  deliveryNotes: string | null;
  internalNotes: string | null;
};

const MAPS_LINK_ERROR =
  "ألصق رابط خرائط (https) من Google أو Waze أو Apple، أو اتركه فارغًا.";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function cleanPersonName(input: string): string | null {
  const value = input.trim().replace(/\s+/g, " ");
  if (value.length < 2 || value.length > 80) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

function cleanAddress(input: string): string | null {
  const value = input.trim().replace(/[^\S\n]+/g, " ");
  if (value.length < 4 || value.length > 240) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return null;
  return value;
}

function cleanMoney(input: string): string | null {
  const cents = parseNonNegativeMoneyCents(input);
  if (cents === null || cents > ORDER_MONEY_MAX_CENTS) return null;
  return canonicalMoney(input.trim());
}

function cleanNote(input: string): string | null {
  const value = input.trim().replace(/\s+/g, " ");
  if (value.length < 2 || value.length > 160) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

function cleanOptionalLine(input: string, max: number): string | null | undefined {
  const value = input.trim().replace(/\s+/g, " ");
  if (value.length === 0) return null;
  if (value.length > max) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

function checked(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "yes" || value === "on" || value === "true";
}

function cleanHttpsUrl(input: string): string | null | undefined {
  const value = input.trim();
  if (value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function cleanTracking(input: string): string | null {
  const value = toLatinDigits(input).trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9-]{4,32}$/.test(value)) return null;
  return value;
}

function copy(locale: "ar" | "en", ar: string, en: string) {
  return locale === "en" ? en : ar;
}

export function readCreateOrderForm(formData: FormData): {
  values: CreateOrderValues;
  parsed: ParsedCreateOrder | null;
  errors: Partial<Record<CreateOrderField, string>>;
} {
  const paymentRaw = field(formData, "paymentType");
  const parcelRaw = field(formData, "parcelSize");
  const intent = orderIntent(field(formData, "intent"));
  const locale = field(formData, "locale") === "en" ? "en" : "ar";
  const text = (ar: string, en: string) => copy(locale, ar, en);
  const values: CreateOrderValues = {
    intent,
    locale,
    customerName: field(formData, "customerName"),
    phone: field(formData, "customerPhone") || field(formData, "phone"),
    secondaryPhone:
      field(formData, "customerSecondaryPhone") || field(formData, "secondaryPhone"),
    originalTracking: field(formData, "originalTracking"),
    newItemNote: field(formData, "newItemNote"),
    returnItemNote: field(formData, "returnItemNote"),
    pickupAddress: field(formData, "pickupAddress"),
    returnAddress: field(formData, "returnAddress"),
    dropoffAddress: field(formData, "dropoffAddress"),
    pickupGpsUrl: field(formData, "pickupGpsUrl"),
    dropoffGpsUrl: field(formData, "dropoffGpsUrl"),
    productPrice: field(formData, "productPrice"),
    deliveryFee: field(formData, "deliveryFee"),
    paymentType: isPaymentType(paymentRaw) ? paymentRaw : "cod",
    buildingName: field(formData, "buildingName"),
    floorNumber: field(formData, "floorNumber"),
    apartmentNumber: field(formData, "apartmentNumber"),
    landmark: field(formData, "landmark"),
    isWorkAddress: checked(formData, "isWorkAddress"),
    parcelSize: isParcelSize(parcelRaw) ? parcelRaw : "small",
    piecesCount: field(formData, "piecesCount") || "1",
    productDescription: field(formData, "productDescription"),
    productImageUrl: field(formData, "productImageUrl"),
    allowOpening: checked(formData, "allowOpening"),
    deliveryNotes: field(formData, "deliveryNotes"),
    internalNotes: field(formData, "internalNotes"),
  };

  const errors: Partial<Record<CreateOrderField, string>> = {};
  const customerName = cleanPersonName(values.customerName);
  const phone = toLatinDigits(values.phone.trim());
  const secondaryRaw = toLatinDigits(values.secondaryPhone.trim());
  const secondaryPhone = secondaryRaw.length === 0 ? "" : secondaryRaw;
  const pickupAddress = cleanAddress(values.pickupAddress);
  const returnRaw = values.returnAddress.trim();
  const dropoffAddress = cleanAddress(values.dropoffAddress);
  const returnAddress =
    intent === "return"
      ? dropoffAddress
      : returnRaw.length === 0
        ? pickupAddress
        : cleanAddress(returnRaw);
  const pickupGps = readOptionalMapsUrl(values.pickupGpsUrl);
  const dropoffGps = readOptionalMapsUrl(values.dropoffGpsUrl);
  const productPrice = cleanMoney(toLatinDigits(values.productPrice).replace(/[٫]/g, "."));
  const deliveryFee = cleanMoney(toLatinDigits(values.deliveryFee).replace(/[٫]/g, "."));
  const originalTracking =
    intent === "return" ? cleanTracking(values.originalTracking) : "";
  const newItemNote = intent === "exchange" ? cleanNote(values.newItemNote) : "";
  const returnItemNote = intent === "exchange" ? cleanNote(values.returnItemNote) : "";
  const buildingName = cleanOptionalLine(values.buildingName, 80);
  const floorNumber = cleanOptionalLine(values.floorNumber, 20);
  const apartmentNumber = cleanOptionalLine(values.apartmentNumber, 20);
  const landmark = cleanOptionalLine(values.landmark, 120);
  const productDescription = cleanOptionalLine(values.productDescription, 240);
  const deliveryNotes = cleanOptionalLine(values.deliveryNotes, 240);
  const internalNotes = cleanOptionalLine(values.internalNotes, 240);
  const productImageUrl = cleanHttpsUrl(values.productImageUrl);
  const piecesRaw = toLatinDigits(values.piecesCount).trim();
  const piecesCount = /^([1-9]|[1-9]\d)$/.test(piecesRaw) ? Number(piecesRaw) : null;
  const parcelSize = isParcelSize(values.parcelSize) ? values.parcelSize : null;

  if (!customerName) {
    errors.customerName = text("اكتب اسم العميل.", "Enter the customer name.");
  }
  if (!isRecipientPhone(phone)) {
    errors.phone = text(
      "اكتب رقمًا سودانيًا بصيغة +249، أو رقمًا مصريًا بصيغة +20. المحلي السوداني 10 أرقام يبدأ بـ 09 أو 01، والمصري 11 رقمًا يبدأ بـ 010 أو 011 أو 012 أو 015.",
      "Enter a Sudan number as +249, or an Egypt number as +20. Local Sudan is 10 digits starting with 09 or 01; local Egypt is 11 digits starting with 010, 011, 012, or 015.",
    );
  }
  if (secondaryPhone.length > 0 && !isRecipientPhone(secondaryPhone)) {
    errors.secondaryPhone = text(
      "اكتب رقمًا ثانيًا بصيغة +249 أو +20، أو اتركه فارغًا.",
      "Enter a second number as +249 or +20, or leave it blank.",
    );
  }
  if (!pickupAddress) {
    errors.pickupAddress =
      intent === "return"
        ? text(
            "اكتب عنوان استلام المرتجع من العميل.",
            "Enter the customer address where the return is picked up.",
          )
        : text(
            "عنوان الاستلام ناقص. أضفه هنا مرة واحدة أو من الإعدادات.",
            "Pickup address is missing. Add it here once, or in settings.",
          );
  }
  if (intent !== "return" && returnRaw.length > 0 && !returnAddress) {
    errors.returnAddress = text(
      "اكتب موقع إرجاع الشحنة (4 أحرف على الأقل).",
      "Enter a return location (at least 4 characters).",
    );
  }
  if (!dropoffAddress) {
    errors.dropoffAddress =
      intent === "return"
        ? text(
            "موقع التسليم ناقص. أضفه من إعدادات موقع الإرجاع.",
            "Dropoff is missing. Add a return location in settings.",
          )
        : text(
            "اكتب عنوان العميل (4 أحرف على الأقل).",
            "Enter the customer address (at least 4 characters).",
          );
  }
  if (intent === "return" && !originalTracking) {
    errors.originalTracking = text(
      "اكتب رقم تتبع الأوردر المراد إرجاعه.",
      "Enter the tracking number of the order to return.",
    );
  }
  if (intent === "exchange" && !newItemNote) {
    errors.newItemNote = text(
      "اكتب وصف الشحنة الجديدة.",
      "Describe the new shipment.",
    );
  }
  if (intent === "exchange" && !returnItemNote) {
    errors.returnItemNote = text(
      "اكتب وصف الشحنة المرتجعة.",
      "Describe the shipment being returned.",
    );
  }
  if (!pickupGps.ok) {
    errors.pickupGpsUrl = text(
      MAPS_LINK_ERROR,
      "Paste an https map link from Google, Waze, or Apple, or leave it blank.",
    );
  }
  if (!dropoffGps.ok) {
    errors.dropoffGpsUrl = text(
      MAPS_LINK_ERROR,
      "Paste an https map link from Google, Waze, or Apple, or leave it blank.",
    );
  }
  if (!productPrice) {
    errors.productPrice = text("اكتب سعر المنتج، مثل 120.00.", "Enter the product price, such as 120.00.");
  }
  if (!deliveryFee) {
    errors.deliveryFee = text("اكتب رسوم التوصيل، مثل 25.00.", "Enter the delivery fee, such as 25.00.");
  }
  if (!isPaymentType(paymentRaw)) {
    errors.paymentType = text("اختر نوع الدفع.", "Choose a payment type.");
  }
  if (buildingName === undefined) {
    errors.buildingName = text("اسم المبنى أطول من المسموح.", "Building name is too long.");
  }
  if (floorNumber === undefined) {
    errors.floorNumber = text("رقم الدور أطول من المسموح.", "Floor number is too long.");
  }
  if (apartmentNumber === undefined) {
    errors.apartmentNumber = text("رقم الشقة أطول من المسموح.", "Apartment number is too long.");
  }
  if (landmark === undefined) {
    errors.landmark = text("العلامة المميزة أطول من المسموح.", "Landmark is too long.");
  }
  if (productDescription === undefined) {
    errors.productDescription = text("وصف المنتج أطول من المسموح.", "Product description is too long.");
  }
  if (deliveryNotes === undefined) {
    errors.deliveryNotes = text("ملحوظة التوصيل أطول من المسموح.", "Delivery note is too long.");
  }
  if (internalNotes === undefined) {
    errors.internalNotes = text("الملاحظة الداخلية أطول من المسموح.", "Internal note is too long.");
  }
  if (productImageUrl === undefined) {
    errors.productImageUrl = text(
      "رابط الصورة يجب أن يبدأ بـ https، أو اتركه فارغًا.",
      "The image link must start with https, or leave it blank.",
    );
  }
  if (!piecesCount) {
    errors.piecesCount = text("عدد القطع من 1 إلى 99.", "Piece count must be from 1 to 99.");
  }
  if (!parcelSize) {
    errors.parcelSize = text("اختر حجم الشحنة.", "Choose a parcel size.");
  }

  if (
    !customerName ||
    !isRecipientPhone(phone) ||
    (secondaryPhone.length > 0 && !isRecipientPhone(secondaryPhone)) ||
    !pickupAddress ||
    !returnAddress ||
    !dropoffAddress ||
    (intent === "return" && !originalTracking) ||
    (intent === "exchange" && (!newItemNote || !returnItemNote)) ||
    !pickupGps.ok ||
    !dropoffGps.ok ||
    !productPrice ||
    !deliveryFee ||
    !isPaymentType(paymentRaw) ||
    buildingName === undefined ||
    floorNumber === undefined ||
    apartmentNumber === undefined ||
    landmark === undefined ||
    productDescription === undefined ||
    deliveryNotes === undefined ||
    internalNotes === undefined ||
    productImageUrl === undefined ||
    !piecesCount ||
    !parcelSize
  ) {
    return { values, parsed: null, errors };
  }

  return {
    values,
    errors,
    parsed: {
      intent,
      customerName,
      phone,
      secondaryPhone,
      originalTracking: originalTracking ?? "",
      newItemNote: newItemNote ?? "",
      returnItemNote: returnItemNote ?? "",
      pickupAddress,
      returnAddress,
      dropoffAddress,
      pickupGpsUrl: pickupGps.url,
      dropoffGpsUrl: dropoffGps.url,
      productPrice,
      deliveryFee,
      paymentType: paymentRaw,
      buildingName,
      floorNumber,
      apartmentNumber,
      landmark,
      isWorkAddress: values.isWorkAddress,
      parcelSize,
      piecesCount,
      productDescription,
      productImageUrl,
      allowOpening: values.allowOpening,
      deliveryNotes,
      internalNotes,
    },
  };
}
