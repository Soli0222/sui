import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/** A single-column list for records that are read and acted on one at a time. */
export function CardList<T>({
  rows,
  rowKey,
  renderItem,
  emptyMessage = "データがありません。",
  className,
  itemClassName,
}: {
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  renderItem: (row: T) => ReactNode;
  emptyMessage?: string;
  className?: string;
  itemClassName?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-3">{emptyMessage}</p>;
  }

  return (
    <ul className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3", className)}>
      {rows.map((row) => (
        <li key={rowKey(row)} className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-2xl border border-line p-4 text-sm", itemClassName)}>
          {renderItem(row)}
        </li>
      ))}
    </ul>
  );
}
