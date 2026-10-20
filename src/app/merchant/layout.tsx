import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { LocaleProvider } from "@/components/i18n/locale-provider";
import { MerchantShell } from "@/components/merchant/merchant-shell";
import { requireRole } from "@/lib/auth/session";
import { getMerchantProfile } from "@/lib/data/merchant-profile";
import { REQUEST_PATHNAME_HEADER } from "@/lib/auth/roles";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/messages";

export const metadata: Metadata = {
  title: "لوحة التاجر",
};

export const instant = false;

export default async function MerchantLayout({
  children,
}: LayoutProps<"/merchant">) {
  const profile = await requireRole("merchant");
  // Brand details live behind migration 0005. If they cannot be read the
  // shell still renders from the session profile.
  const merchant = await getMerchantProfile();
  const headerStore = await headers();
  const pathname = headerStore.get(REQUEST_PATHNAME_HEADER) ?? "";

  // First visit after registration: ask for expected volume before the portal.
  // Skipped when preferences cannot be read (migration 0005 not applied).
  if (
    merchant &&
    merchant.preferences.monthlyVolume === null &&
    pathname &&
    pathname !== "/merchant/onboarding"
  ) {
    redirect("/merchant/onboarding");
  }

  const displayName =
    merchant?.companyName ||
    profile.fullName ||
    profile.email ||
    "حسابي";

  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(fromCookie)
    ? fromCookie
    : (merchant?.preferences.platformLanguage ?? "ar");

  return (
    <LocaleProvider initialLocale={locale}>
      <MerchantShell displayName={displayName} email={profile.email}>
        {children}
      </MerchantShell>
    </LocaleProvider>
  );
}
