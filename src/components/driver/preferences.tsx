"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { updateDriverSettings } from "@/actions/driver-pro";
import { playDriverAlert } from "@/lib/driver/alerts";
import { isDriverLocale, driverMessages, type DriverLocale, type DriverMessages } from "@/lib/driver/messages";
import {
  DEFAULT_DRIVER_PREFERENCES,
  DRIVER_SETTINGS_STORAGE_KEY,
  type DriverPreferences,
} from "@/lib/driver/preferences";
import { isNavApp } from "@/lib/driver/navigation";
import { isVehicleType } from "@/lib/locale/sudan";

type DriverPrefsContext = {
  prefs: DriverPreferences;
  t: DriverMessages;
  locale: DriverLocale;
  dir: "rtl" | "ltr";
  setPrefs: (next: DriverPreferences) => void;
  alert: () => void;
};

const Context = createContext<DriverPrefsContext | null>(null);

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedStored: Partial<DriverPreferences> | null = null;

function readStored(): Partial<DriverPreferences> | null {
  try {
    const raw = localStorage.getItem(DRIVER_SETTINGS_STORAGE_KEY);
    if (raw === cachedRaw) return cachedStored;
    cachedRaw = raw;
    if (!raw) {
      cachedStored = null;
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    cachedStored = typeof parsed === "object" && parsed !== null ? (parsed as Partial<DriverPreferences>) : null;
    return cachedStored;
  } catch {
    return cachedStored;
  }
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function publish(next: DriverPreferences) {
  const raw = JSON.stringify(next);
  try {
    localStorage.setItem(DRIVER_SETTINGS_STORAGE_KEY, raw);
  } catch {
    // Private mode can refuse storage. The account save still runs.
  }
  cachedRaw = raw;
  cachedStored = next;
  for (const listener of listeners) listener();
}

function mergeStored(server: DriverPreferences, stored: Partial<DriverPreferences> | null): DriverPreferences {
  if (!stored) return server;
  return {
    locale: isDriverLocale(stored.locale) ? stored.locale : server.locale,
    navApp: isNavApp(stored.navApp) ? stored.navApp : server.navApp,
    darkMode: typeof stored.darkMode === "boolean" ? stored.darkMode : server.darkMode,
    highAlert: typeof stored.highAlert === "boolean" ? stored.highAlert : server.highAlert,
    activeVehicle: isVehicleType(stored.activeVehicle) ? stored.activeVehicle : server.activeVehicle,
  };
}

export function DriverPreferencesProvider({
  initial,
  children,
}: {
  initial: DriverPreferences;
  children: ReactNode;
}) {
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  const prefs = useMemo(() => mergeStored(initial, stored), [initial, stored]);

  const setPrefs = useCallback((next: DriverPreferences) => {
    publish(next);
    document.cookie = `rapid_driver_locale=${next.locale};path=/;max-age=31536000;samesite=lax`;
    void updateDriverSettings(next);
  }, []);

  const alert = useCallback(() => {
    if (prefs.highAlert) playDriverAlert();
  }, [prefs.highAlert]);

  const value = useMemo<DriverPrefsContext>(() => {
    const locale = prefs.locale;
    return {
      prefs,
      t: driverMessages[locale],
      locale,
      dir: locale === "ar" ? "rtl" : "ltr",
      setPrefs,
      alert,
    };
  }, [prefs, setPrefs, alert]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDriverPrefs(): DriverPrefsContext {
  const value = useContext(Context);
  if (!value) {
    return {
      prefs: DEFAULT_DRIVER_PREFERENCES,
      t: driverMessages.ar,
      locale: "ar",
      dir: "rtl",
      setPrefs: () => {},
      alert: () => {},
    };
  }
  return value;
}
