import type { HTMLAttributes, TableHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function TableWrapper({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("overflow-x-auto", className)} {...props} />;
}

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("min-w-full border-collapse text-sm", className)} {...props} />;
}

