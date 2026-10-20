import type { SupabaseClient } from "@supabase/supabase-js";

import type { AdminErrorCode } from "@/lib/admin/types";
import type { SessionProfile } from "@/lib/auth/profile";
import { getAuthSession } from "@/lib/auth/session";
import { createClient } from "@/utils/supabase/server";

/**
 * Plain server module (not a "use server" file) so these helpers are not
 * exposed as callable server actions. src/actions/admin.ts is the only caller.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function canonicalUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID.test(value)) return null;
  return value.toLowerCase();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** PostgREST / Postgres codes for "that function does not exist". */
const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);
/** "undefined column" and "invalid enum value": migration 0007 is not applied. */
const MISSING_SCHEMA = new Set(["42703", "22P02"]);

export function isMigrationPending(error: { code?: string } | null | undefined): boolean {
  return (
    !!error &&
    typeof error.code === "string" &&
    (MISSING_FUNCTION.has(error.code) || MISSING_SCHEMA.has(error.code))
  );
}

function mapRpcMessage(message: string | undefined): AdminErrorCode {
  const match = message?.match(/rapid:[a-z0-9_]+/);
  switch (match?.[0]) {
    case "rapid:unauthorized":
      return "unauthorized";
    case "rapid:forbidden":
      return "forbidden";
    case "rapid:invalid":
      return "invalid";
    case "rapid:not_found":
      return "not_found";
    case "rapid:not_pending":
      return "not_pending";
    case "rapid:not_at_hub":
      return "not_at_hub";
    case "rapid:same_driver":
      return "same_driver";
    case "rapid:taken":
      return "taken";
    case "rapid:inactive":
      return "inactive";
    case "rapid:wrong_staff_type":
      return "wrong_staff_type";
    case "rapid:needs_driver":
      return "needs_driver";
    case "rapid:locked":
      return "locked";
    case "rapid:has_history":
      return "has_history";
    case "rapid:cash_limit":
      return "cash_limit";
    default:
      return "failed";
  }
}

export type AdminClient = { supabase: SupabaseClient; profile: SessionProfile };

/**
 * The caller must be the signed-in admin according to the server session.
 * Nothing the browser sends names a user or a role.
 */
export async function adminClient(): Promise<
  { ok: true; client: AdminClient } | { ok: false; error: AdminErrorCode }
> {
  const session = await getAuthSession();
  if (session.status === "anonymous") return { ok: false, error: "unauthorized" };
  if (session.status !== "ready" || session.profile.role !== "admin") {
    return { ok: false, error: "forbidden" };
  }

  return {
    ok: true,
    client: { supabase: await createClient(), profile: session.profile },
  };
}

export async function adminRpc(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown } | { error: AdminErrorCode }> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (isMigrationPending(error)) return { error: "migration_pending" };
    const code = mapRpcMessage(error.message);
    if (code === "failed") console.error("admin rpc failed", fn, error.code, error.message);
    return { error: code };
  }
  return { data };
}
