"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";

import { acknowledgeDriverAlert } from "@/actions/driver-pro";
import { useDriverPrefs } from "@/components/driver/preferences";
import type { DriverAlert } from "@/lib/data/driver-dashboard";

const SEEN_KEY = "rapid.driver.seenDeliveries";
const ALERTED_KEY = "rapid.driver.alerted";

/**
 * Sound and vibration for admin alerts, plus the dismiss handler, shared by the
 * pickup and delivery homes.
 *
 * `watchedCount` is the number of new-work items the surface cares about (the
 * delivery home passes its loaded deliveries). Pass null to skip that alert.
 */
export function useDriverAlerts(
  alerts: DriverAlert[],
  watchedCount: number | null,
): (id: string) => Promise<void> {
  const router = useRouter();
  const { alert, prefs } = useDriverPrefs();

  useEffect(() => {
    if (watchedCount === null || !prefs.highAlert) return;
    const previous = sessionStorage.getItem(SEEN_KEY);
    if (previous === null) {
      if (watchedCount > 0) alert();
    } else if (Number(previous) < watchedCount) {
      alert();
    }
    sessionStorage.setItem(SEEN_KEY, String(watchedCount));
  }, [watchedCount, prefs.highAlert, alert]);

  useEffect(() => {
    if (!prefs.highAlert || alerts.length === 0) return;
    const key = alerts.map((item) => item.id).join(",");
    if (sessionStorage.getItem(ALERTED_KEY) === key) return;
    sessionStorage.setItem(ALERTED_KEY, key);
    alert();
  }, [alerts, prefs.highAlert, alert]);

  return useCallback(
    async (id: string) => {
      await acknowledgeDriverAlert(id);
      router.refresh();
    },
    [router],
  );
}
