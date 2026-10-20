import { getAuthSession } from "@/lib/auth/session";
import { getMerchantProfile } from "@/lib/data/merchant-profile";
import { createClient } from "@/utils/supabase/server";

/**
 * What the create-order form should show before the merchant types anything.
 * Name and phone come from profiles. The address comes from saved preferences
 * when migration 0005 is applied, otherwise from the merchant's latest order,
 * so they do not retype pickup details on every shipment.
 */
export type MerchantOrderDefaults = {
  merchantName: string;
  phone: string;
  pickupAddress: string;
  returnAddress: string;
  pickupGpsUrl: string;
};

const EMPTY: MerchantOrderDefaults = {
  merchantName: "",
  phone: "",
  pickupAddress: "",
  returnAddress: "",
  pickupGpsUrl: "",
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function getMerchantOrderDefaults(): Promise<MerchantOrderDefaults> {
  const session = await getAuthSession();
  if (session.status !== "ready" || session.profile.role !== "merchant") {
    return EMPTY;
  }

  const merchantId = session.profile.id;
  const merchant = await getMerchantProfile();
  const supabase = await createClient();

  let merchantName = merchant?.companyName.trim() || session.profile.fullName?.trim() || "";
  let phone = merchant?.phone.trim() ?? "";
  let pickupAddress = merchant?.preferences.pickupAddress ?? "";
  let returnAddress = merchant?.preferences.returnAddress ?? "";
  let pickupGpsUrl = merchant?.preferences.pickupGpsUrl ?? "";

  if (!merchant) {
    const basic = await readBasicProfile(supabase, merchantId);
    merchantName = basic.name || merchantName;
    phone = basic.phone || phone;
  }

  if (!pickupAddress || !pickupGpsUrl) {
    const last = await readLastPickup(supabase, merchantId);
    if (!pickupAddress) pickupAddress = last.address;
    if (!pickupGpsUrl) pickupGpsUrl = last.gps;
  }

  if (!returnAddress) returnAddress = pickupAddress;

  return { merchantName, phone, pickupAddress, returnAddress, pickupGpsUrl };
}

async function readBasicProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  merchantId: string,
): Promise<{ name: string; phone: string }> {
  const withCompany = await supabase
    .from("profiles")
    .select("full_name, phone, company_name")
    .eq("id", merchantId)
    .maybeSingle();

  if (!withCompany.error && withCompany.data) {
    const company = text(withCompany.data.company_name);
    const fullName = text(withCompany.data.full_name);
    return { name: company || fullName, phone: text(withCompany.data.phone) };
  }

  const basic = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", merchantId)
    .maybeSingle();

  if (basic.error || !basic.data) return { name: "", phone: "" };
  return { name: text(basic.data.full_name), phone: text(basic.data.phone) };
}

async function readLastPickup(
  supabase: Awaited<ReturnType<typeof createClient>>,
  merchantId: string,
): Promise<{ address: string; gps: string }> {
  const full = await supabase
    .from("orders")
    .select("pickup_address, pickup_gps_url")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!full.error && full.data) {
    return {
      address: text(full.data.pickup_address),
      gps: text(full.data.pickup_gps_url),
    };
  }

  const plain = await supabase
    .from("orders")
    .select("pickup_address")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (plain.error || !plain.data) return { address: "", gps: "" };
  return { address: text(plain.data.pickup_address), gps: "" };
}
