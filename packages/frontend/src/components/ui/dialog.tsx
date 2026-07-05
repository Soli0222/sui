import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps, PropsWithChildren } from "react";
import { cn } from "../../lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * ダイアログ幅トークンは 3 つのみ。
 * S=28rem（確認）、M=36rem（フォーム）、L=min(96vw,72rem)（テーブル内包）。
 */
export type DialogSize = "s" | "m" | "l";

const sizeClass: Record<DialogSize, string> = {
  s: "w-[min(94vw,28rem)]",
  m: "w-[min(94vw,36rem)]",
  l: "w-[min(96vw,72rem)]",
};

export function DialogContent({
  children,
  className,
  size = "m",
  ...props
}: PropsWithChildren<{ className?: string; size?: DialogSize }> &
  Omit<ComponentProps<typeof DialogPrimitive.Content>, "className">) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 bg-black/70" />
      <DialogPrimitive.Content
        className={cn(
          "dialog-content fixed left-1/2 top-1/2 max-h-[90dvh] min-w-0 -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-l)] border border-line bg-surface-1 p-4 shadow-[var(--elev-1)] sm:p-6",
          sizeClass[size],
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
