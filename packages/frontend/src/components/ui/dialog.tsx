import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { PropsWithChildren } from "react";
import { cn } from "../../lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 max-h-[90dvh] w-[min(94vw,32rem)] min-w-0 -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-l)] border border-line bg-surface-1 p-4 shadow-[var(--elev-1)] sm:p-6",
          className,
        )}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
