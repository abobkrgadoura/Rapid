import type { Metadata } from "next";

import {
  SettingsHub,
  SettingsIntro,
  SettingsUnavailable,
} from "@/components/merchant/settings-hub";
import { getMerchantProfile } from "@/lib/data/merchant-profile";

export const metadata: Metadata = {
  title: "الإعدادات",
};

export const instant = false;

export default async function MerchantSettingsPage() {
  const profile = await getMerchantProfile();

  if (!profile) {
    // The layout already admitted a merchant, so a null here means the row
    // could not be read (migration 0005 not applied). Say so instead of
    // rendering a form that cannot save.
    return <SettingsUnavailable />;
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsIntro />
      <SettingsHub profile={profile} />
    </div>
  );
}
