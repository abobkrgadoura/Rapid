import type { Metadata } from "next";

import { AdminHeading, AdminNotice } from "@/components/admin/admin-heading";
import { OrdersDesk } from "@/components/admin/orders-desk";
import { requireRole } from "@/lib/auth/session";
import { adminMessages } from "@/lib/admin/messages";
import { readAdminPrefs } from "@/lib/admin/prefs";
import { loadAdminOrders, loadAssignableDrivers } from "@/lib/data/admin-ops";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await readAdminPrefs();
  return { title: adminMessages[locale].pages.orders.title };
}

export const instant = false;

export default async function AdminOrdersPage() {
  // The admin layout already gates this route; checking again keeps the page
  // safe if it is ever moved out from under that layout.
  await requireRole("admin");

  const [orders, drivers] = await Promise.all([
    loadAdminOrders(),
    loadAssignableDrivers(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <AdminHeading page="orders" />

      {orders.ok ? (
        <OrdersDesk orders={orders.data} drivers={drivers.ok ? drivers.data : []} />
      ) : (
        <AdminNotice id="orders" />
      )}
      {orders.ok && !drivers.ok ? <AdminNotice id="ordersDrivers" /> : null}
    </div>
  );
}
