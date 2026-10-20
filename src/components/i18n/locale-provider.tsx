"use client";

import { useMemo, useState } from "react";
import { DirectionProvider } from "@base-ui/react/direction-provider";

import {
  LOCALE_COOKIE,
  messages,
  type Locale,
  type Messages,
} from "@/lib/i18n/messages";
import { LocaleContext } from "@/components/i18n/locale-context";

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const value = useMemo(() => {
    const dir: "rtl" | "ltr" = locale === "ar" ? "rtl" : "ltr";
    const setLocale = (next: Locale) => {
      setLocaleState(next);
      document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`;
    };
    return {
      locale,
      dir,
      m: messages[locale],
      setLocale,
    };
  }, [locale]);

  return (
    <LocaleContext.Provider value={value}>
      <DirectionProvider direction={value.dir}>
        <div dir={value.dir} lang={locale} className="bg-zinc-50 flex min-h-dvh flex-1 flex-col">
          {children}
        </div>
      </DirectionProvider>
    </LocaleContext.Provider>
  );
}

export type { Messages };
