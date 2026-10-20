import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthFrame } from "@/components/auth/auth-frame";
import { LoginForm } from "@/components/auth/login-form";
import { getAuthSession } from "@/lib/auth/session";
import { homeForRole } from "@/lib/auth/roles";

export const metadata: Metadata = {
  title: "تسجيل الدخول",
};

export const instant = false;

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const session = await getAuthSession();
  if (session.status === "ready") {
    redirect(homeForRole(session.profile.role));
  }

  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "";

  return (
    <AuthFrame
      title="تسجيل الدخول إلى حسابك"
      description="أدخل رقم هاتفك أو بريدك الإلكتروني وكلمة السر للمتابعة إلى لوحة Rapid."
    >
      <LoginForm next={next} />
    </AuthFrame>
  );
}
