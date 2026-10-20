import type { Metadata } from "next";
import Link from "next/link";

import { OnboardingVolume } from "@/components/merchant/onboarding-volume";

export const metadata: Metadata = {
  title: "حجم الشحنات",
};

export const instant = false;

export default function MerchantOnboardingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="mb-10 flex items-center gap-3">
        <span className="bg-brand text-brand-foreground flex size-11 items-center justify-center rounded-2xl text-xl font-black shadow-lg shadow-brand/25">
          R
        </span>
        <span className="text-xl font-bold tracking-tight text-neutral-950">Rapid</span>
      </div>
      <h1 className="max-w-2xl text-center text-3xl font-bold tracking-tight text-neutral-950 sm:text-4xl">
        مرحباً، ما هو عدد شحناتك الشهرية المتوقع؟
      </h1>
      <p className="mt-3 max-w-md text-center text-sm leading-relaxed text-neutral-500">
        نستخدم هذا الرقم لتجهيز حسابك. اختر أقرب وصف.
      </p>
      <div className="mt-10 w-full">
        <OnboardingVolume />
      </div>
      <p className="mt-8 text-center text-sm text-neutral-500">
        <Link href="/track" className="text-brand font-semibold hover:underline">
          أريد تتبع طلبي
        </Link>
      </p>
    </main>
  );
}
