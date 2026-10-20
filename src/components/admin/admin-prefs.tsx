"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { DirectionProvider } from "@base-ui/react/direction-provider";

import {
  ADMIN_LOCALE_COOKIE,
  ADMIN_PREFS_STORAGE_KEY,
  ADMIN_THEME_COOKIE,
  adminMessages,
  isAdminLocale,
  isAdminTheme,
  type AdminLocale,
  type AdminMessages,
  type AdminTheme,
} from "@/lib/admin/messages";

type StoredPrefs = { locale: AdminLocale; theme: AdminTheme };

type AdminPrefsValue = {
  locale: AdminLocale;
  theme: AdminTheme;
  dir: "rtl" | "ltr";
  copy: AdminMessages;
  setLocale: (locale: AdminLocale) => void;
  setTheme: (theme: AdminTheme) => void;
};

const AdminPrefsContext = createContext<AdminPrefsValue | null>(null);

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedStored: StoredPrefs | null = null;

function readStored(): StoredPrefs | null {
  try {
    const raw = localStorage.getItem(ADMIN_PREFS_STORAGE_KEY);
    if (raw === cachedRaw) return cachedStored;
    cachedRaw = raw;
    if (!raw) {
      cachedStored = null;
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      cachedStored = null;
      return null;
    }
    const record = parsed as { locale?: unknown; theme?: unknown };
    cachedStored =
      isAdminLocale(record.locale) && isAdminTheme(record.theme)
        ? { locale: record.locale, theme: record.theme }
        : null;
    return cachedStored;
  } catch {
    return cachedStored;
  }
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function publish(next: StoredPrefs) {
  const raw = JSON.stringify(next);
  try {
    localStorage.setItem(ADMIN_PREFS_STORAGE_KEY, raw);
  } catch {
    // Private mode can reject storage. The cookie still keeps the next visit.
  }
  cachedRaw = raw;
  cachedStored = next;
  document.cookie = `${ADMIN_LOCALE_COOKIE}=${next.locale};path=/;max-age=31536000;samesite=lax`;
  document.cookie = `${ADMIN_THEME_COOKIE}=${next.theme};path=/;max-age=31536000;samesite=lax`;
  for (const listener of listeners) listener();
}

export function AdminPrefsProvider({
  initialLocale,
  initialTheme,
  children,
}: {
  initialLocale: AdminLocale;
  initialTheme: AdminTheme;
  children: React.ReactNode;
}) {
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  const locale = stored?.locale ?? initialLocale;
  const theme = stored?.theme ?? initialTheme;

  const value = useMemo<AdminPrefsValue>(() => {
    const dir: "rtl" | "ltr" = locale === "ar" ? "rtl" : "ltr";
    return {
      locale,
      theme,
      dir,
      copy: adminMessages[locale],
      setLocale: (next) => publish({ locale: next, theme }),
      setTheme: (next) => publish({ locale, theme: next }),
    };
  }, [locale, theme]);

  return (
    <AdminPrefsContext.Provider value={value}>
      <DirectionProvider direction={value.dir}>
        <div className={theme === "dark" ? "dark" : undefined} style={{ colorScheme: theme }}>
          {children}
        </div>
      </DirectionProvider>
    </AdminPrefsContext.Provider>
  );
}

const fallback: AdminPrefsValue = {
  locale: "ar",
  theme: "light",
  dir: "rtl",
  copy: adminMessages.ar,
  setLocale: () => {},
  setTheme: () => {},
};

export function useAdminPrefs(): AdminPrefsValue {
  return useContext(AdminPrefsContext) ?? fallback;
}
