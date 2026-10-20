import { Check, PackageCheck, PackagePlus, Truck, Warehouse } from "lucide-react";
import type { ComponentType } from "react";

import type { PublicStepKey, PublicTimelineStep } from "@/lib/orders/public-timeline";
import { cn } from "@/lib/utils";

const ICON: Record<PublicStepKey, ComponentType<{ className?: string }>> = {
  created: PackagePlus,
  picked_up: PackageCheck,
  at_hub: Warehouse,
  out_for_delivery: Truck,
  delivered: Check,
};

const timeFormat = new Intl.DateTimeFormat("ar-SD", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Africa/Khartoum",
});

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : timeFormat.format(date);
}

const STATE_WORD: Record<PublicTimelineStep["state"], string> = {
  done: "مكتملة",
  current: "الحالية",
  upcoming: "قادمة",
};

function Marker({ step }: { step: PublicTimelineStep }) {
  const Icon = ICON[step.key];
  return (
    <span className="relative flex size-11 shrink-0 items-center justify-center">
      {step.state === "current" ? (
        <span
          aria-hidden
          className="bg-brand/30 absolute inset-0 rounded-full motion-safe:animate-ping"
        />
      ) : null}
      <span
        className={cn(
          "relative flex size-11 items-center justify-center rounded-full border-2",
          step.state === "done" && "border-emerald-600 bg-emerald-600 text-white",
          step.state === "current" && "border-brand bg-brand text-brand-foreground shadow-lg shadow-brand/30",
          step.state === "upcoming" && "border-zinc-200 bg-zinc-100 text-zinc-400",
        )}
      >
        {step.state === "done" ? <Check className="size-5" strokeWidth={3} /> : <Icon className="size-5" />}
      </span>
    </span>
  );
}

function StepCopy({ step }: { step: PublicTimelineStep }) {
  const time = formatTime(step.at);
  return (
    <div className={cn("min-w-0", step.state === "upcoming" && "opacity-45")}>
      <h3 className="text-sm leading-snug font-bold text-neutral-950 md:text-center">
        {step.label}
        <span className="sr-only"> ({STATE_WORD[step.state]})</span>
      </h3>
      {time ? (
        <time
          dateTime={step.at ?? undefined}
          className="text-muted-foreground mt-1 block text-xs tabular-nums md:text-center"
        >
          {time}
        </time>
      ) : (
        <span className="mt-1 block text-xs text-zinc-400 md:text-center">
          {step.state === "upcoming" ? "لم يحن بعد" : "—"}
        </span>
      )}
    </div>
  );
}

export function ShipmentStepper({ steps }: { steps: PublicTimelineStep[] }) {
  return (
    <div>
      <ol aria-label="مسار الشحنة" className="flex flex-col md:hidden">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          const next = steps[index + 1];
          const filled = next !== undefined && next.state !== "upcoming";
          return (
            <li
              key={step.key}
              aria-current={step.state === "current" ? "step" : undefined}
              className="flex gap-4"
            >
              <div className="flex flex-col items-center">
                <Marker step={step} />
                {last ? null : (
                  <span
                    aria-hidden
                    className={cn("my-1 w-0.5 flex-1 rounded-full", filled ? "bg-emerald-500" : "bg-zinc-200")}
                  />
                )}
              </div>
              <div className={cn("pt-2", last ? "pb-0" : "pb-6")}>
                <StepCopy step={step} />
              </div>
            </li>
          );
        })}
      </ol>

      <ol aria-label="مسار الشحنة" className="hidden md:grid md:grid-cols-5 md:gap-2">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          const filled = step.state === "done";
          return (
            <li
              key={step.key}
              aria-current={step.state === "current" ? "step" : undefined}
              className="relative flex flex-col items-center gap-3 text-center"
            >
              {last ? null : (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-5 right-[calc(50%+1.6rem)] left-[calc(-50%+1.6rem)] h-0.5",
                    filled ? "bg-emerald-500" : "bg-zinc-200",
                  )}
                />
              )}
              <Marker step={step} />
              <StepCopy step={step} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
