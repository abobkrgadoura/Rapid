import type { Metadata } from "next";

import { RoleShell } from "@/components/shell/role-shell";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Customer",
};

export const instant = false;

export default async function CustomerLayout({
  children,
}: LayoutProps<"/customer">) {
  const profile = await requireRole("customer");

  return (
    <RoleShell title="Customer" profile={profile}>
      {children}
    </RoleShell>
  );
}
