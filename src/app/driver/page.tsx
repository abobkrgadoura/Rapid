import { DriverHome } from "@/components/driver/driver-home";
import { loadDriverDashboard } from "@/lib/data/driver-dashboard";
import { driverMessages } from "@/lib/driver/messages";

export const instant = false;

export default async function DriverPage() {
  const dashboard = await loadDriverDashboard();

  if (!dashboard.ok) {
    return (
      <p
        role="alert"
        className="bg-destructive/10 text-destructive rounded-2xl px-4 py-4 text-center text-sm"
      >
        {driverMessages.ar.loadFailed}
      </p>
    );
  }

  return <DriverHome data={dashboard.data} />;
}
