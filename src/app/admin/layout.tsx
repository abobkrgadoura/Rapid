import type { Metadata } from "next";

import { AdminPrefsProvider } from "@/components/admin/admin-prefs";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireRole } from "@/lib/auth/session";
import { adminMessages } from "@/lib/admin/messages";
import { readAdminPrefs } from "@/lib/admin/prefs";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await readAdminPrefs();
  return { title: adminMessages[locale].shell.portal };
}

export default async function AdminLayout({
  children,
}: LayoutProps<"/admin">) {
  const profile = await requireRole("admin");
  const prefs = await readAdminPrefs();

  return (
    <AdminPrefsProvider initialLocale={prefs.locale} initialTheme={prefs.theme}>
      <AdminShell displayName={profile.fullName || profile.email || "المدير"} email={profile.email}>
        {children}
      </AdminShell>
    </AdminPrefsProvider>
  );
}
