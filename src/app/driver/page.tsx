import { DriverHome } from "@/components/driver/driver-home";
import { DriverTopBar } from "@/components/driver/driver-tabs";
import { loadDriverDashboard } from "@/lib/data/driver-dashboard";
import { driverMessages } from "@/lib/driver/messages";

export const instant = false;

export default async function DriverPage() {
  const dashboard = await loadDriverDashboard();

  if (!dashboard.ok) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="bg-[#082D52] pt-[env(safe-area-inset-top)] pb-6">
          <DriverTopBar alerts={[]} />
        </div>
        <p
          role="alert"
          className="bg-destructive/10 text-destructive mx-4 mt-4 rounded-2xl px-4 py-4 text-center text-sm"
        >
          {driverMessages.ar.loadFailed}
        </p>
      </div>
    );
  }

  return <DriverHome data={dashboard.data} />;
}
