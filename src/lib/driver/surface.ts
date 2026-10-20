import type { StaffType } from "@/lib/admin/labels";

/**
 * Which driver app a signed-in `driver` account sees. Derived from the
 * server-resolved profile `staff_type`, never from a client field.
 *
 *   pickup_driver   -> pickup   (merchant pickups and the shipments list)
 *   delivery_driver -> delivery (hub load, deliveries, COD, customer details)
 *   hub_operator    -> unsupported (works the warehouse, has no driver surface)
 *   null            -> legacy   (account created before migration 0007)
 */
export type DriverSurface = "pickup" | "delivery" | "legacy" | "unsupported";

export function resolveDriverSurface(staffType: StaffType | null): DriverSurface {
  switch (staffType) {
    case "pickup_driver":
      return "pickup";
    case "delivery_driver":
      return "delivery";
    case "hub_operator":
      return "unsupported";
    case null:
      return "legacy";
  }
}
