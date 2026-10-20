import type { SupabaseClient } from "@supabase/supabase-js";

import { isStaffType, type StaffType } from "@/lib/admin/labels";
import { isAppRole, type AppRole } from "@/lib/auth/roles";

export type SessionProfile = {
  id: string;
  role: AppRole;
  fullName: string | null;
  email: string | null;
  /**
   * Staff specialty (migration 0007). Only meaningful for `driver` accounts.
   * Null for accounts created before 0007. Never a role: it does not grant access.
   */
  staffType: StaffType | null;
};

type ProfileRow = {
  id: string;
  role: string;
  full_name: string | null;
  email: string | null;
  is_active?: boolean | null;
  staff_type?: string | null;
};

function toProfile(row: ProfileRow): SessionProfile | null {
  if (!isAppRole(row.role)) return null;
  return {
    id: row.id,
    role: row.role,
    fullName: row.full_name,
    email: row.email,
    staffType: isStaffType(row.staff_type) ? row.staff_type : null,
  };
}

/** Postgres "undefined column": migration 0007 has not been applied yet. */
const UNDEFINED_COLUMN = "42703";

/**
 * Reads the caller's profile with their own JWT. RLS only returns their row.
 * A missing row, an unknown role, or a suspended account (is_active = false,
 * migration 0007) is denied (null), never defaulted. Before 0007 exists the
 * columns are absent, every account counts as active, and staffType is null.
 */
export async function fetchSessionProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<SessionProfile | null> {
  let result = await supabase
    .from("profiles")
    .select("id, role, full_name, email, is_active, staff_type")
    .eq("id", userId)
    .maybeSingle();

  if (result.error?.code === UNDEFINED_COLUMN) {
    result = await supabase
      .from("profiles")
      .select("id, role, full_name, email")
      .eq("id", userId)
      .maybeSingle();
  }

  const { data, error } = result;
  if (error || !data) return null;

  const row = data as ProfileRow;
  if (typeof row.role !== "string" || typeof row.id !== "string") return null;
  if (row.is_active === false) return null;
  return toProfile(row);
}
