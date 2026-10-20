import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthFrame } from "@/components/auth/auth-frame";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { getAuthSession } from "@/lib/auth/session";
import { homeForRole } from "@/lib/auth/roles";

export const metadata: Metadata = {
  title: "استعادة كلمة السر",
};

export const instant = false;

export default async function ForgotPasswordPage() {
  const session = await getAuthSession();
  if (session.status === "ready") {
    redirect(homeForRole(session.profile.role));
  }

  return (
    <AuthFrame
      title="نسيت كلمة السر؟"
      description="اكتب بريدك الإلكتروني وسنرسل رابطًا لإعادة تعيين كلمة السر."
    >
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
