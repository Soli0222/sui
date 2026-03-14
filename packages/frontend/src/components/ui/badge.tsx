import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Badge({
  className,
  tone = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "default" | "success" | "danger" }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
        tone === "default" && "bg-white/10 text-foreground",
        tone === "success" && "bg-success/15 text-sky-300",
        tone === "danger" && "bg-danger/15 text-pink-300",
        className,
      )}
      {...props}
    />
  );
}
