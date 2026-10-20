"use client";

import { DeliveryDriverHome } from "@/components/driver/delivery/delivery-driver-home";
import { PickupDriverHome } from "@/components/driver/pickup/pickup-driver-home";
import type { DriverDashboard } from "@/lib/data/driver-dashboard";
import type { DriverSurface } from "@/lib/driver/surface";

/**
 * Picks the driver app from the surface the server resolved out of
 * `profiles.staff_type`. The surface is never read from the client.
 *
 * Legacy accounts (no staff_type, created before migration 0007) keep the old
 * data-based choice: deliveries only when there is nothing to pick up.
 */
export function DriverHome({
  data,
  surface,
}: {
  data: DriverDashboard;
  surface: Exclude<DriverSurface, "unsupported">;
}) {
  switch (surface) {
    case "pickup":
      return <PickupDriverHome data={data} />;
    case "delivery":
      return <DeliveryDriverHome data={data} />;
    case "legacy":
      return data.pickups.length === 0 && data.deliveries.length > 0 ? (
        <DeliveryDriverHome data={data} />
      ) : (
        <PickupDriverHome data={data} />
      );
  }
}
