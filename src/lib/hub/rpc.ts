import type { SupabaseClient } from "@supabase/supabase-js";

import type { SessionProfile } from "@/lib/auth/profile";
import { getAuthSession } from "@/lib/auth/session";
import type { AppRole } from "@/lib/auth/roles";
import type { HubErrorCode } from "@/lib/hub/types";
import { createClient } from "@/utils/supabase/server";

/**
 * Plain server module (not a "use server" file) so these helpers are not
 * exposed as callable server actions. src/actions/hub.ts is the only caller.
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

function mapRpcError(message: string | undefined): HubErrorCode {
  const match = message?.match(/rapid:[a-z0-9_]+/);
  switch (match?.[0]) {
    case "rapid:unauthorized":
      return "unauthorized";
    case "rapid:forbidden":
      return "forbidden";
    case "rapid:invalid":
      return "invalid_code";
    case "rapid:not_found":
      return "not_found";
    case "rapid:wrong_merchant":
      return "wrong_merchant";
    case "rapid:not_pending":
    case "rapid:conflict":
      return "not_pending";
    case "rapid:not_picked_up":
      return "not_picked_up";
    case "rapid:not_at_hub":
      return "not_at_hub";
    case "rapid:taken":
      return "taken";
    case "rapid:same_driver":
      return "same_driver";
    default:
      return "failed";
  }
}

export type HubClient = { supabase: SupabaseClient; profile: SessionProfile };

/**
 * The caller comes from the server session, and must hold `role`. Nothing the
 * browser sends names a user or a role.
 */
export async function hubClientFor(
  role: AppRole,
): Promise<{ ok: true; client: HubClient } | { ok: false; error: HubErrorCode }> {
  const session = await getAuthSession();
  if (session.status === "anonymous") return { ok: false, error: "unauthorized" };
  if (session.status !== "ready" || session.profile.role !== role) {
    return { ok: false, error: "forbidden" };
  }

  return {
    ok: true,
    client: { supabase: await createClient(), profile: session.profile },
  };
}

export async function hubRpc(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown } | { error: HubErrorCode }> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const code = mapRpcError(error.message);
    if (code === "failed") console.error("hub rpc failed", fn, error.code, error.message);
    return { error: code };
  }
  return { data };
}
