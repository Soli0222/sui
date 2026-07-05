import type { HTMLAttributes } from "react";
import { Circle, Octagon, Triangle } from "lucide-react";
import { cn } from "../../lib/utils";

export type StatusChipTone = "default" | "success" | "warning" | "danger";

const icons: Record<StatusChipTone, typeof Circle> = {
  default: Circle,
  success: Circle,
  warning: Triangle,
  danger: Octagon,
};

const toneClass: Record<StatusChipTone, string> = {
  default: "bg-surface-2 text-ink-2",
  success: "bg-positive/15 text-positive",
  warning: "bg-warning/15 text-warning",
  danger: "bg-critical/15 text-critical",
};

/**
 * 色＋形＋ラベルの三重表現で重大度を示すチップ。
 * 危険=塗り八角形、警告=三角形、正常=ドット。
 */
export function StatusChip({
  className,
  tone = "default",
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: StatusChipTone }) {
  const Icon = icons[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        toneClass[tone],
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="h-2.5 w-2.5 shrink-0" fill="currentColor" strokeWidth={0} />
      {children}
    </span>
  );
}
