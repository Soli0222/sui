import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Table, TableWrapper } from "./table";

const DESKTOP_QUERY = "(min-width: 768px)";

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? true
      : window.matchMedia(DESKTOP_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}

export type ResponsiveTableColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  mono?: boolean;
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
  className,
}: {
  columns: ReadonlyArray<ResponsiveTableColumn<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  emptyMessage?: string;
  mobileRow?: (row: T) => ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const isDesktop = useIsDesktop();

  if (!isDesktop && mobileRow) {
    return (
      <div className="grid gap-3">
        {rows.length === 0 ? (
          <div className="text-sm text-ink-3">{emptyMessage}</div>
        ) : (
          rows.map((row) => (
            <div key={rowKey(row)} className="grid min-w-0 gap-2 rounded-2xl border border-line p-4 text-sm">
              {mobileRow(row)}
            </div>
          ))
        )}
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
                className={cn("px-3 py-3", column.align === "right" && "text-right")}
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
