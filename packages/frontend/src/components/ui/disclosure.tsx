import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * 「表示順」「有効」のような管理用フィールドを既定で閉じておくディスクロージャ（C-5 規約 4）。
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-line pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 text-sm font-medium text-ink-2 transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {summary}
        <ChevronDown aria-hidden="true" className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div className="mt-4 grid gap-4">{children}</div> : null}
    </div>
  );
}
