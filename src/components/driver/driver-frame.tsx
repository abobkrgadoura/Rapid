"use client";

import { DirectionProvider } from "@base-ui/react/direction-provider";
import { createContext, useContext } from "react";

import { useDriverPrefs } from "@/components/driver/preferences";
import { RoleShell } from "@/components/shell/role-shell";
import type { SessionProfile } from "@/lib/auth/profile";

const DriverNameContext = createContext("Driver");
const DriverProfileContext = createContext<SessionProfile | null>(null);

export function useDriverName() {
  return useContext(DriverNameContext);
}

export function useDriverProfile() {
  return useContext(DriverProfileContext);
}

export function DriverFrame({
  profile,
  children,
}: {
  profile: SessionProfile;
  children: React.ReactNode;
}) {
  const { dir, locale, prefs, t } = useDriverPrefs();
  const driverName = profile.fullName?.trim() || profile.email || t.appTitle;

  return (
    <DriverNameContext.Provider value={driverName}>
      <DriverProfileContext.Provider value={profile}>
        <div className={prefs.darkMode ? "dark" : undefined}>
          <DirectionProvider direction={dir}>
            <div dir={dir} lang={locale} className="bg-background text-foreground flex min-h-dvh flex-1 flex-col">
              <RoleShell title={t.appTitle} profile={profile} width="narrow" signOutLabel={t.signOut}>
                {children}
              </RoleShell>
            </div>
          </DirectionProvider>
        </div>
      </DriverProfileContext.Provider>
    </DriverNameContext.Provider>
  );
}
