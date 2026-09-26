import { Fragment } from "react";

export type AmountPeriodRow = {
  key: string;
  amount: string;
  start: string;
  end: string;
};

/** Aligns every amount and its effective period in two consistent columns. */
export function AmountPeriodList({ rows, amountHeader = "金額", periodHeader = "適用期間" }: {
  rows: ReadonlyArray<AmountPeriodRow>;
  amountHeader?: string;
  periodHeader?: string;
}) {
  return <div className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-left xl:grid-cols-[30%_minmax(0,1fr)]">
      <span className="text-xs text-ink-3">{amountHeader}</span>
      <span className="text-xs text-ink-3">{periodHeader}</span>
      {rows.map((row) => <Fragment key={row.key}>
        <span className="font-data whitespace-nowrap">{row.amount}</span>
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1 text-xs text-ink-3">
          <span className="whitespace-nowrap">{row.start}</span>
          <span>〜</span>
          <span className="whitespace-nowrap">{row.end}</span>
        </span>
      </Fragment>)}
  </div>;
}
