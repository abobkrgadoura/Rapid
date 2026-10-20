"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";

import { getAuthSession } from "@/lib/auth/session";
import {
  readCreateOrderForm,
  type CreateOrderState,
  type ParsedCreateOrder,
} from "@/lib/orders/create-order";
import { encodeRecipientDropoff } from "@/lib/orders/recipient";
import { priceNewOrder } from "@/lib/pricing/quote";
import { notifyOrderCreated } from "@/lib/whatsapp/notify";
import { createClient } from "@/utils/supabase/server";

function rejected(
  previous: CreateOrderState,
  values: CreateOrderState["values"],
  errors: CreateOrderState["errors"],
  formError: string | null,
): CreateOrderState {
  return {
    resetKey: previous.resetKey,
    attempt: previous.attempt + 1,
    values,
    errors,
    formError,
    trackingCode: null,
  };
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const IMAGE_MAX_BYTES = 200_000;

/** Optional product photo: an uploaded image, else the https link already parsed. */
async function readProductImage(
  formData: FormData,
  httpsUrl: string | null,
): Promise<{ ok: true; url: string | null } | { ok: false }> {
  const file = formData.get("productImage");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: true, url: httpsUrl };
  }
  if (file.size > IMAGE_MAX_BYTES || !IMAGE_TYPES.has(file.type)) {
    return { ok: false };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    ok: true,
    url: `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Writes the pickup and return location back onto the merchant profile so
 * the next order opens pre-filled. A failure here does not undo the order:
 * preferences may be unavailable until migration 0005 is applied.
 */
async function rememberMerchantLocations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  merchantId: string,
  order: ParsedCreateOrder,
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", merchantId)
    .maybeSingle();

  if (error || !data) {
    console.error("read pickup defaults", error?.code, error?.message);
    return;
  }

  const existing = isRecord(data.preferences) ? data.preferences : {};
  const { error: writeError } = await supabase
    .from("profiles")
    .update({
      preferences: {
        ...existing,
        pickup_address: order.pickupAddress,
        return_address: order.returnAddress,
        pickup_gps_url: order.pickupGpsUrl ?? "",
      },
    })
    .eq("id", merchantId);

  if (writeError) {
    console.error("save pickup defaults", writeError.code, writeError.message);
  }
}

/**
 * Creates a pending order for the signed-in merchant, with optional pickup
 * and dropoff map links. merchant_id comes from the session. Platform commission is recorded as
 * zero until an admin rate exists. Customer name and phone are stored on
 * the dropoff lines because orders have no recipient columns yet.
 */
export async function createMerchantOrder(
  previous: CreateOrderState,
  formData: FormData,
): Promise<CreateOrderState> {
  const { values, parsed, errors } = readCreateOrderForm(formData);
  if (!parsed) {
    return rejected(previous, values, errors, null);
  }

  const session = await getAuthSession();
  if (session.status === "anonymous") {
    return rejected(previous, values, {}, "سجّل الدخول مرة أخرى لإنشاء الطلب.");
  }
  if (session.status !== "ready" || session.profile.role !== "merchant") {
    return rejected(previous, values, {}, "إنشاء الطلبات متاح للتجار فقط.");
  }

  const supabase = await createClient();
  const image = await readProductImage(formData, parsed.productImageUrl);
  if (!image.ok) {
    return rejected(
      previous,
      values,
      {
        productImageUrl:
          values.locale === "en"
            ? "Use a PNG, JPEG, or WebP image under 200 KB, or an https link."
            : "استخدم صورة PNG أو JPEG أو WebP أصغر من 200 ك.ب، أو رابط https.",
      },
      null,
    );
  }

  const priced = await priceNewOrder(
    supabase,
    session.profile.id,
    parsed.dropoffAddress,
    parsed.deliveryFee,
  );
  const row = {
    merchant_id: session.profile.id,
    payment_type: parsed.paymentType,
    product_price: parsed.productPrice,
    delivery_fee: priced.deliveryFee,
    platform_commission: "0.00",
    pickup_address: parsed.pickupAddress,
    ...(priced.dynamic
      ? { pickup_fee: priced.pickupFee, country_code: priced.countryCode }
      : {}),
    dropoff_address: encodeRecipientDropoff(
      parsed.customerName,
      parsed.phone,
      parsed.dropoffAddress,
      parsed.secondaryPhone,
      {
        originalTracking: parsed.originalTracking,
        newItemNote: parsed.newItemNote,
        returnItemNote: parsed.returnItemNote,
      },
    ),
    pickup_gps_url: parsed.pickupGpsUrl,
    dropoff_gps_url: parsed.dropoffGpsUrl,
  };
  const details = {
    building_name: parsed.buildingName,
    floor_number: parsed.floorNumber,
    apartment_number: parsed.apartmentNumber,
    landmark: parsed.landmark,
    is_work_address: parsed.isWorkAddress,
    parcel_size: parsed.parcelSize,
    pieces_count: parsed.piecesCount,
    product_description: parsed.productDescription,
    product_image_url: image.url,
    allow_opening: parsed.allowOpening,
    delivery_notes: parsed.deliveryNotes,
    internal_notes: parsed.internalNotes,
  };
  let result = await supabase
    .from("orders")
    .insert({ ...row, ...details })
    .select("tracking_code")
    .single();

  // Migration 0010 is not applied yet. Keep creating the order without the
  // new columns so the merchant is not blocked.
  if (result.error?.code === "42703") {
    result = await supabase.from("orders").insert(row).select("tracking_code").single();
  }

  const { data, error } = result;

  if (error || !data || typeof data.tracking_code !== "string") {
    console.error("create order", error?.code, error?.message);
    return rejected(previous, values, {}, "تعذر إنشاء الطلب. حاول مرة أخرى.");
  }

  // A return's pickup is the customer, so it must not overwrite the merchant's
  // saved pickup address.
  if (parsed.intent !== "return") {
    await rememberMerchantLocations(supabase, session.profile.id, parsed);
  }

  revalidatePath("/merchant");
  revalidatePath("/merchant/orders");
  revalidatePath("/admin");

  // WhatsApp template 1 to the merchant. Runs after the response and never
  // affects whether the order was created.
  const createdCode = data.tracking_code;
  after(() => notifyOrderCreated(createdCode));

  redirect(`/merchant/orders?created=${encodeURIComponent(createdCode)}`);
}
