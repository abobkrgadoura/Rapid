import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthFrame } from "@/components/auth/auth-frame";
import { RegisterForm } from "@/components/auth/register-form";
import { homeForRole } from "@/lib/auth/roles";
import { getAuthSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "إنشاء حساب تاجر",
};

export const instant = false;

export default async function RegisterPage() {
  const session = await getAuthSession();
  if (session.status === "ready") {
    redirect(homeForRole(session.profile.role));
  }

  return (
    <AuthFrame
      title="إنشاء حساب تاجر"
      description="سجّل برقم هاتفك وكلمة السر. أثناء التطوير تُقبل أرقام الاختبار من Supabase دون مزود رسائل."
    >
      <RegisterForm />
    </AuthFrame>
  );
}
