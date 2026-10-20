import type { Metadata } from "next";

import { AdminHeading } from "@/components/admin/admin-heading";
import { ControlTowerBoard } from "@/components/admin/control-tower";
import { adminMessages } from "@/lib/admin/messages";
import { readAdminPrefs } from "@/lib/admin/prefs";
import { loadControlTower } from "@/lib/data/admin-ops";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await readAdminPrefs();
  return { title: adminMessages[locale].pages.tower.title };
}

export default async function AdminPage() {
  const tower = await loadControlTower();

  return (
    <div className="flex flex-col gap-8">
      <AdminHeading page="tower" />
      <ControlTowerBoard tower={tower.ok ? { ok: true, data: tower.data } : { ok: false }} />
    </div>
  );
}
