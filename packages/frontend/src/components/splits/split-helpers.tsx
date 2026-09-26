import type { Person, SplitListItem, SplitStatus, Transaction } from "@sui/shared";
import { useState } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ChevronDown } from "lucide-react";
const splitStatusLabels: Record<Exclude<SplitStatus, "none">, string> = {
  unsettled: "未精算",
  partial: "一部精算",
  settled: "精算済",
};

const splitStatusTone: Record<Exclude<SplitStatus, "none">, "warning" | "success"> = {
  unsettled: "warning",
  partial: "warning",
  settled: "success",
};

export function getSplitStatusBadge(status: SplitStatus) {
  if (status === "none") {
    return null;
  }
  return <Badge tone={splitStatusTone[status]} className="whitespace-nowrap">{splitStatusLabels[status]}</Badge>;
}

export function getTransactionSettlementRemaining(transaction: Transaction): number {
  return transaction.settlementRemainingAmount ?? transaction.amount;
}

export function isSettlementCandidate(transaction: Transaction): boolean {
  return (
    transaction.type === "transfer" &&
    transaction.currencyCode === "JPY" &&
    getTransactionSettlementRemaining(transaction) > 0
  );
}

const TRANSFER_OPTION_DESCRIPTION_MAX_GRAPHEMES = 24;

function getGraphemeSegments(input: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
      return Array.from(segmenter.segment(input), (segment) => segment.segment);
    } catch {
      // fall through to a safe fallback for environments without Segmenter.
    }
  }
  return input.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|./g) ?? [];
}

export function truncateByGraphemes(input: string, maxLength: number): string {
  const segments = getGraphemeSegments(input);
  if (segments.length <= maxLength) {
    return input;
  }
  return `${segments.slice(0, maxLength).join("")}…`;
}

export function formatTransferOptionLabel(
  transaction: Transaction,
  maxDescriptionLength = TRANSFER_OPTION_DESCRIPTION_MAX_GRAPHEMES,
): string {
  const remaining = getTransactionSettlementRemaining(transaction);
  const description = truncateByGraphemes(transaction.description, maxDescriptionLength);
  return `${transaction.date} / 残り ${remaining.toLocaleString("ja-JP")}円 / ${description}`;
}

export function SplitSharesCell({ split }: { split: SplitListItem }) {
  const [expanded, setExpanded] = useState(false);
  const remaining = split.shares.filter((share) => share.remainingAmount > 0);
  if (remaining.length === 0) {
    return <span className="text-ink-3">未回収なし</span>;
  }
  const total = remaining.reduce((sum, share) => sum + share.remainingAmount, 0);
  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex min-w-0 items-center gap-1 whitespace-nowrap text-ink-2 transition hover:text-ink"
      >
        <span>
          未回収 {remaining.length}人（合計 {total.toLocaleString("ja-JP")}円）
        </span>
        <ChevronDown aria-hidden="true" className={"h-4 w-4 shrink-0 transition-transform" + (expanded ? " rotate-180" : "")} />
      </button>
      {expanded ? (
        <div className="mt-1 grid gap-1 text-xs text-ink-3">
          {remaining.map((share) => (
            <div key={share.id}>
              {share.personName}: {share.remainingAmount.toLocaleString("ja-JP")}円
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function formatPersonOutstanding(outstandingAmount: Person["outstandingAmount"]) {
  const amount = outstandingAmount.JPY ?? 0;
  if (amount === 0) {
    return <span className="text-ink-3">未回収なし</span>;
  }
  return `${amount.toLocaleString("ja-JP")} 円`;
}

export function calculateTotalOutstanding(people: Person[]): number {
  return people.reduce((sum, person) => sum + (person.outstandingAmount.JPY ?? 0), 0);
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid gap-3 rounded-xl border border-critical/40 bg-critical/10 p-4 text-sm text-ink">
      <p role="alert">{message}</p>
      <Button className="justify-self-start" variant="secondary" onClick={onRetry}>
        再試行
      </Button>
    </div>
  );
}

export function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}
