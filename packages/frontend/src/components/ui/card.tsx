import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[var(--radius-m)] border border-line bg-surface-1 p-4 sm:p-5",
        className,
      )}
      {...props}
    />
  );
}
