"use client";

import { createContext, useContext } from "react";

/**
 * The confirmation notice lives on the pickup home screen, because the
 * merchant card unmounts the scanner as soon as its last parcel is collected.
 */
export type PickupNotice = { companyName: string; count: number };

export const PickupFeedbackContext = createContext<(notice: PickupNotice) => void>(
  () => {},
);

export function usePickupFeedback() {
  return useContext(PickupFeedbackContext);
}
