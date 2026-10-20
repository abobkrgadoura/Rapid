"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { AUTH_PHONE_HINT, parseAuthIdentifier } from "@/lib/auth/identifier";
import { fetchSessionProfile } from "@/lib/auth/profile";
import { homeForRole, safeNextPath } from "@/lib/auth/roles";
import { createClient } from "@/utils/supabase/server";

export type SignInState = { error: string } | null;

function authCode(error: { code?: string; message?: string } | null): string {
  return error?.code ?? "";
}

/**
 * Phone + password is `signInWithPassword({ phone, password })`.
 * `signInWithOtp` does not accept a password and does not open a session;
 * it only starts an SMS code. Test phone numbers skip that SMS when signup
 * still requires a confirmation code (`verifyOtp` on the registration form).
 */
export async function signIn(
  _state: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const identifier = parseAuthIdentifier(String(formData.get("identifier") ?? ""));
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (!identifier) {
    return { error: `اكتب بريدًا إلكترونيًا أو رقم هاتف صحيحًا. ${AUTH_PHONE_HINT}` };
  }
  if (!password) {
    return { error: "أدخل كلمة السر." };
  }

  const supabase = await createClient();
  const { data, error } =
    identifier.kind === "email"
      ? await supabase.auth.signInWithPassword({
          email: identifier.email,
          password,
        })
      : await supabase.auth.signInWithPassword({
          phone: identifier.phone,
          password,
        });

  if (error || !data.user) {
    const code = authCode(error);
    if (code === "email_not_confirmed") {
      return { error: "البريد لم يُؤكَّد بعد. افتح رسالة التأكيد ثم أعد المحاولة." };
    }
    if (code === "phone_not_confirmed") {
      return {
        error: "رقم الهاتف لم يُؤكَّد بعد. أدخل رمز الاختبار من صفحة إنشاء الحساب.",
      };
    }
    if (code === "phone_provider_disabled") {
      return { error: "تسجيل الدخول بالهاتف غير مفعّل في المشروع بعد." };
    }
    return { error: "رقم الهاتف أو البريد الإلكتروني أو كلمة السر غير صحيحة." };
  }

  const profile = await fetchSessionProfile(supabase, data.user.id);
  if (!profile) {
    redirect("/unauthorized");
  }

  redirect(safeNextPath(next, profile.role));
}

export type SignUpState = {
  error?: string;
  message?: string;
  confirmPhone?: string;
} | null;

function cleanName(value: string, label: string): string | { error: string } {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    return { error: label };
  }
  return name;
}

/**
 * New merchants. Phone accounts use `signUp({ phone, password })`.
 * When Supabase still requires confirmation, a test number does not send an
 * SMS; the fixed code from the dashboard is checked with `verifyOtp`.
 */
export async function signUpMerchant(
  _state: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  if (String(formData.get("step") ?? "") === "confirm") {
    return confirmMerchantPhone(formData);
  }

  const fullName = cleanName(String(formData.get("fullName") ?? ""), "اكتب الاسم بالكامل (حرفان على الأقل).");
  if (typeof fullName !== "string") return { error: fullName.error };

  const companyRaw = String(formData.get("companyName") ?? "").trim().replace(/\s+/g, " ");
  if (companyRaw.length > 120 || /[\u0000-\u001f\u007f]/.test(companyRaw)) {
    return { error: "اسم النشاط أطول من المسموح." };
  }

  const identifier = parseAuthIdentifier(String(formData.get("identifier") ?? ""));
  if (!identifier) {
    return { error: `اكتب بريدًا إلكترونيًا أو رقم هاتف صحيحًا. ${AUTH_PHONE_HINT}` };
  }

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  if (password.length < 8 || password.length > 72) {
    return { error: "كلمة السر يجب ألا تقل عن 8 أحرف." };
  }
  if (password !== confirm) {
    return { error: "كلمتا السر غير متطابقتين." };
  }

  const metadata: Record<string, string> = {
    role: "merchant",
    full_name: fullName,
  };
  if (companyRaw) metadata.company_name = companyRaw;
  if (identifier.kind === "phone") metadata.phone = identifier.phone;

  const supabase = await createClient();
  const { data, error } =
    identifier.kind === "phone"
      ? await supabase.auth.signUp({
          phone: identifier.phone,
          password,
          options: { channel: "sms", data: metadata },
        })
      : await supabase.auth.signUp({
          email: identifier.email,
          password,
          options: { data: metadata },
        });

  if (error || !data.user) {
    const code = authCode(error);
    const message = error?.message.toLowerCase() ?? "";
    if (code === "weak_password") return { error: "كلمة السر يجب ألا تقل عن 8 أحرف." };
    if (code === "phone_provider_disabled" || code === "email_provider_disabled") {
      return { error: "إنشاء الحساب بهذا المعرّف غير مفعّل في المشروع بعد." };
    }
    if (
      code === "sms_send_failed" ||
      code === "over_sms_send_rate_limit" ||
      message.includes("sms")
    ) {
      return {
        error: "تعذر إرسال رمز التأكيد. استخدم رقم اختبار من لوحة Supabase، أو حاول بعد قليل.",
      };
    }
    if (code === "user_already_exists" || message.includes("already")) {
      return { error: "هذا الحساب مسجل بالفعل. سجّل الدخول." };
    }
    console.error("merchant signup", code, error?.message);
    return { error: "تعذر إنشاء الحساب الآن. حاول مرة أخرى." };
  }

  const identities = data.user.identities;
  if (Array.isArray(identities) && identities.length === 0) {
    return { error: "هذا الحساب مسجل بالفعل. سجّل الدخول." };
  }

  if (data.session) {
    const profile = await fetchSessionProfile(supabase, data.user.id);
    if (!profile) redirect("/unauthorized");
    redirect(homeForRole(profile.role));
  }

  if (identifier.kind === "phone") {
    return { confirmPhone: identifier.phone };
  }

  return {
    message: "تحقق من بريدك لإكمال إنشاء الحساب، ثم سجّل الدخول.",
  };
}

async function confirmMerchantPhone(formData: FormData): Promise<SignUpState> {
  const identifier = parseAuthIdentifier(String(formData.get("phone") ?? ""));
  const token = String(formData.get("token") ?? "").replace(/\D/g, "");
  if (!identifier || identifier.kind !== "phone") {
    return { error: "رقم الهاتف غير صالح. أعد إنشاء الحساب." };
  }
  if (token.length < 4 || token.length > 10) {
    return {
      error: "أدخل رمز التأكيد. أثناء التطوير استخدم الرمز الثابت لرقم الاختبار.",
      confirmPhone: identifier.phone,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    phone: identifier.phone,
    token,
    type: "sms",
  });

  if (error || !data.user || !data.session) {
    return {
      error: "رمز التأكيد غير صحيح أو انتهت صلاحيته.",
      confirmPhone: identifier.phone,
    };
  }

  const profile = await fetchSessionProfile(supabase, data.user.id);
  if (!profile) redirect("/unauthorized");
  redirect(homeForRole(profile.role));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type ResetPasswordState = { error?: string; message?: string } | null;

/**
 * Asks Supabase to email a recovery link. The response does not say whether
 * the address exists, so a stranger cannot use this form to look up accounts.
 */
export async function requestPasswordReset(
  _state: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email || !email.includes("@") || email.length > 254) {
    return { error: "اكتب بريدًا إلكترونيًا صحيحًا." };
  }

  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  const redirectTo = host ? `${proto}://${host}/login` : undefined;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    email,
    redirectTo ? { redirectTo } : undefined,
  );

  if (error) {
    console.error("password reset", error.message);
    return { error: "تعذر إرسال الرسالة الآن. حاول مرة أخرى بعد قليل." };
  }

  return {
    message: "إذا كان هذا البريد مسجلاً لدينا، ستصلك رسالة لإعادة تعيين كلمة السر.",
  };
}
