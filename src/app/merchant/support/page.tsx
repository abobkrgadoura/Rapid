import type { Metadata } from "next";
import { cookies } from "next/headers";

import { MerchantSupportDesk } from "@/components/merchant/support-desk";
import { requireRole } from "@/lib/auth/session";
import { loadMerchantTickets } from "@/lib/data/support";
import { isLocale, LOCALE_COOKIE, messages } from "@/lib/i18n/messages";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const jar = await cookies();
  const localeValue = jar.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(localeValue) ? localeValue : "ar";
  return { title: messages[locale].support.title };
}

export default async function MerchantSupportPage() {
  await requireRole("merchant");
  const tickets = await loadMerchantTickets();

  return (
    <MerchantSupportDesk
      tickets={tickets.ok ? tickets.data : []}
      loadError={tickets.ok ? null : tickets.reason}
    />
  );
}
