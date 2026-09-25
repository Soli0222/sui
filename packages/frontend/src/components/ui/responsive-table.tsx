import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Table, TableWrapper } from "./table";
import { CardList } from "./card-list";

export function useIsDesktop(breakpoint: number, onBeforeChange?: () => void) {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof document === "undefined") return true;
    const main = document.querySelector("main");
    if (main) return main.getBoundingClientRect().width >= breakpoint;
    return typeof window.matchMedia !== "function" || window.matchMedia(`(min-width: ${breakpoint}px)`).matches;
  });
  const current = useRef(isDesktop);

  useEffect(() => {
    const main = document.querySelector("main");
    const update = (width: number) => {
      const next = width >= breakpoint;
      if (next === current.current) return;
      onBeforeChange?.();
      current.current = next;
      setIsDesktop(next);
    };
    if (main && typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => update(entries[0]?.contentRect.width ?? main.getBoundingClientRect().width));
      observer.observe(main);
      return () => observer.disconnect();
    }
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const onChange = (event: MediaQueryListEvent) => update(event.matches ? breakpoint : 0);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, [breakpoint, onBeforeChange]);

  return isDesktop;
}

export type ResponsiveTableColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  className?: string;
};

/**
 * デスクトップは水平罫線のみのテーブル、モバイルは同一データソースからのリスト行レイアウト。
 * min-w に依存した横スクロールテーブルの複製をここに集約する（C-4）。
 * どちらか一方だけを描画し、hidden な複製 DOM を残さない。
 */
export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = "データがありません。",
  mobileRow,
  footer,
  mobileFooter,
  breakpoint = 768,
  className,
}: {
  columns: ReadonlyArray<ResponsiveTableColumn<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  emptyMessage?: string;
  mobileRow?: (row: T) => ReactNode;
  footer?: ReactNode;
  mobileFooter?: ReactNode;
  breakpoint?: number;
  className?: string;
}) {
  const isDesktop = useIsDesktop(breakpoint);

  if (!isDesktop && mobileRow) {
    return (
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
        <CardList rows={rows} rowKey={rowKey} renderItem={mobileRow} emptyMessage={emptyMessage} itemClassName="gap-2" />
        {mobileFooter}
      </div>
    );
  }

  return (
    <TableWrapper>
      <Table className={cn("w-full", className)}>
        <thead>
          <tr className="border-b border-line text-left text-xs font-medium text-ink-3">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn("whitespace-nowrap px-3 py-3", column.align === "right" && "text-right", column.className)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-3 py-6 text-sm text-ink-3" colSpan={columns.length}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-line align-top">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "px-3 py-3",
                      column.align === "right" && "text-right",
                      column.mono && "font-data",
                      column.className,
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer}
      </Table>
    </TableWrapper>
  );
}

/** 主金額＋下に小さく JPY 換算を置く 2 行組のセル。 */
export function MoneyCell({ primary, secondary }: { primary: string; secondary?: string | null }) {
  return (
    <div className="text-right">
      <div className="font-data">{primary}</div>
      {secondary ? <div className="font-data text-xs text-ink-3">{secondary}</div> : null}
    </div>
  );
}
