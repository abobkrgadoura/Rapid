import { DriverHome } from "@/components/driver/driver-home";
import { DriverTopBar } from "@/components/driver/driver-top-bar";
import { requireRole } from "@/lib/auth/session";
import { loadDriverDashboard } from "@/lib/data/driver-dashboard";
import { driverMessages } from "@/lib/driver/messages";
import { resolveDriverSurface } from "@/lib/driver/surface";

export const instant = false;

function Notice({ children }: { children: string }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="bg-[#082D52] pt-[env(safe-area-inset-top)] pb-6">
        <DriverTopBar alerts={[]} />
      </div>
      <p
        role="alert"
        className="bg-destructive/10 text-destructive mx-4 mt-4 rounded-2xl px-4 py-4 text-center text-sm"
      >
        {children}
      </p>
    </div>
  );
}

export default async function DriverPage() {
  // The role and staff type come from the server session, never from the client.
  const profile = await requireRole("driver");
  const surface = resolveDriverSurface(profile.staffType);

  // Hub operators share the driver role but have no driver app. Deny by default.
  if (surface === "unsupported") {
    return <Notice>هذا الحساب مخصص لمسؤولي المخزن ولا يملك واجهة مندوب.</Notice>;
  }

  const dashboard = await loadDriverDashboard(surface);

  if (!dashboard.ok) {
    return <Notice>{driverMessages.ar.loadFailed}</Notice>;
  }

  return <DriverHome data={dashboard.data} surface={surface} />;
}
