import type { DriverLocale } from "@/lib/driver/messages";
import type { NavApp } from "@/lib/driver/navigation";
import type { VehicleType } from "@/lib/locale/sudan";

export type DriverPreferences = {
  locale: DriverLocale;
  navApp: NavApp;
  darkMode: boolean;
  highAlert: boolean;
  /** Null until the driver picks the vehicle for this shift. */
  activeVehicle: VehicleType | null;
};

export const DEFAULT_DRIVER_PREFERENCES: DriverPreferences = {
  locale: "ar",
  navApp: "google_maps",
  darkMode: false,
  highAlert: true,
  activeVehicle: null,
};

export const DRIVER_SETTINGS_STORAGE_KEY = "rapid.driver.settings.v1";
