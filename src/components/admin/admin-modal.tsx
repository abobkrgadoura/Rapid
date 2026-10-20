"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Desktop-first modal and side drawer for the admin Control Tower. The shared
 * `Dialog` is a mobile bottom sheet; the admin screens want a centred card and
 * an inspection panel. Both are always right-to-left, and the popup sets `dir`
 * itself because portals render outside the page tree.
 */

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

function Header({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
      <div className="flex min-w-0 flex-col gap-1">
        <DialogPrimitive.Title className="text-lg leading-tight font-bold tracking-tight">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="text-muted-foreground text-sm">
            {description}
          </DialogPrimitive.Description>
        ) : null}
      </div>
      <DialogPrimitive.Close
        aria-label="إغلاق"
        className="text-muted-foreground hover:bg-muted hover:text-foreground pointer-events-auto flex size-11 min-h-11 min-w-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <X className="size-4" />
      </DialogPrimitive.Close>
    </div>
  );
}

export function AdminDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          data-slot="dialog-overlay"
          className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-[2px] transition-opacity duration-200 data-closed:pointer-events-none data-ending-style:pointer-events-none data-ending-style:opacity-0 data-starting-style:pointer-events-none data-starting-style:opacity-0"
        />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
          <DialogPrimitive.Popup
            dir="rtl"
            lang="ar"
            data-slot="dialog-content"
            className={cn(
              "bg-background pointer-events-auto flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border shadow-2xl outline-none transition-[opacity,transform] duration-200 data-closed:pointer-events-none data-ending-style:pointer-events-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
              className,
            )}
          >
            <Header title={title} description={description} />
            <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
          </DialogPrimitive.Popup>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function AdminDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          data-slot="dialog-overlay"
          className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-[2px] transition-opacity duration-200 data-closed:pointer-events-none data-ending-style:pointer-events-none data-ending-style:opacity-0 data-starting-style:pointer-events-none data-starting-style:opacity-0"
        />
        <DialogPrimitive.Popup
          dir="rtl"
          lang="ar"
          data-slot="dialog-content"
          className={cn(
            "bg-background fixed inset-y-0 end-0 z-50 flex w-full max-w-xl flex-col border-s shadow-2xl outline-none transition-transform duration-200 data-closed:pointer-events-none data-ending-style:pointer-events-none data-ending-style:-translate-x-full data-starting-style:-translate-x-full",
            className,
          )}
        >
          <Header title={title} description={description} />
          <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
