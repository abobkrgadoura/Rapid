import { cache } from "react";

import { getAuthSession } from "@/lib/auth/session";
import {
  isBusinessCategory,
  readPreferences,
  type BusinessCategory,
  type MerchantPreferences,
} from "@/lib/merchant/settings";
import { createClient } from "@/utils/supabase/server";

export type MerchantProfile = {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string;
  companyName: string;
  websiteUrl: string;
  businessCategory: BusinessCategory | null;
  preferences: MerchantPreferences;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The signed-in merchant's own profile, read with their JWT (RLS returns only
 * their row). Memoized per render, so the shell and the settings page share
 * one query. Null for anyone who is not a signed-in merchant.
 */
export const getMerchantProfile = cache(
  async (): Promise<MerchantProfile | null> => {
    const session = await getAuthSession();
    if (session.status !== "ready" || session.profile.role !== "merchant") {
      return null;
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, full_name, email, phone, company_name, website_url, business_category, preferences",
      )
      .eq("id", session.profile.id)
      .maybeSingle();

    if (error || !isRecord(data) || typeof data.id !== "string") {
      // Most likely migration 0005 is not applied yet. The session profile is
      // still good, so the shell keeps working with defaults.
      console.error("merchant profile", error?.code, error?.message);
      return null;
    }

    return {
      id: data.id,
      fullName: typeof data.full_name === "string" ? data.full_name : null,
      email: typeof data.email === "string" ? data.email : null,
      phone: text(data.phone),
      companyName: text(data.company_name),
      websiteUrl: text(data.website_url),
      businessCategory: isBusinessCategory(data.business_category)
        ? data.business_category
        : null,
      preferences: readPreferences(data.preferences),
    };
  },
);
