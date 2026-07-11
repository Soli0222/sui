import { DEFAULT_CURRENCY_CODE, getCurrencyMinorUnits, type SupportedCurrencyCode } from "@sui/shared";
import { forwardRef, useId, useState, type InputHTMLAttributes } from "react";
import { formatCurrencyInputValue, parseCurrencyInputValue } from "../../lib/format";
import { cn } from "../../lib/utils";

const currencySymbols: Partial<Record<SupportedCurrencyCode, string>> = {
  JPY: "¥",
  USD: "$",
  EUR: "€",
};

function getCurrencySymbol(currencyCode: SupportedCurrencyCode) {
  return currencySymbols[currencyCode] ?? currencyCode;
}

function buildDecimalPattern(minorUnits: number) {
  return minorUnits === 0 ? /^-?\d*$/ : new RegExp(`^-?\\d*\\.?\\d{0,${minorUnits}}$`);
}

/**
 * 通貨対応の金額入力（Issue #223 の根治）。
 * フォーカス中はローカル文字列ドラフトを表示し、blur で整形し直す。
 * 空欄や末尾ドットのような編集途中の状態を正当な入力として許可する。
 * type="text" + inputMode="decimal" によって type="number" の先頭 0 残留やホイール誤操作を断つ。
 */
export const MoneyInput = forwardRef<
  HTMLInputElement,
  {
    id?: string;
    value: number;
    currencyCode?: SupportedCurrencyCode;
    onChange: (value: number) => void;
    className?: string;
  } & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange" | "type" | "inputMode">
>(function MoneyInput({ id, value, currencyCode = DEFAULT_CURRENCY_CODE, onChange, className, ...props }, ref) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const minorUnits = getCurrencyMinorUnits(currencyCode);
  const pattern = buildDecimalPattern(minorUnits);
  const [draft, setDraft] = useState<string | null>(null);
  const displayValue = draft ?? formatCurrencyInputValue(value, currencyCode);

  return (
    <div className="relative min-w-0">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-3"
      >
        {getCurrencySymbol(currencyCode)}
      </span>
      <input
        ref={ref}
        id={inputId}
        type="text"
        inputMode="decimal"
        className={cn(
          "font-data h-11 w-full min-w-0 rounded-[var(--radius-s)] border border-line bg-surface-2 py-2 pr-3 pl-7 text-right text-sm text-ink outline-none transition focus:border-brand",
          className,
        )}
        value={displayValue}
        onFocus={(event) => {
          const nextDraft = value === 0 ? "" : displayValue;
          setDraft(nextDraft);
          if (value !== 0) {
            event.currentTarget.select();
          }
        }}
        onChange={(event) => {
          const next = event.target.value;
          if (next !== "" && next !== "-" && !pattern.test(next)) {
            return;
          }

          setDraft(next);
          onChange(next === "" || next === "-" ? 0 : parseCurrencyInputValue(next, currencyCode));
        }}
        onBlur={() => {
          setDraft(null);
        }}
        {...props}
      />
    </div>
  );
});
