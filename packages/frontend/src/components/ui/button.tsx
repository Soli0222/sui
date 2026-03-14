import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type Variant = "primary" | "ghost" | "danger";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-primary text-black hover:brightness-110",
        variant === "ghost" && "bg-muted text-foreground hover:bg-white/10",
        variant === "danger" && "bg-danger text-white hover:brightness-110",
        className,
      )}
      {...props}
    />
  );
}

