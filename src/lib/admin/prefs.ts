import { cookies } from "next/headers";

import {
  ADMIN_LOCALE_COOKIE,
  ADMIN_THEME_COOKIE,
  isAdminLocale,
  isAdminTheme,
  type AdminLocale,
  type AdminTheme,
} from "@/lib/admin/messages";

export async function readAdminPrefs(): Promise<{ locale: AdminLocale; theme: AdminTheme }> {
  const jar = await cookies();
  const localeValue = jar.get(ADMIN_LOCALE_COOKIE)?.value;
  const themeValue = jar.get(ADMIN_THEME_COOKIE)?.value;
  return {
    locale: isAdminLocale(localeValue) ? localeValue : "ar",
    theme: isAdminTheme(themeValue) ? themeValue : "light",
  };
}
