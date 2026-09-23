import { cn } from "../../lib/utils";

/**
 * フォームの形を変える選択（種別、支払方法、入力起点など）はここに集約する（C-5 規約 3）。
 * select でグリッド中程に埋めず、フォーム最上部に置いて「これを選ぶと下が変わる」ことを位置で伝える。
 */
export function SegmentedControl<TValue extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  id,
  className,
}: {
  options: ReadonlyArray<{ value: TValue; label: string }>;
  value: TValue;
  onChange: (value: TValue) => void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      className={cn("inline-flex w-full min-w-0 rounded-[var(--radius-m)] border border-line bg-surface-2 p-1", className)}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            let next: number;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % options.length;
            else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = options.length - 1;
            else return;
            event.preventDefault();
            onChange(options[next].value);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
          }}
          className={cn(
            "min-h-9 min-w-0 flex-1 truncate rounded-[var(--radius-s)] px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
            value === option.value ? "bg-brand text-[#0B0E13]" : "text-ink-2 hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
