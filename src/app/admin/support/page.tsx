import type { Metadata } from "next";

import { AdminHeading, AdminNotice } from "@/components/admin/admin-heading";
import { AdminSupportDesk } from "@/components/admin/support-desk";
import { requireRole } from "@/lib/auth/session";
import { adminMessages } from "@/lib/admin/messages";
import { readAdminPrefs } from "@/lib/admin/prefs";
import { loadAdminTickets } from "@/lib/data/support";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await readAdminPrefs();
  return { title: adminMessages[locale].pages.support.title };
}

export default async function AdminSupportPage() {
  await requireRole("admin");
  const tickets = await loadAdminTickets();

  return (
    <div className="flex flex-col gap-6">
      <AdminHeading page="support" />
      {tickets.ok ? <AdminSupportDesk tickets={tickets.data} /> : <AdminNotice id="support" />}
    </div>
  );
}
