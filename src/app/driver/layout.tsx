import type { Metadata, Viewport } from "next";

import { DriverFrame } from "@/components/driver/driver-frame";
import { DriverPreferencesProvider } from "@/components/driver/preferences";
import { requireRole } from "@/lib/auth/session";
import { loadDriverPreferences } from "@/lib/data/driver-dashboard";

export const metadata: Metadata = {
  title: "Driver",
  applicationName: "Rapid Driver",
  appleWebApp: {
    capable: true,
    title: "Rapid Driver",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icon-192.png",
  },
};

/**
 * Mobile-first. viewport-fit=cover lets the fixed scan bar extend under the
 * home indicator (it pads itself with env(safe-area-inset-bottom)). Pinch
 * zoom stays enabled on purpose.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#082D52",
};

export const instant = false;

export default async function DriverLayout({
  children,
}: LayoutProps<"/driver">) {
  const profile = await requireRole("driver");
  const preferences = await loadDriverPreferences();

  return (
    <DriverPreferencesProvider initial={preferences}>
      <DriverFrame profile={profile}>{children}</DriverFrame>
    </DriverPreferencesProvider>
  );
}
