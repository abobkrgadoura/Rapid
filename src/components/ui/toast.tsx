"use client";

import { Toast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * shadcn-style toaster on Base UI Toast (the primitive this project's
 * shadcn/ui kit is built on). `toastManager` is module-scoped so a toast
 * fired during a client navigation is still on screen after the route changes.
 */
export const toastManager = Toast.createToastManager();

type ToastType = "success" | "error";

export function toastSuccess(title: string, description?: string) {
  return toastManager.add({
    title,
    description,
    type: "success" satisfies ToastType,
    priority: "low",
  });
}

export function toastError(title: string, description?: string) {
  return toastManager.add({
    title,
    description,
    type: "error" satisfies ToastType,
    priority: "high",
  });
}

export function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager} timeout={5000}>
      <ToastList />
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();

  return (
    <Toast.Portal>
      <Toast.Viewport className="pointer-events-none fixed top-4 left-1/2 z-[100] flex w-[min(100%-2rem,24rem)] -translate-x-1/2 flex-col gap-2 outline-none">
        {toasts.map((item) => (
          <Toast.Root
            key={item.id}
            toast={item}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-xl border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg ring-1 ring-black/5 transition-all duration-200",
              "data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
              "data-[type=success]:border-emerald-500/30",
              "data-[type=error]:border-destructive/40",
            )}
          >
            {item.type === "success" ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            ) : null}
            {item.type === "error" ? (
              <CircleAlert className="text-destructive mt-0.5 size-4 shrink-0" />
            ) : null}
            <Toast.Content className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Toast.Title className="text-sm font-semibold" />
              <Toast.Description className="text-muted-foreground text-sm" />
            </Toast.Content>
            <Toast.Close
              aria-label="إغلاق"
              className="text-muted-foreground hover:text-foreground -me-1 flex size-7 shrink-0 items-center justify-center rounded-md"
            >
              <X className="size-4" />
            </Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
