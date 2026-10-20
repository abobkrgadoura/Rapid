"use client";

import Link from "next/link";
import {
  LayoutDashboard,
  LifeBuoy,
  PenLine,
  Route,
  ScanBarcode,
  Settings,
  ShieldAlert,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { AdminPageHeader } from "@/components/admin/page-header";
import { useAdminPrefs } from "@/components/admin/admin-prefs";
import type { AdminMessages } from "@/lib/admin/messages";

type PageKey = keyof AdminMessages["pages"];
type NoticeKey = keyof AdminMessages["notices"];

const pageIcons = {
  tower: LayoutDashboard,
  hub: ScanBarcode,
  orders: Route,
  exceptions: ShieldAlert,
  staff: Users,
  finance: Wallet,
  settings: Settings,
  support: LifeBuoy,
  orderEdit: PenLine,
} satisfies Record<PageKey, LucideIcon>;

export function AdminHeading({
  page,
  trackingCode,
  customerName,
}: {
  page: PageKey;
  trackingCode?: string;
  customerName?: string;
}) {
  const { copy } = useAdminPrefs();
  const pageCopy = copy.pages[page];
  const description =
    page === "orderEdit" && trackingCode
      ? `${trackingCode} · ${customerName?.trim() || copy.pages.orderEdit.unnamed}`
      : pageCopy.description;

  return <AdminPageHeader icon={pageIcons[page]} title={pageCopy.title} description={description} />;
}

export function AdminNotice({ id }: { id: NoticeKey }) {
  const { copy } = useAdminPrefs();
  return (
    <p role="alert" className="bg-destructive/10 text-destructive rounded-xl px-4 py-3 text-sm">
      {copy.notices[id]}
    </p>
  );
}

export function AdminOrdersLink() {
  const { copy } = useAdminPrefs();
  return (
    <Link href="/admin/orders" className="text-brand text-sm font-medium underline-offset-4 hover:underline">
      {copy.pages.orderEdit.back}
    </Link>
  );
}
