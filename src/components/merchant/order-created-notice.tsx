"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { toastSuccess } from "@/components/ui/toast";

const TRACKING_CODE = /^RP[A-Z0-9]{6,16}$/;
const announced = new Set<string>();

export function OrderCreatedNotice({ code }: { code: string | null }) {
  const router = useRouter();

  useEffect(() => {
    if (!code || !TRACKING_CODE.test(code) || announced.has(code)) return;
    announced.add(code);
    toastSuccess("تم إنشاء الطلب", `رقم التتبع ${code}`);
    router.replace("/merchant/orders");
  }, [code, router]);

  return null;
}
