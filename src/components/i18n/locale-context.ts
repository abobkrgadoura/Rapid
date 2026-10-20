"use client";

import { createContext, useContext } from "react";

import { messages, type Locale, type Messages } from "@/lib/i18n/messages";

export type LocaleContextValue = {
  locale: Locale;
  dir: "rtl" | "ltr";
  m: Messages;
  setLocale: (locale: Locale) => void;
};

export const LocaleContext = createContext<LocaleContextValue | null>(null);

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (value) return value;
  return {
    locale: "ar",
    dir: "rtl",
    m: messages.ar,
    setLocale: () => {},
  };
}
