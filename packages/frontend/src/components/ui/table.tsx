import type { HTMLAttributes, TableHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function TableWrapper({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("max-w-full overflow-x-auto overscroll-x-contain", className)} {...props} />;
}

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("min-w-full border-collapse text-sm", className)} {...props} />;
}
