import type { Metadata } from "next";

import { AdminHeading, AdminNotice } from "@/components/admin/admin-heading";
import { HubScanner } from "@/components/admin/hub-scanner";
import { requireRole } from "@/lib/auth/session";
import { adminMessages } from "@/lib/admin/messages";
import { readAdminPrefs } from "@/lib/admin/prefs";
import { loadAssignableDrivers } from "@/lib/data/admin-ops";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await readAdminPrefs();
  return { title: adminMessages[locale].pages.hub.title };
}

export const instant = false;

export default async function HubPage() {
  // The admin layout already gates this route; checking again here keeps the
  // page safe if it is ever moved out from under that layout.
  await requireRole("admin");

  const drivers = await loadAssignableDrivers();

  return (
    <div className="flex flex-col gap-6">
      <AdminHeading page="hub" />
      {drivers.ok ? null : <AdminNotice id="hubDrivers" />}
      <HubScanner drivers={drivers.ok ? drivers.data : []} />
    </div>
  );
}
