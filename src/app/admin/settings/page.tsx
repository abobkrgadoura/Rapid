import type { Metadata } from "next";

import { AdminHeading, AdminNotice } from "@/components/admin/admin-heading";
import { SettingsDesk } from "@/components/admin/settings-desk";
import { requireRole } from "@/lib/auth/session";
import { adminMessages } from "@/lib/admin/messages";
import { readAdminPrefs } from "@/lib/admin/prefs";
import { loadAdminSettings } from "@/lib/data/admin-settings";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await readAdminPrefs();
  return { title: adminMessages[locale].pages.settings.title };
}

export const instant = false;

export default async function AdminSettingsPage() {
  await requireRole("admin");
  const settings = await loadAdminSettings();

  return (
    <div className="flex flex-col gap-6">
      <AdminHeading page="settings" />
      {settings.ok ? <SettingsDesk snapshot={settings.data} /> : <AdminNotice id="settings" />}
    </div>
  );
}
