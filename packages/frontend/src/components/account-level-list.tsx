import type { SupportedCurrencyCode } from "@sui/shared";
import { formatCurrency, formatCurrencyParts, formatDateWithYear } from "../lib/format";
import { cn } from "../lib/utils";
import { StatusChip, type StatusChipTone } from "./ui/status-chip";

export type AccountLevelRow = {
  id: string | "total";
  name: string;
  currentBalance: number;
  currentBalanceJpy: number;
  currencyCode: SupportedCurrencyCode;
  minBalance: number;
  minBalanceJpy: number;
  minBalanceDate: string;
  warningLevel: "none" | "yellow" | "red";
};

const toneByWarningLevel: Record<AccountLevelRow["warningLevel"], StatusChipTone> = {
  none: "success",
  yellow: "warning",
  red: "danger",
};

const labelByWarningLevel: Record<AccountLevelRow["warningLevel"], string> = {
  none: "安全",
  yellow: "可処分注意",
  red: "赤字見込み",
};

const barColorByWarningLevel: Record<AccountLevelRow["warningLevel"], string> = {
  none: "bg-positive",
  yellow: "bg-warning",
  red: "bg-critical",
};

/**
 * 口座別の水位リスト（B-3）。口座名・現在残高・期間内最小残高・最小日をバー付きで 1 行ずつ表示する。
 * 行クリックでチャートの対象口座を切り替える。AccountSelector のボタン列をここに吸収する。
 */
export function AccountLevelList({
  rows,
  selectedId,
  onSelect,
}: {
  rows: AccountLevelRow[];
  selectedId: string | "total";
  onSelect: (id: string | "total") => void;
}) {
  const maxBalance = Math.max(1, ...rows.map((row) => Math.abs(row.currentBalanceJpy)));

  return (
    <div className="grid gap-2">
      {rows.map((row) => {
        const ratio = Math.min(1, Math.abs(row.currentBalanceJpy) / maxBalance);
        const isSelected = selectedId === row.id;

        return (
          <button
            key={row.id}
            type="button"
            onClick={() => onSelect(row.id)}
            className={cn(
              "grid min-w-0 gap-2 rounded-[var(--radius-m)] border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4",
              isSelected ? "border-brand bg-surface-2" : "border-line bg-surface-1 hover:border-line-strong",
            )}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">{row.name}</span>
                <StatusChip tone={toneByWarningLevel[row.warningLevel]}>
                  {labelByWarningLevel[row.warningLevel]}
                </StatusChip>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className={cn("h-full rounded-full", barColorByWarningLevel[row.warningLevel])}
                  style={{ width: `${Math.max(ratio * 100, 3)}%` }}
                />
              </div>
            </div>
            <div className="grid min-w-0 gap-1 text-right">
              {(() => {
                const currentParts = formatCurrencyParts(row.currentBalance, row.currencyCode, row.currentBalanceJpy);
                return (
                  <div>
                    <div className="font-data overflow-x-auto whitespace-nowrap text-sm font-semibold">
                      {currentParts.primary}
                    </div>
                    {currentParts.secondary ? (
                      <div className="font-data overflow-x-auto whitespace-nowrap text-xs text-ink-3">
                        {currentParts.secondary}
                      </div>
                    ) : null}
                  </div>
                );
              })()}
              <div className="font-data overflow-x-auto whitespace-nowrap text-xs text-ink-2">
                期間内最小 {formatCurrency(row.minBalance, row.currencyCode)}
                {row.currencyCode === "JPY" ? "" : `（${formatCurrency(row.minBalanceJpy, "JPY")}）`}
                （{formatDateWithYear(row.minBalanceDate)}）
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
