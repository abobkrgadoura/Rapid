import type { Metadata } from "next";

import { AdminHeading, AdminNotice } from "@/components/admin/admin-heading";
import { FinanceDesk } from "@/components/admin/finance-desk";
import { requireRole } from "@/lib/auth/session";
import { adminMessages } from "@/lib/admin/messages";
import { readAdminPrefs } from "@/lib/admin/prefs";
import { loadAdminFinance } from "@/lib/data/finance";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await readAdminPrefs();
  return { title: adminMessages[locale].pages.finance.title };
}

export const instant = false;

export default async function AdminFinancePage() {
  await requireRole("admin");
  const finance = await loadAdminFinance();

  return (
    <div className="flex flex-col gap-6">
      <AdminHeading page="finance" />

      {finance.ok ? <FinanceDesk view={finance.data} /> : <AdminNotice id="finance" />}
    </div>
  );
}
