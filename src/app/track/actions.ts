"use server";

import { redirect } from "next/navigation";

import { normalizeTrackingCode } from "@/lib/orders/tracking";
import { trackingPagePath } from "@/lib/orders/tracking-link";

export async function searchTracking(formData: FormData) {
  const raw = formData.get("code");
  const code = normalizeTrackingCode(typeof raw === "string" ? raw : "");
  if (!code) redirect("/track?error=invalid");
  redirect(trackingPagePath(code));
}
