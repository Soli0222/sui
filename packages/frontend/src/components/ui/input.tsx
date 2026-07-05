import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-11 max-w-full min-w-0 w-full rounded-[var(--radius-s)] border border-line bg-surface-2 px-3 text-sm text-ink outline-none transition focus:border-brand",
        className,
      )}
      {...props}
    />
  );
});
