import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { fetchSessionProfile, type SessionProfile } from "@/lib/auth/profile";
import {
  loginPathFor,
  REQUEST_PATHNAME_HEADER,
  type AppRole,
} from "@/lib/auth/roles";
import { createClient } from "@/utils/supabase/server";

export type AuthSession =
  | { status: "anonymous" }
  | { status: "unprovisioned" }
  | { status: "ready"; profile: SessionProfile };

/**
 * Resolves the signed-in user from the verified session, then loads role
 * from public.profiles. Memoized for the rest of this render.
 */
export const getAuthSession = cache(async (): Promise<AuthSession> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (error || !userId) {
    return { status: "anonymous" };
  }

  const profile = await fetchSessionProfile(supabase, userId);
  if (!profile) {
    return { status: "unprovisioned" };
  }

  return { status: "ready", profile };
});

/**
 * Authoritative gate for a role layout. The proxy redirects first; this
 * runs again next to the data so a stale or mismatched session cannot render.
 */
export async function requireRole(role: AppRole): Promise<SessionProfile> {
  const session = await getAuthSession();

  if (session.status === "anonymous") {
    const headerStore = await headers();
    redirect(loginPathFor(headerStore.get(REQUEST_PATHNAME_HEADER)));
  }

  if (session.status !== "ready" || session.profile.role !== role) {
    redirect("/unauthorized");
  }

  return session.profile;
}
