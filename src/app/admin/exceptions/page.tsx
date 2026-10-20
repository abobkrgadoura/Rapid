import type { Metadata } from "next";

import { AdminHeading, AdminNotice } from "@/components/admin/admin-heading";
import { ExceptionsDesk } from "@/components/admin/exceptions-desk";
import { requireRole } from "@/lib/auth/session";
import { adminMessages } from "@/lib/admin/messages";
import { readAdminPrefs } from "@/lib/admin/prefs";
import { loadExceptionOrders } from "@/lib/data/admin-ops";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await readAdminPrefs();
  return { title: adminMessages[locale].pages.exceptions.title };
}

export const instant = false;

export default async function AdminExceptionsPage() {
  await requireRole("admin");
  const orders = await loadExceptionOrders();

  return (
    <div className="flex flex-col gap-6">
      <AdminHeading page="exceptions" />
      {orders.ok ? <ExceptionsDesk orders={orders.data} /> : <AdminNotice id="exceptions" />}
    </div>
  );
}
