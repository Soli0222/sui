import { DEFAULT_CURRENCY_CODE, type SupportedCurrencyCode } from "@sui/shared";
import { forwardRef, useId, useState, type InputHTMLAttributes } from "react";
import {
  formatCurrencyInputValue,
  normalizeCurrencyInputValue,
  parseCurrencyInputValue,
} from "../../lib/format";
import { cn } from "../../lib/utils";

const currencySymbols: Partial<Record<SupportedCurrencyCode, string>> = {
  JPY: "¥",
  USD: "$",
  EUR: "€",
};

function getCurrencySymbol(currencyCode: SupportedCurrencyCode) {
  return currencySymbols[currencyCode] ?? currencyCode;
}

export type MoneyDraft = {
  raw: string;
  kind: "empty" | "incomplete" | "invalid" | "valid";
  minorUnits: number | null;
};

export function readMoneyDraft(raw: string, currencyCode: SupportedCurrencyCode): MoneyDraft {
  const normalized = normalizeCurrencyInputValue(raw, currencyCode);
  if (!normalized.valid) return { raw, kind: "invalid", minorUnits: null };
  if (normalized.value === "") return { raw: "", kind: "empty", minorUnits: null };
  if (normalized.value === "-" || normalized.value.endsWith(".")) {
    return { raw: normalized.value, kind: "incomplete", minorUnits: null };
  }
  if (!Number.isFinite(Number(normalized.value))) {
    return { raw: normalized.value, kind: "invalid", minorUnits: null };
  }
  const minorUnits = parseCurrencyInputValue(normalized.value, currencyCode);
  return Number.isSafeInteger(minorUnits)
    ? { raw: normalized.value, kind: "valid", minorUnits }
    : { raw: normalized.value, kind: "invalid", minorUnits: null };
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
    value: number | null;
    currencyCode?: SupportedCurrencyCode;
    onChange: (value: number) => void;
    /** Controlled text for edit sessions. Empty/incomplete/invalid never becomes zero here. */
    draftValue?: string;
    onDraftChange?: (draft: MoneyDraft) => void;
    /** Separate local drafts when the subject or operation changes. */
    draftKey?: string;
    className?: string;
    allowPasswordManager?: boolean;
  } & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange" | "type" | "inputMode">
>(function MoneyInput(
  {
    id,
    value,
    currencyCode = DEFAULT_CURRENCY_CODE,
    onChange,
    draftValue,
    onDraftChange,
    draftKey,
    className,
    autoComplete,
    onFocus,
    onBlur,
    allowPasswordManager = false,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const identity = `${draftKey ?? ""}:${currencyCode}`;
  const [draft, setDraft] = useState<{ identity: string; value: string } | null>(null);
  const localDraft = draft?.identity === identity ? draft.value : null;
  const displayValue = draftValue ?? localDraft ?? (value === null ? "" : formatCurrencyInputValue(value, currencyCode));

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
        autoComplete={autoComplete ?? "off"}
        className={cn(
          "font-data h-11 w-full min-w-0 rounded-[var(--radius-s)] border border-line bg-surface-2 py-2 pr-3 pl-7 text-right text-sm text-ink outline-none transition focus:border-brand focus-visible:ring-2 focus-visible:ring-brand",
          className,
        )}
        value={displayValue}
        onFocus={(event) => {
          if (draftValue === undefined) {
            const nextDraft = value === 0 && localDraft === null ? "" : displayValue;
            setDraft({ identity, value: nextDraft });
          }
          if (value !== 0 || draftValue !== undefined) {
            event.currentTarget.select();
          }
          onFocus?.(event);
        }}
        onChange={(event) => {
          const next = readMoneyDraft(event.target.value, currencyCode);
          if (next.kind === "invalid" && !onDraftChange) {
            return;
          }
          setDraft({ identity, value: next.raw });
          onDraftChange?.(next);
          if (next.kind === "valid") onChange(next.minorUnits!);
          else if (!onDraftChange && (next.kind === "empty" || next.raw === "-")) onChange(0);
          else if (next.kind === "incomplete" && next.raw.endsWith(".")) onChange(parseCurrencyInputValue(next.raw, currencyCode));
        }}
        onBlur={(event) => {
          if (!onDraftChange || readMoneyDraft(displayValue, currencyCode).kind === "valid") setDraft(null);
          onBlur?.(event);
        }}
        {...props}
        {...(!allowPasswordManager ? { "data-1p-ignore": "true" } : {})}
      />
    </div>
  );
});
