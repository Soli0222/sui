import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * 共有フィールド部品（C-5 規約 5）。ラベル、必須マーク、コントロール、ヘルプ、
 * エラーの 5 スロットを持つ。placeholder をラベル代わりに使うことを禁止する。
 */
export function FormField({
  label,
  htmlFor,
  required = false,
  help,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  help?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5 text-sm", className)}>
      <label htmlFor={htmlFor} className="text-ink-2">
        {label}
        {required ? <span className="text-critical"> *</span> : null}
      </label>
      {children}
      {help ? <p className="text-xs text-ink-3">{help}</p> : null}
      {error ? (
        <p role="alert" className="text-xs font-medium text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}
