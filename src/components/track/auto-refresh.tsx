"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the server page on an interval so a customer watching the page
 * sees the next step appear. Skips ticks while the tab is hidden and does
 * one catch-up refresh when it becomes visible again.
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    const timer = window.setInterval(refreshIfVisible, intervalMs);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [router, intervalMs]);

  return (
    <p className="text-muted-foreground flex items-center justify-center gap-2 text-xs">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full rounded-full bg-emerald-500/60 motion-safe:animate-ping" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      يتم تحديث الحالة تلقائيًا
    </p>
  );
}
