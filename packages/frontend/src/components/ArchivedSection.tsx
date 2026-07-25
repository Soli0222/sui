import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export function ArchivedSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) {
    return null;
  }

  return (
    <div className="border-t border-line pt-4">
      <details className="group">
        <summary className="flex w-full cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-ink-2 transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <span>
            {title} ({count})
          </span>
          <ChevronDown
            aria-hidden="true"
            className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="mt-4 opacity-60">{children}</div>
      </details>
    </div>
  );
}
