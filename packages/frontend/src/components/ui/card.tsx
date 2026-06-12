import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border border-white/10 bg-card/90 p-4 shadow-glow backdrop-blur sm:rounded-2xl sm:p-5",
        className,
      )}
      {...props}
    />
  );
}
