"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { LOCALE_COOKIE } from "@/lib/i18n/messages";

import { getAuthSession } from "@/lib/auth/session";
import {
  isMonthlyVolume,
  parseMerchantProfileInput,
  type FieldErrors,
  type MerchantProfileInput,
} from "@/lib/merchant/settings";
import { createClient } from "@/utils/supabase/server";

export type UpdateMerchantProfileResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors: FieldErrors };

function failure(
  error: string,
  fieldErrors: FieldErrors = {},
): UpdateMerchantProfileResult {
  return { ok: false, error, fieldErrors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Saves one Settings Hub form into the signed-in merchant's profiles row.
 *
 * - The row is chosen by the server session, never by the payload, and the
 *   caller must be a merchant. RLS (profiles_update_own) and the 0005 guard
 *   trigger enforce the same two rules in the database.
 * - Only the columns of the submitted section are written. The company tab
 *   writes company_name / phone / website_url / business_category. The
 *   shipping and AWB tabs merge their keys into `preferences`, leaving keys
 *   they do not own (for example auto_print) untouched.
 * - The payload is untrusted: it is validated field by field before any write.
 */
export async function updateMerchantProfile(
  data: MerchantProfileInput,
): Promise<UpdateMerchantProfileResult> {
  const session = await getAuthSession();
  if (session.status === "anonymous") {
    return failure("انتهت الجلسة. سجّل الدخول مرة أخرى.");
  }
  if (session.status !== "ready" || session.profile.role !== "merchant") {
    return failure("هذه الإعدادات متاحة للتجار فقط.");
  }

  const parsed = parseMerchantProfileInput(data);
  if (!parsed.ok) {
    return failure("راجع الحقول المحددة ثم حاول مرة أخرى.", parsed.errors);
  }

  const supabase = await createClient();
  const merchantId = session.profile.id;

  if (parsed.update.section === "company") {
    const { data: rows, error } = await supabase
      .from("profiles")
      .update(parsed.update.columns)
      .eq("id", merchantId)
      .select("id");

    if (error || !rows || rows.length !== 1) {
      console.error("update merchant company", error?.code, error?.message);
      return failure("تعذر حفظ التغييرات. حاول مرة أخرى.");
    }

    const saved = await mergePreferences(supabase, merchantId, parsed.update.locations);
    if (!saved) return failure("تعذر حفظ التغييرات. حاول مرة أخرى.");
  } else if (parsed.update.section === "personal") {
    const { data: rows, error } = await supabase
      .from("profiles")
      .update(parsed.update.columns)
      .eq("id", merchantId)
      .select("id");

    if (error || !rows || rows.length !== 1) {
      console.error("update merchant personal", error?.code, error?.message);
      return failure("تعذر حفظ التغييرات. حاول مرة أخرى.");
    }
  } else {
    const saved = await mergePreferences(supabase, merchantId, parsed.update.patch);
    if (!saved) return failure("تعذر حفظ التغييرات. حاول مرة أخرى.");
  }

  if (parsed.update.section === "preferences" && parsed.update.patch.platform_language) {
    const jar = await cookies();
    jar.set(LOCALE_COOKIE, parsed.update.patch.platform_language, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }

  // The shell shows the company name, so refresh the whole merchant segment.
  revalidatePath("/merchant", "layout");
  return { ok: true };
}

/**
 * Records the onboarding choice (expected monthly volume) on the signed-in
 * merchant. The value is a preferences key; the row is the session user.
 */
export async function saveMonthlyVolume(
  volume: string,
): Promise<UpdateMerchantProfileResult> {
  if (!isMonthlyVolume(volume)) {
    return failure("اختر حجم الشحنات المتوقع.");
  }

  const session = await getAuthSession();
  if (session.status === "anonymous") {
    return failure("انتهت الجلسة. سجّل الدخول مرة أخرى.");
  }
  if (session.status !== "ready" || session.profile.role !== "merchant") {
    return failure("هذه الخطوة متاحة للتجار فقط.");
  }

  const supabase = await createClient();
  const saved = await mergePreferences(supabase, session.profile.id, {
    monthly_volume: volume,
  });
  if (!saved) return failure("تعذر حفظ الاختيار. حاول مرة أخرى.");

  revalidatePath("/merchant", "layout");
  return { ok: true };
}

async function mergePreferences(
  supabase: Awaited<ReturnType<typeof createClient>>,
  merchantId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data: current, error: readError } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", merchantId)
    .maybeSingle();

  if (readError || !current) {
    console.error("read merchant preferences", readError?.code, readError?.message);
    return false;
  }

  const existing = isRecord(current.preferences) ? current.preferences : {};
  const { data: rows, error } = await supabase
    .from("profiles")
    .update({ preferences: { ...existing, ...patch } })
    .eq("id", merchantId)
    .select("id");

  if (error || !rows || rows.length !== 1) {
    console.error("update merchant preferences", error?.code, error?.message);
    return false;
  }
  return true;
}
