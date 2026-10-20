import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. It bypasses Row Level Security, so it stays on the
 * server. Two jobs use it: composing a WhatsApp message after the acting
 * user's own JWT has already authorized the change, and building the public
 * tracking card until migration 0006 makes `track_order_details` return only
 * the safe columns. Never import this from a client component, never return
 * its rows to a caller, and never use it to decide who may do something.
 *
 * Returns null when SUPABASE_SERVICE_ROLE_KEY is not configured.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
