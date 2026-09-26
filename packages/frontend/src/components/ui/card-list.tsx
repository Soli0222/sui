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
        <li key={rowKey(row)} className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-2xl border border-line p-3 text-sm", itemClassName)}>
          {renderItem(row)}
        </li>
      ))}
    </ul>
  );
}

/** Keeps each record's secondary facts with its title while values grow downward. */
export function RecordCardLayout({ title, value, details, actions, groupDetails = false }: {
  title: ReactNode;
  value: ReactNode;
  details?: ReactNode;
  actions?: ReactNode;
  groupDetails?: boolean;
}) {
  return <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-start", groupDetails && "xl:min-h-16 xl:grid-cols-[minmax(0,1fr)_minmax(0,38%)_auto]")}>
    <div className="grid min-w-0 content-start gap-1.5">{title}{details}</div>
    <div className="min-w-0">{value}</div>
    {actions && <div className="flex justify-end gap-1 md:self-center">{actions}</div>}
  </div>;
}
