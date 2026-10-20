"use client";

import { CheckCircle2, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

/**
 * Pickups / Deliveries tabs for the driver page. Both panels are rendered by
 * the server and passed in; this component only decides which one shows.
 *
 * It also holds the "pickup confirmed" notice. A merchant card disappears from
 * the list as soon as its last parcel is collected, which unmounts the scanner
 * that confirmed it, so the confirmation has to live somewhere that stays put.
 */

export type DriverTab = "pickups" | "deliveries";

type PickupNotice = { companyName: string; count: number };

const PickupFeedbackContext = createContext<(notice: PickupNotice) => void>(
  () => {},
);

export function usePickupFeedback() {
  return useContext(PickupFeedbackContext);
}

export function DriverTabs({
  initialTab,
  pickupCount,
  deliveryCount,
  pickupLabel,
  deliveryLabel,
  pickedUpLabel,
  fromLabel,
  hubLabel,
  dismissLabel,
  pickups,
  deliveries,
  deliveryBar,
}: {
  initialTab: DriverTab;
  pickupCount: number;
  deliveryCount: number;
  pickupLabel: string;
  deliveryLabel: string;
  pickedUpLabel: string;
  fromLabel: string;
  hubLabel: string;
  dismissLabel: string;
  pickups: ReactNode;
  deliveries: ReactNode;
  /** Fixed bottom bar, shown on the Deliveries tab only. */
  deliveryBar: ReactNode;
}) {
  const [tab, setTab] = useState<DriverTab>(initialTab);
  const [notice, setNotice] = useState<PickupNotice | null>(null);

  const report = useCallback((next: PickupNotice) => setNotice(next), []);

  const tabs: ReadonlyArray<{ id: DriverTab; label: string; count: number }> = [
    { id: "pickups", label: pickupLabel, count: pickupCount },
    { id: "deliveries", label: deliveryLabel, count: deliveryCount },
  ];

  return (
    <PickupFeedbackContext.Provider value={report}>
      <div
        role="tablist"
        aria-label="Driver work"
        className="bg-muted relative z-20 grid grid-cols-2 gap-1 rounded-2xl p-1"
      >
        {tabs.map((item) => {
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`driver-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`driver-panel-${item.id}`}
              onClick={() => setTab(item.id)}
              className={`pointer-events-auto relative z-10 flex h-12 min-h-11 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-xl text-base font-semibold transition-colors ${
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              {item.label}
              <span className="bg-foreground/10 min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-medium tabular-nums">
                {item.count}
              </span>
            </button>
          );
        })}
      </div>

      <section
        role="tabpanel"
        id="driver-panel-pickups"
        aria-labelledby="driver-tab-pickups"
        hidden={tab !== "pickups"}
        className="flex flex-col gap-4"
      >
        {notice ? (
          <div
            role="status"
            className="flex items-start gap-3 rounded-2xl bg-emerald-100 px-4 py-3 text-sm text-emerald-950 dark:bg-emerald-400/15 dark:text-emerald-200"
          >
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
            <p className="min-w-0 flex-1">
              {pickedUpLabel} {notice.count} {fromLabel} {notice.companyName}. {hubLabel}
            </p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label={dismissLabel}
              className="-m-1 flex size-8 shrink-0 items-center justify-center rounded-lg"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : null}
        {pickups}
      </section>

      <section
        role="tabpanel"
        id="driver-panel-deliveries"
        aria-labelledby="driver-tab-deliveries"
        hidden={tab !== "deliveries"}
        className="flex flex-col gap-4 pb-40"
      >
        {deliveries}
      </section>

      {tab === "deliveries" ? (
        <div className="bg-background pointer-events-auto fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex w-full max-w-lg flex-col gap-2">
            {deliveryBar}
          </div>
        </div>
      ) : null}
    </PickupFeedbackContext.Provider>
  );
}
