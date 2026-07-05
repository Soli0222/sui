import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * 条件フィールドは制御元の直下に全幅で出現する（C-5 規約 2）。
 * 左端に 2px のインデント罫を付け、高さトランジション 150ms（motion-reduce で無効）で
 * 出現・消滅する。他のフィールドの幅・水平位置は変えない。
 */
export function ConditionalField({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!show}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none",
        show ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="overflow-hidden">
        {show ? (
          <div className="min-w-0 border-l-2 border-line-strong pl-3">{children}</div>
        ) : null}
      </div>
    </div>
  );
}
