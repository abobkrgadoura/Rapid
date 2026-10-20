"use client";

import { DriverSettingsButton } from "@/components/driver/settings-sheet";
import { useDriverPrefs } from "@/components/driver/preferences";
import { RoleShell } from "@/components/shell/role-shell";
import type { SessionProfile } from "@/lib/auth/profile";

export function DriverFrame({
  profile,
  children,
}: {
  profile: SessionProfile;
  children: React.ReactNode;
}) {
  const { dir, locale, prefs, t } = useDriverPrefs();

  return (
    <div className={prefs.darkMode ? "dark" : undefined}>
      <div dir={dir} lang={locale} className="bg-background text-foreground flex min-h-dvh flex-1 flex-col">
        <RoleShell
          title={t.appTitle}
          profile={profile}
          width="narrow"
          actions={<DriverSettingsButton />}
          signOutLabel={t.signOut}
        >
          {children}
        </RoleShell>
      </div>
    </div>
  );
}
