"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Package, Warehouse } from "lucide-react";

import { saveMonthlyVolume } from "@/actions/merchant";
import { toastError } from "@/components/ui/toast";
import type { MonthlyVolume } from "@/lib/merchant/settings";
import { cn } from "@/lib/utils";

const CHOICES: ReadonlyArray<{
  value: MonthlyVolume | "one";
  label: string;
  detail: string;
  icon: typeof Package;
}> = [
  {
    value: "one",
    label: "شحنة واحدة فقط",
    detail: "غير متاح",
    icon: Package,
  },
  {
    value: "under_100",
    label: "أقل من 100 شحنة",
    detail: "مناسب للمتاجر في بدايتها",
    icon: Package,
  },
  {
    value: "between_100_400",
    label: "بين 100 - 400 شحنة",
    detail: "شحن منتظم على مدار الشهر",
    icon: Boxes,
  },
  {
    value: "over_400",
    label: "أكثر من 400 شحنة",
    detail: "تشغيل يومي بحجم كبير",
    icon: Warehouse,
  },
];

export function OnboardingVolume() {
  const router = useRouter();
  const [pendingValue, setPendingValue] = useState<MonthlyVolume | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(volume: MonthlyVolume) {
    setPendingValue(volume);
    startTransition(async () => {
      const result = await saveMonthlyVolume(volume);
      if (!result.ok) {
        toastError(result.error);
        setPendingValue(null);
        return;
      }
      router.push("/merchant");
    });
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 sm:grid-cols-2">
      {CHOICES.map((choice) => {
        const Icon = choice.icon;
        if (choice.value === "one") {
          return (
            <div
              key={choice.value}
              aria-disabled="true"
              className="flex cursor-not-allowed flex-col gap-3 rounded-2xl border border-dashed border-neutral-300 bg-neutral-100/80 p-5 text-neutral-400"
            >
              <span className="flex size-11 items-center justify-center rounded-xl bg-neutral-200/80">
                <Icon className="size-5" />
              </span>
              <span className="text-lg font-bold">{choice.label}</span>
              <span className="text-sm">{choice.detail}</span>
            </div>
          );
        }

        const volume = choice.value;
        const selected = pendingValue === volume;

        return (
          <button
            key={choice.value}
            type="button"
            disabled={pending}
            onClick={() => choose(volume)}
            className={cn(
              "flex flex-col gap-3 rounded-2xl border bg-white p-5 text-start shadow-sm transition-all outline-none",
              "hover:-translate-y-0.5 hover:border-brand hover:shadow-md",
              "focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/30",
              "disabled:pointer-events-none disabled:opacity-60",
              selected && "border-brand ring-3 ring-brand/20",
            )}
          >
            <span className="bg-brand/10 text-brand flex size-11 items-center justify-center rounded-xl">
              <Icon className="size-5" />
            </span>
            <span className="text-lg font-bold text-neutral-950">{choice.label}</span>
            <span className="text-sm text-neutral-500">
              {selected && pending ? "جارٍ الحفظ…" : choice.detail}
            </span>
          </button>
        );
      })}
    </div>
  );
}
