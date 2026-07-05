import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * チェック系 UI を 1 種類に統一する Switch。オフセットトグル、固定収支の「有効」、
 * 超過確定/データ管理のチェックボックスなど、4 種類の見た目をこれに置き換える。
 */
export function Switch({
  checked,
  onChange,
  id,
  "aria-label": ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  id?: string;
  "aria-label"?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-brand" : "border border-line-strong bg-surface-2",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-ink transition-transform",
          checked ? "translate-x-6 bg-[#0B0E13]" : "translate-x-1 bg-ink-3",
        )}
      />
    </button>
  );
}

/**
 * ラベルと Switch を並べる行。設定系フォームで多用する構成をまとめる。
 */
export function SwitchField({
  label,
  help,
  checked,
  onChange,
  id,
  className,
}: {
  label: ReactNode;
  help?: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  id?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-[var(--radius-s)] border border-line bg-surface-2 px-4 py-3 text-sm",
        className,
      )}
    >
      <div className="min-w-0 cursor-pointer select-none" onClick={() => onChange(!checked)}>
        <div className="text-ink">{label}</div>
        {help ? <div className="mt-0.5 text-xs text-ink-3">{help}</div> : null}
      </div>
      <Switch id={id} checked={checked} onChange={onChange} aria-label={typeof label === "string" ? label : undefined} />
    </div>
  );
}
