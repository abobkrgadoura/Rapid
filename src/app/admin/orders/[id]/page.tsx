import type { Metadata } from "next";

import { AdminHeading, AdminNotice, AdminOrdersLink } from "@/components/admin/admin-heading";
import { OrderEditForm } from "@/components/admin/order-edit-form";
import { requireRole } from "@/lib/auth/session";
import { adminMessages } from "@/lib/admin/messages";
import { readAdminPrefs } from "@/lib/admin/prefs";
import { loadAdminOrder } from "@/lib/data/admin-ops";

type AdminOrderPageProps = {
  params: Promise<{ id: string }>;
};

export const instant = false;

export async function generateMetadata({ params }: AdminOrderPageProps): Promise<Metadata> {
  const { locale } = await readAdminPrefs();
  const { id } = await params;
  const result = await loadAdminOrder(id);
  const title = adminMessages[locale].pages.orderEdit.title;
  return { title: result.ok ? `${title} ${result.data.trackingCode}` : title };
}

export default async function AdminOrderEditPage({ params }: AdminOrderPageProps) {
  await requireRole("admin");
  const { id } = await params;
  const result = await loadAdminOrder(id);

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-4">
        <AdminHeading page="orderEdit" />
        <AdminNotice id={result.reason === "not_found" ? "orderMissing" : "orderLoad"} />
        <AdminOrdersLink />
      </div>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <AdminHeading
        page="orderEdit"
        trackingCode={result.data.trackingCode}
        customerName={result.data.customerName}
      />
      <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
        <OrderEditForm row={result.data} />
      </div>
    </div>
  );
}
