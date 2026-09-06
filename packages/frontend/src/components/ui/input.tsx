import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  allowPasswordManager?: boolean;
};

function shouldSuppressPasswordManager(type: string, allowPasswordManager: boolean) {
  return !allowPasswordManager && ["text", "search", "number"].includes(type);
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type, autoComplete, allowPasswordManager = false, ...props },
  ref,
) {
  const suppressPasswordManager = shouldSuppressPasswordManager(type ?? "text", allowPasswordManager);

  return (
    <input
      ref={ref}
      {...(type ? { type } : {})}
      autoComplete={suppressPasswordManager ? (autoComplete ?? "off") : autoComplete}
      className={cn(
        "h-11 max-w-full min-w-0 w-full rounded-[var(--radius-s)] border border-line bg-surface-2 px-3 text-sm text-ink outline-none transition focus:border-brand",
        className,
      )}
      {...props}
      {...(suppressPasswordManager ? { "data-1p-ignore": "true" } : {})}
    />
  );
});
