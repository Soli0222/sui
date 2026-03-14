import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-foreground outline-none transition focus:border-primary",
        className,
      )}
      {...props}
    />
  );
}

