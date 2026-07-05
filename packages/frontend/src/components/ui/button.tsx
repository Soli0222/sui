import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const baseClass =
  "inline-flex max-w-full min-w-0 min-h-11 items-center justify-center gap-2 rounded-[var(--radius-m)] px-4 py-2 text-center text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        baseClass,
        variant === "primary" && "bg-brand text-[#0B0E13] hover:brightness-110",
        variant === "secondary" &&
          "border border-line-strong bg-transparent text-ink hover:border-brand hover:bg-surface-2",
        variant === "ghost" && "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
        variant === "danger" && "bg-critical text-white hover:brightness-110",
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({
  className,
  variant = "ghost",
  "aria-label": ariaLabel,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; "aria-label": string }) {
  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[var(--radius-s)] transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        variant === "primary" && "bg-brand text-[#0B0E13] hover:brightness-110",
        variant === "secondary" &&
          "border border-line-strong bg-transparent text-ink hover:border-brand hover:bg-surface-2",
        variant === "ghost" && "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
        variant === "danger" && "bg-transparent text-critical hover:bg-critical/10",
        className,
      )}
      {...props}
    />
  );
}
