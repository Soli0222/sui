import { cn } from "../lib/utils";
import { StatusChip } from "./ui/status-chip";

export type LevelHeaderStatus = "safe" | "warning" | "critical";

const statusTone = {
  safe: "success",
  warning: "warning",
  critical: "danger",
} as const;

const statusLabel = {
  safe: "安全",
  warning: "警告",
  critical: "危険",
} as const;

/**
 * 水位ヘッダー（C-3）。3 値判定を最上部で言い切り、危険時のみ「あと N 日」を
 * 判定ヒーローサイズ（40px Mono）で示す。総資産・期間内最小・次の収入・次の支出は
 * 従属位置に格下げして残す。ヒーロー背後にのみ 1px 横罫パターンを敷く。
 */
export function LevelHeader({
  status,
  heroText,
  criticalDays,
  totalBalanceLabel,
  minBalanceLabel,
  onMinBalanceClick,
  nextIncomeLabel,
  nextExpenseLabel,
}: {
  status: LevelHeaderStatus;
  heroText: string;
  criticalDays?: number;
  totalBalanceLabel: string;
  minBalanceLabel: string;
  onMinBalanceClick?: () => void;
  nextIncomeLabel: string;
  nextExpenseLabel: string;
}) {
  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, rgba(233,228,218,0.03) 0px, rgba(233,228,218,0.03) 1px, transparent 1px, transparent 9px)",
        }}
      />
      <div className="relative grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusChip tone={statusTone[status]}>{statusLabel[status]}</StatusChip>
          <div className="text-right">
            <div className="text-xs font-medium text-ink-3">総資産</div>
            <div className="font-data overflow-x-auto whitespace-nowrap text-lg font-semibold">
              {totalBalanceLabel}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-x-4 gap-y-1 min-w-0">
          <p className={cn("min-w-0 break-words text-lg font-semibold sm:text-xl", status === "critical" && "text-critical", status === "warning" && "text-warning")}>
            {heroText}
          </p>
          {status === "critical" && typeof criticalDays === "number" ? (
            <div className="flex items-baseline gap-1 text-critical">
              <span className="font-data text-[40px] font-semibold leading-[48px]">{criticalDays}</span>
              <span className="text-sm font-medium">日</span>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-ink-3">期間内最小</div>
            {onMinBalanceClick ? (
              <button
                type="button"
                onClick={onMinBalanceClick}
                className="font-data mt-1 block overflow-x-auto whitespace-nowrap text-ink-2 underline decoration-dotted underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {minBalanceLabel}
              </button>
            ) : (
              <div className="font-data mt-1 overflow-x-auto whitespace-nowrap text-ink-2">{minBalanceLabel}</div>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-ink-3">次の収入</div>
            <div className="font-data mt-1 overflow-x-auto whitespace-nowrap text-ink-2">{nextIncomeLabel}</div>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-ink-3">次の支出</div>
            <div className="font-data mt-1 overflow-x-auto whitespace-nowrap text-ink-2">{nextExpenseLabel}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
