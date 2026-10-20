import type { Metadata } from "next";

import { AdminHeading, AdminNotice } from "@/components/admin/admin-heading";
import { StaffManager } from "@/components/admin/staff-manager";
import { requireRole } from "@/lib/auth/session";
import { adminMessages } from "@/lib/admin/messages";
import { readAdminPrefs } from "@/lib/admin/prefs";
import { loadStaff } from "@/lib/data/admin-ops";
import { loadAdminSettings } from "@/lib/data/admin-settings";
import { DEFAULT_MAX_CASH_SDG } from "@/lib/locale/sudan";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await readAdminPrefs();
  return { title: adminMessages[locale].pages.staff.title };
}

export const instant = false;

export default async function AdminStaffPage() {
  // The admin layout already gates this route; checking again keeps the page
  // safe if it is ever moved out from under that layout.
  await requireRole("admin");

  const [staff, settings] = await Promise.all([loadStaff(), loadAdminSettings()]);
  const defaultMaxCash = settings.ok
    ? settings.data.pricing.defaultMaxCashSdg
    : DEFAULT_MAX_CASH_SDG;

  return (
    <div className="flex flex-col gap-6">
      <AdminHeading page="staff" />

      {staff.ok ? (
        <StaffManager directory={staff.data} defaultMaxCash={defaultMaxCash} />
      ) : (
        <AdminNotice id="staff" />
      )}
    </div>
  );
}
