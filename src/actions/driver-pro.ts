"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { getAuthSession } from "@/lib/auth/session";
import { ATTEMPT_FENCE_METERS, coordsFromMapsUrl, distanceMeters } from "@/lib/driver/geo";
import { DRIVER_LOCALE_COOKIE, isDriverLocale } from "@/lib/driver/messages";
import { isNavApp } from "@/lib/driver/navigation";
import type { DriverPreferences } from "@/lib/driver/preferences";
import { safeMapsHref } from "@/lib/orders/gps-url";
import { isExceptionReason, safeImageSrc } from "@/lib/orders/shipment-details";
import { isVehicleType } from "@/lib/locale/sudan";
import { createClient } from "@/utils/supabase/server";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DriverSettingsResult =
  | { ok: true; saved: "account" | "device" }
  | { ok: false; error: "unauthorized" | "invalid" };

export type ExceptionReportResult =
  | { ok: true; suspicious: boolean; distanceMeters: number | null }
  | {
      ok: false;
      error: "unauthorized" | "forbidden" | "invalid" | "proof" | "gps" | "failed";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function proofFor(reason: string): { whatsapp: boolean; call: boolean; door: boolean } {
  return {
    whatsapp: reason === "no_answer" || reason === "postponed" || reason === "refused",
    call: reason === "no_answer" || reason === "phone_off",
    door: reason === "wrong_address" || reason === "refused",
  };
}

async function driverId(): Promise<string | null> {
  const session = await getAuthSession();
  if (session.status !== "ready" || session.profile.role !== "driver") return null;
  return session.profile.id;
}

/** Persists language, maps, theme, alerts, and the vehicle on this shift. */
export async function updateDriverSettings(
  input: DriverPreferences,
): Promise<DriverSettingsResult> {
  if (!isRecord(input)) return { ok: false, error: "invalid" };
  if (!isDriverLocale(input.locale) || !isNavApp(input.navApp)) {
    return { ok: false, error: "invalid" };
  }
  if (typeof input.darkMode !== "boolean" || typeof input.highAlert !== "boolean") {
    return { ok: false, error: "invalid" };
  }
  if (input.activeVehicle !== null && !isVehicleType(input.activeVehicle)) {
    return { ok: false, error: "invalid" };
  }

  const id = await driverId();
  if (!id) return { ok: false, error: "unauthorized" };

  const jar = await cookies();
  jar.set(DRIVER_LOCALE_COOKIE, input.locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  const supabase = await createClient();
  const full = {
    preferred_nav_app: input.navApp,
    driver_dark_mode: input.darkMode,
    high_alert_sound: input.highAlert,
    active_vehicle: input.activeVehicle,
    driver_locale: input.locale,
  };
  const phase13 = {
    preferred_nav_app: input.navApp,
    driver_dark_mode: input.darkMode,
    high_alert_sound: input.highAlert,
  };

  let saved = await supabase.from("profiles").update(full).eq("id", id).select("id");
  if (saved.error?.code === "42703" || saved.error?.code === "PGRST204") {
    saved = await supabase.from("profiles").update(phase13).eq("id", id).select("id");
  }

  revalidatePath("/driver");
  revalidatePath("/admin/staff");

  if (saved.error || !saved.data || saved.data.length !== 1) {
    console.error("driver settings", saved.error?.code, saved.error?.message);
    return { ok: true, saved: "device" };
  }
  return { ok: true, saved: "account" };
}

/**
 * Logs a failed attempt for an in-transit parcel assigned to this driver.
 * Proof URLs are data URLs or https images. Distance is computed here from
 * the dropoff link; the client cannot choose the suspicious flag.
 */
export async function reportDeliveryException(input: {
  orderId: string;
  reason: string;
  latitude: number;
  longitude: number;
  whatsappProof: string | null;
  callLogProof: string | null;
  doorProof: string | null;
}): Promise<ExceptionReportResult> {
  if (!isRecord(input) || !isExceptionReason(input.reason)) {
    return { ok: false, error: "invalid" };
  }
  if (typeof input.orderId !== "string" || !UUID.test(input.orderId)) {
    return { ok: false, error: "invalid" };
  }
  if (
    typeof input.latitude !== "number" ||
    typeof input.longitude !== "number" ||
    !Number.isFinite(input.latitude) ||
    !Number.isFinite(input.longitude) ||
    input.latitude < -90 ||
    input.latitude > 90 ||
    input.longitude < -180 ||
    input.longitude > 180
  ) {
    return { ok: false, error: "gps" };
  }

  const id = await driverId();
  if (!id) return { ok: false, error: "unauthorized" };

  const needs = proofFor(input.reason);
  const whatsapp = input.whatsappProof ? safeImageSrc(input.whatsappProof) : null;
  const callLog = input.callLogProof ? safeImageSrc(input.callLogProof) : null;
  const door = input.doorProof ? safeImageSrc(input.doorProof) : null;
  if ((needs.whatsapp && !whatsapp) || (needs.call && !callLog) || (needs.door && !door)) {
    return { ok: false, error: "proof" };
  }
  if (
    (input.whatsappProof && !whatsapp) ||
    (input.callLogProof && !callLog) ||
    (input.doorProof && !door)
  ) {
    return { ok: false, error: "proof" };
  }

  const supabase = await createClient();
  const order = await supabase
    .from("orders_readable")
    .select("id, status, dropoff_gps_url")
    .eq("id", input.orderId.toLowerCase())
    .eq("driver_id", id)
    .maybeSingle();

  if (order.error || !order.data || !isRecord(order.data)) {
    return { ok: false, error: "forbidden" };
  }
  if (order.data.status !== "in_transit") return { ok: false, error: "forbidden" };

  const dropoff = coordsFromMapsUrl(safeMapsHref(order.data.dropoff_gps_url));
  const meters = dropoff
    ? distanceMeters(
        { latitude: input.latitude, longitude: input.longitude },
        dropoff,
      )
    : null;

  const since = new Date(Date.now() - 60_000).toISOString();
  const recent = await supabase
    .from("order_exception_logs")
    .select("id", { count: "exact", head: true })
    .eq("driver_id", id)
    .gte("created_at", since);

  const burst = !recent.error && (recent.count ?? 0) >= 1;
  const outside = meters !== null && meters > ATTEMPT_FENCE_METERS;

  const inserted = await supabase.from("order_exception_logs").insert({
    order_id: input.orderId.toLowerCase(),
    driver_id: id,
    exception_reason: input.reason,
    call_log_proof_url: callLog,
    whatsapp_proof_url: whatsapp,
    door_photo_proof_url: door,
    attempt_gps_lat: input.latitude,
    attempt_gps_lng: input.longitude,
    attempt_distance_meters: meters,
  });

  if (inserted.error) {
    console.error("delivery exception", inserted.error.code, inserted.error.message);
    if (inserted.error.code === "23514") return { ok: false, error: "proof" };
    return { ok: false, error: "failed" };
  }

  const flagged = await supabase
    .from("orders_readable")
    .select("suspicious_attempt_flag")
    .eq("id", input.orderId.toLowerCase())
    .maybeSingle();

  const suspicious =
    (isRecord(flagged.data) && flagged.data.suspicious_attempt_flag === true) ||
    burst ||
    outside;

  revalidatePath("/driver");
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/exceptions");
  revalidatePath("/merchant");

  return { ok: true, suspicious, distanceMeters: meters };
}

/** The driver dismisses an admin decision that was addressed to them. */
export async function acknowledgeDriverAlert(alertId: string): Promise<{ ok: boolean }> {
  if (typeof alertId !== "string" || !UUID.test(alertId)) return { ok: false };
  const id = await driverId();
  if (!id) return { ok: false };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("acknowledge_driver_alert", {
    p_id: alertId.toLowerCase(),
  });
  if (error || !isRecord(data) || data.acknowledged !== true) return { ok: false };
  revalidatePath("/driver");
  return { ok: true };
}
